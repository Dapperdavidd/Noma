use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha512;
use sqlx::PgPool;
use std::time::Duration as StdDuration;
use uuid::Uuid;

type HmacSha512 = Hmac<Sha512>;

#[derive(Clone)]
pub struct BillingClient {
    http: reqwest::Client,
    secret: Option<String>,
    app_url: String,
}

impl BillingClient {
    pub fn from_env() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(StdDuration::from_secs(15))
                .build()
                .expect("valid billing HTTP client"),
            secret: std::env::var("PAYSTACK_SECRET_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            app_url: std::env::var("PUBLIC_APP_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into())
                .trim_end_matches('/')
                .to_owned(),
        }
    }

    fn secret(&self) -> Result<&str, ApiError> {
        self.secret.as_deref().ok_or(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Paid plans are not open during early access",
        ))
    }

    fn signature_valid(&self, body: &[u8], signature: &str) -> bool {
        let Ok(secret) = self.secret() else {
            return false;
        };
        let Ok(expected) = hex::decode(signature) else {
            return false;
        };
        HmacSha512::new_from_slice(secret.as_bytes()).is_ok_and(|mut mac| {
            mac.update(body);
            mac.verify_slice(&expected).is_ok()
        })
    }
}

#[derive(Deserialize)]
pub struct CheckoutRequest {
    product_id: String,
    property_id: Option<Uuid>,
}

#[derive(Serialize)]
struct InitializeRequest<'a> {
    email: &'a str,
    amount: i64,
    currency: &'static str,
    reference: &'a str,
    callback_url: String,
    metadata: Value,
}

#[derive(Deserialize)]
struct ProviderResponse<T> {
    status: bool,
    data: Option<T>,
}

#[derive(Deserialize)]
struct InitializedPayment {
    authorization_url: String,
}

#[derive(Deserialize)]
struct VerifiedPayment {
    status: String,
    reference: String,
    amount: i64,
    currency: String,
}

#[derive(sqlx::FromRow)]
struct PurchaseActivation {
    id: Uuid,
    user_id: Uuid,
    product_id: String,
    property_id: Option<Uuid>,
    amount_kobo: i64,
    currency: String,
    status: String,
    duration_days: i32,
}

pub async fn products(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    client: web::Data<BillingClient>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let data: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',id,'name',name,'description',description,'kind',kind,
            'price_kobo',price_kobo,'duration_days',duration_days
         ) FROM billing_products
         WHERE active AND (kind<>'agent_subscription' OR $1 IN ('agent','admin'))
         ORDER BY price_kobo",
    )
    .bind(&user.role)
    .fetch_all(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(json!({
        "enabled": client.secret.is_some(),
        "data": data
    })))
}

pub async fn purchases(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let data: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',p.id,'reference',p.provider_reference,'status',p.status,
            'amount_kobo',p.amount_kobo,'currency',p.currency,'created_at',p.created_at,
            'paid_at',p.paid_at,'product',b.name,'property_id',p.property_id
         ) FROM billing_purchases p
         JOIN billing_products b ON b.id=p.product_id
         WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(data))
}

