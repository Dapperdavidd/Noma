use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::sync::OnceLock;
use uuid::Uuid;

fn provider_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

fn setting(key: &str) -> Result<String, ApiError> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Media uploads are not connected yet. Please use an HTTPS media link.",
        ))
}

fn sign(parameters: &str, secret: &str) -> String {
    hex::encode(Sha256::digest(format!("{parameters}{secret}").as_bytes()))
}

async fn require_user(req: &HttpRequest, pool: &PgPool) -> Result<auth::User, ApiError> {
    auth::current(req, pool).await
}

#[derive(Deserialize)]
struct CloudinaryResource {
    public_id: String,
    secure_url: String,
}

#[derive(Deserialize)]
struct CloudinaryResources {
    resources: Vec<CloudinaryResource>,
}

async fn lookup_asset(
    public_id: &str,
    resource_type: &str,
) -> Result<CloudinaryResource, ApiError> {
    let cloud = setting("CLOUDINARY_CLOUD_NAME")?;
    let key = setting("CLOUDINARY_API_KEY")?;
    let secret = setting("CLOUDINARY_API_SECRET")?;
    let response = provider_client()
        .get(format!(
            "https://api.cloudinary.com/v1_1/{cloud}/resources/{resource_type}/upload"
        ))
        .basic_auth(key, Some(secret))
        .query(&[("prefix", public_id), ("max_results", "10")])
        .send()
        .await
        .map_err(|error| {
            tracing::error!(%error, "Cloudinary asset lookup failed");
            ApiError(
                StatusCode::BAD_GATEWAY,
                "Unable to verify the uploaded media",
            )
        })?;
    if !response.status().is_success() {
        tracing::error!(status=%response.status(), "Cloudinary asset lookup was rejected");
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Unable to verify the uploaded media",
        ));
    }
    response
        .json::<CloudinaryResources>()
        .await
        .map_err(|error| {
            tracing::error!(%error, "Invalid Cloudinary asset response");
            ApiError(
                StatusCode::BAD_GATEWAY,
                "Unable to verify the uploaded media",
            )
        })?
        .resources
        .into_iter()
        .find(|resource| resource.public_id == public_id)
        .ok_or_else(|| bad("The uploaded media could not be found"))
}

pub(crate) async fn delete_asset(public_id: &str, resource_type: &str) -> Result<(), ApiError> {
    let cloud = setting("CLOUDINARY_CLOUD_NAME")?;
    let key = setting("CLOUDINARY_API_KEY")?;
    let secret = setting("CLOUDINARY_API_SECRET")?;
    let response = provider_client()
        .delete(format!(
            "https://api.cloudinary.com/v1_1/{cloud}/resources/{resource_type}/upload"
        ))
        .basic_auth(key, Some(secret))
        .form(&[("public_ids[]", public_id)])
        .send()
        .await
        .map_err(|error| {
            tracing::error!(%error, %public_id, "Cloudinary asset deletion failed");
            ApiError(
                StatusCode::BAD_GATEWAY,
                "Unable to remove the uploaded media",
            )
        })?;
    if !response.status().is_success() {
        tracing::error!(status=%response.status(), %public_id, "Cloudinary asset deletion was rejected");
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Unable to remove the uploaded media",
        ));
    }
    Ok(())
}

async fn cleanup_pending(pool: &PgPool) {
    let uploads: Vec<(Uuid, String, String)> = match sqlx::query_as(
        "SELECT id,public_id,resource_type FROM image_uploads WHERE status='pending_delete' OR (status IN ('pending','uploaded') AND created_at<now()-interval '24 hours') ORDER BY created_at LIMIT 10",
    )
    .fetch_all(pool)
    .await
    {
        Ok(uploads) => uploads,
        Err(error) => {
            tracing::warn!(%error, "Unable to read queued image cleanups");
            return;
        }
    };
    for (upload_id, public_id, resource_type) in uploads {
        if let Err(error) = sqlx::query(
            "UPDATE image_uploads SET status='pending_delete',property_id=NULL WHERE id=$1",
        )
        .bind(upload_id)
        .execute(pool)
        .await
        {
            tracing::warn!(%error, %upload_id, "Unable to queue stale image upload cleanup");
            continue;
        }
        match delete_asset(&public_id, &resource_type).await {
            Ok(()) => {
                if let Err(error) =
                    sqlx::query("UPDATE image_uploads SET status='deleted' WHERE id=$1")
                        .bind(upload_id)
                        .execute(pool)
                        .await
                {
                    tracing::warn!(%error, %upload_id, "Unable to finish stale image cleanup record");
                }
            }
            Err(error) => {
                tracing::warn!(%error, %upload_id, "Stale image remains queued for cleanup");
            }
        }
    }
}

