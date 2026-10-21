use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct Application {
    evidence_type: String,
    document_reference: Option<String>,
    evidence_note: String,
    evidence_url: Option<String>,
    declaration: bool,
}

fn optional(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

async fn owned_property(pool: &PgPool, user: &auth::User, id: Uuid) -> Result<Value, ApiError> {
    let property: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM properties p
         WHERE p.id=$1 AND (p.agent_id=$2 OR $3)",
    )
    .bind(id)
    .bind(user.id)
    .bind(user.role == "admin")
    .fetch_optional(pool)
    .await?;
    property.ok_or(ApiError(StatusCode::NOT_FOUND, "Property not found"))
}

pub async fn state(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let property = owned_property(&pool, &user, *id).await?;
    let latest: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',id,'status',status,'evidence_type',evidence_type,
            'document_reference',document_reference,'evidence_note',evidence_note,
            'evidence_url',evidence_url,'review_reason',review_reason,
            'submitted_at',submitted_at,'reviewed_at',reviewed_at
         ) FROM property_verification_applications
         WHERE property_id=$1 ORDER BY submitted_at DESC LIMIT 1",
    )
    .bind(*id)
    .fetch_optional(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(json!({
        "property": {
            "id": property["id"],
            "title": property["title"],
            "slug": property["slug"],
            "status": property["status"],
            "is_verified": property["is_verified"],
            "lister_relationship": property["lister_relationship"]
        },
        "application": latest
    })))
}

pub async fn submit(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Application>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !body.declaration {
        return Err(bad("Accept the listing declaration to continue"));
    }
    if ![
        "certificate_of_occupancy",
        "deed_of_assignment",
        "tenancy_authorization",
        "agency_mandate",
        "other",
    ]
    .contains(&body.evidence_type.as_str())
        || !(30..=2000).contains(&body.evidence_note.trim().len())
        || body
            .document_reference
            .as_deref()
            .is_some_and(|value| value.len() > 200)
        || body.evidence_url.as_deref().is_some_and(|url| {
            !url.is_empty() && (!url.starts_with("https://") || url.len() > 2048)
        })
    {
        return Err(bad(
            "Review the evidence type, note, reference and secure link",
        ));
    }
    let mut tx = pool.begin().await?;
    let property: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM properties p
         WHERE p.id=$1 AND p.agent_id=$2 FOR UPDATE",
    )
    .bind(*id)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await?;
    let property = property.ok_or(ApiError(StatusCode::NOT_FOUND, "Property not found"))?;
    if property["status"] != "active" {
        return Err(bad("Publish the property before applying for verification"));
    }
    if property["is_verified"].as_bool().unwrap_or(false) {
        return Err(bad("This property is already verified"));
    }
    let relationship = property["lister_relationship"]
        .as_str()
        .unwrap_or("owner")
        .to_owned();
    sqlx::query(
        "INSERT INTO property_verification_applications(
            id,property_id,applicant_id,lister_relationship,evidence_type,
            document_reference,evidence_note,evidence_url,property_snapshot,
            declaration_accepted_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())",
    )
    .bind(Uuid::new_v4())
    .bind(*id)
    .bind(user.id)
    .bind(&relationship)
    .bind(&body.evidence_type)
    .bind(optional(&body.document_reference))
    .bind(body.evidence_note.trim())
    .bind(optional(&body.evidence_url))
    .bind(property)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|db| db.is_unique_violation())
        {
            bad("This property already has an application under review")
        } else {
            error.into()
        }
    })?;
    tx.commit().await?;
    Ok(HttpResponse::Created().json(json!({"status":"pending"})))
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/properties/{id}/verification", web::get().to(state))
        .route("/properties/{id}/verification", web::post().to(submit));
}