pub async fn checkout(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    client: web::Data<BillingClient>,
    body: web::Json<CheckoutRequest>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let secret = client.secret()?;
    let product: Option<(String, i64, i32)> = sqlx::query_as(
        "SELECT kind,price_kobo,duration_days FROM billing_products WHERE id=$1 AND active",
    )
    .bind(&body.product_id)
    .fetch_optional(pool.get_ref())
    .await?;
    let (kind, amount, _) = product.ok_or_else(|| bad("This paid plan is unavailable"))?;
    if kind == "agent_subscription" && !["agent", "admin"].contains(&user.role.as_str()) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "An agent account is required for this plan",
        ));
    }
    if kind == "featured_listing" {
        let Some(property_id) = body.property_id else {
            return Err(bad("Choose a property to feature"));
        };
        let eligible: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1 AND agent_id=$2 AND status='active')",
        )
        .bind(property_id)
        .bind(user.id)
        .fetch_one(pool.get_ref())
        .await?;
        if !eligible {
            return Err(bad("Only your active property can be featured"));
        }
    } else if body.property_id.is_some() {
        return Err(bad("A property is not used with this plan"));
    }

    let purchase_id = Uuid::new_v4();
    let reference = format!("noma-{purchase_id}");
    sqlx::query(
        "INSERT INTO billing_purchases(id,user_id,product_id,property_id,provider_reference,amount_kobo)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(purchase_id)
    .bind(user.id)
    .bind(&body.product_id)
    .bind(body.property_id)
    .bind(&reference)
    .bind(amount)
    .execute(pool.get_ref())
    .await?;

    let response = client
        .http
        .post("https://api.paystack.co/transaction/initialize")
        .bearer_auth(secret)
        .json(&InitializeRequest {
            email: &user.email,
            amount,
            currency: "NGN",
            reference: &reference,
            callback_url: format!("{}/billing/return", client.app_url),
            metadata: json!({
                "purchase_id": purchase_id,
                "user_id": user.id,
                "product_id": body.product_id,
            }),
        })
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            tracing::error!(%error, %reference, "Paystack initialization failed");
            sqlx::query(
                "UPDATE billing_purchases SET status='failed',updated_at=now() WHERE id=$1",
            )
            .bind(purchase_id)
            .execute(pool.get_ref())
            .await?;
            return Err(ApiError(StatusCode::BAD_GATEWAY, "Unable to start payment"));
        }
    };
    let status = response.status();
    let payload = response
        .json::<ProviderResponse<InitializedPayment>>()
        .await
        .map_err(|error| {
            tracing::error!(%error, %reference, "Invalid Paystack initialization response");
            ApiError(StatusCode::BAD_GATEWAY, "Unable to start payment")
        })?;
    let Some(data) = payload
        .data
        .filter(|_| status.is_success() && payload.status)
    else {
        sqlx::query("UPDATE billing_purchases SET status='failed',updated_at=now() WHERE id=$1")
            .bind(purchase_id)
            .execute(pool.get_ref())
            .await?;
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Payment provider rejected this checkout",
        ));
    };
    if !data.authorization_url.starts_with("https://") {
        sqlx::query("UPDATE billing_purchases SET status='failed',updated_at=now() WHERE id=$1")
            .bind(purchase_id)
            .execute(pool.get_ref())
            .await?;
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Payment provider returned an invalid checkout",
        ));
    }
    sqlx::query("UPDATE billing_purchases SET checkout_url=$1,updated_at=now() WHERE id=$2")
        .bind(&data.authorization_url)
        .bind(purchase_id)
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::Created().json(json!({
        "reference": reference,
        "checkout_url": data.authorization_url
    })))
}