/// Cloudinary signs a canonical, alphabetically ordered parameter string.
/// https://cloudinary.com/documentation/authentication_signatures
pub async fn signature(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<UploadRequest>,
) -> Result<HttpResponse, ApiError> {
    let user = require_user(&req, &pool).await?;
    let cloud = setting("CLOUDINARY_CLOUD_NAME")?;
    let key = setting("CLOUDINARY_API_KEY")?;
    let secret = setting("CLOUDINARY_API_SECRET")?;
    let preset = setting("CLOUDINARY_UPLOAD_PRESET")?;
    cleanup_pending(&pool).await;
    let upload_id = Uuid::new_v4();
    let resource_type = body.resource_type.as_deref().unwrap_or("image");
    if !["image", "video"].contains(&resource_type) {
        return Err(bad("Choose an image or video upload"));
    }
    let public_id = format!("noma/{}/{}/{}", user.id, resource_type, Uuid::new_v4());
    let timestamp = chrono::Utc::now().timestamp();
    let parameters = format!(
        "overwrite=false&public_id={public_id}&timestamp={timestamp}&upload_preset={preset}"
    );
    sqlx::query(
        "INSERT INTO image_uploads(id,user_id,public_id,resource_type) VALUES($1,$2,$3,$4)",
    )
    .bind(upload_id)
    .bind(user.id)
    .bind(&public_id)
    .bind(resource_type)
    .execute(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(json!({
        "upload_id":upload_id,
        "cloud_name":cloud,
        "api_key":key,
        "timestamp":timestamp,
        "public_id":public_id,
        "overwrite":false,
        "upload_preset":preset,
        "signature":sign(&parameters,&secret),
        "resource_type":resource_type
    })))
}

pub async fn confirm(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    upload_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = require_user(&req, &pool).await?;
    let (public_id, resource_type): (String, String) = sqlx::query_as(
        "SELECT public_id,resource_type FROM image_uploads WHERE id=$1 AND user_id=$2 AND status='pending'",
    )
    .bind(*upload_id)
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    let resource = lookup_asset(&public_id, &resource_type).await?;
    sqlx::query("UPDATE image_uploads SET secure_url=$1,status='uploaded',confirmed_at=now() WHERE id=$2 AND status='pending'")
        .bind(&resource.secure_url)
        .bind(*upload_id)
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::Ok().json(json!({
        "upload_id":upload_id.into_inner(),
        "public_id":resource.public_id,
        "url":resource.secure_url
    })))
}

pub async fn discard(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    upload_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = require_user(&req, &pool).await?;
    let (public_id, resource_type): (String, String) = sqlx::query_as(
        "UPDATE image_uploads SET status='pending_delete' WHERE id=$1 AND user_id=$2 AND status IN ('pending','uploaded') RETURNING public_id,resource_type",
    )
    .bind(*upload_id)
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    if let Err(error) = delete_asset(&public_id, &resource_type).await {
        tracing::warn!(%error, %public_id, "Uploaded media queued for a later cleanup attempt");
        return Err(error);
    }
    sqlx::query("UPDATE image_uploads SET status='deleted' WHERE id=$1")
        .bind(*upload_id)
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize, Default)]
pub struct UploadRequest {
    resource_type: Option<String>,
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/images/signature", web::post().to(signature))
        .route("/images/uploads/{id}/confirm", web::post().to(confirm))
        .route("/images/uploads/{id}", web::delete().to(discard));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_are_deterministic_and_secret_dependent() {
        let a = sign("timestamp=123", "secret");
        assert_eq!(a.len(), 64);
        assert_eq!(a, sign("timestamp=123", "secret"));
        assert_ne!(a, sign("timestamp=123", "other"));
    }
}