async fn apply_success(
    pool: &PgPool,
    reference: &str,
    amount: i64,
    currency: &str,
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await?;
    let purchase: Option<PurchaseActivation> = sqlx::query_as(
            "SELECT p.id,p.user_id,p.product_id,p.property_id,p.amount_kobo,p.currency,p.status,b.duration_days
             FROM billing_purchases p JOIN billing_products b ON b.id=p.product_id
             WHERE p.provider_reference=$1 FOR UPDATE OF p",
        )
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(purchase) = purchase else {
        tracing::warn!(%reference, "Paystack event does not match a NOMA purchase");
        return Ok(());
    };
    if purchase.status == "succeeded" {
        return Ok(());
    }
    if purchase.amount_kobo != amount || purchase.currency.trim() != currency {
        tracing::error!(%reference, expected=purchase.amount_kobo, amount, %currency, "Paystack amount mismatch");
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Payment amount does not match",
        ));
    }
    sqlx::query(
        "UPDATE billing_purchases SET status='succeeded',paid_at=now(),updated_at=now() WHERE id=$1",
    )
    .bind(purchase.id)
    .execute(&mut *tx)
    .await?;
    if let Some(property_id) = purchase.property_id {
        let changed = sqlx::query(
            "UPDATE properties
             SET featured_until=GREATEST(COALESCE(featured_until,now()),now()) + make_interval(days => $1),updated_at=now()
             WHERE id=$2 AND agent_id=$3 AND status='active'",
        )
        .bind(purchase.duration_days)
        .bind(property_id)
        .bind(purchase.user_id)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() == 0 {
            return Err(bad("The property is no longer eligible for promotion"));
        }
    } else {
        let starts_at = Utc::now();
        let expires_at = starts_at + Duration::days(i64::from(purchase.duration_days));
        sqlx::query(
            "INSERT INTO billing_entitlements(user_id,product_id,purchase_id,starts_at,expires_at)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(user_id,product_id) DO UPDATE SET
                purchase_id=EXCLUDED.purchase_id,
                starts_at=LEAST(billing_entitlements.starts_at,EXCLUDED.starts_at),
                expires_at=GREATEST(billing_entitlements.expires_at,EXCLUDED.starts_at)+make_interval(days => $6),
                updated_at=now()",
        )
        .bind(purchase.user_id)
        .bind(&purchase.product_id)
        .bind(purchase.id)
        .bind(starts_at)
        .bind(expires_at)
        .bind(purchase.duration_days)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn verify(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    client: web::Data<BillingClient>,
    reference: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM billing_purchases WHERE provider_reference=$1 AND user_id=$2)",
    )
    .bind(reference.as_str())
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    if !owned {
        return Err(ApiError(StatusCode::NOT_FOUND, "Payment not found"));
    }
    let response = client
        .http
        .get(format!(
            "https://api.paystack.co/transaction/verify/{}",
            reference.as_str()
        ))
        .bearer_auth(client.secret()?)
        .send()
        .await
        .map_err(|error| {
            tracing::error!(%error, reference=%reference.as_str(), "Paystack verification failed");
            ApiError(StatusCode::BAD_GATEWAY, "Unable to verify payment")
        })?;
    let status = response.status();
    let payload = response
        .json::<ProviderResponse<VerifiedPayment>>()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Unable to verify payment"))?;
    let Some(data) = payload
        .data
        .filter(|_| status.is_success() && payload.status)
    else {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Unable to verify payment",
        ));
    };
    if data.reference != reference.as_str() {
        return Err(bad("Payment reference does not match"));
    }
    if data.status == "success" {
        apply_success(pool.get_ref(), &data.reference, data.amount, &data.currency).await?;
    }
    let purchase: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('reference',provider_reference,'status',status,'paid_at',paid_at)
         FROM billing_purchases WHERE provider_reference=$1 AND user_id=$2",
    )
    .bind(reference.as_str())
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(purchase))
}

pub async fn paystack_webhook(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    client: web::Data<BillingClient>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let signature = req
        .headers()
        .get("x-paystack-signature")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !client.signature_valid(&body, signature) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid payment signature",
        ));
    }
    let event: Value = serde_json::from_slice(&body).map_err(|_| bad("Invalid payment event"))?;
    if event["event"] == "charge.success" {
        let data = &event["data"];
        let reference = data["reference"]
            .as_str()
            .ok_or_else(|| bad("Payment reference is missing"))?;
        let amount = data["amount"]
            .as_i64()
            .ok_or_else(|| bad("Payment amount is missing"))?;
        let currency = data["currency"]
            .as_str()
            .ok_or_else(|| bad("Payment currency is missing"))?;
        apply_success(pool.get_ref(), reference, amount, currency).await?;
    }
    Ok(HttpResponse::Ok().finish())
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/billing/products", web::get().to(products))
        .route("/billing/purchases", web::get().to(purchases))
        .route("/billing/checkout", web::post().to(checkout))
        .route("/billing/verify/{reference}", web::post().to(verify))
        .route(
            "/billing/webhooks/paystack",
            web::post().to(paystack_webhook),
        );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_signatures_are_verified() {
        let client = BillingClient {
            http: reqwest::Client::new(),
            secret: Some("test-secret".into()),
            app_url: "http://localhost".into(),
        };
        let body = br#"{"event":"charge.success"}"#;
        let mut mac = HmacSha512::new_from_slice(b"test-secret").unwrap();
        mac.update(body);
        let signature = hex::encode(mac.finalize().into_bytes());
        assert!(client.signature_valid(body, &signature));
        assert!(!client.signature_valid(body, "invalid"));
    }
}
