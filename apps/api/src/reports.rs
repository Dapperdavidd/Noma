use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, web};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct Report {
    category: String,
    details: String,
}

pub async fn create(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    property_id: web::Path<Uuid>,
    body: web::Json<Report>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if ![
        "suspected_scam",
        "duplicate",
        "inaccurate",
        "unavailable",
        "other",
    ]
    .contains(&body.category.as_str())
    {
        return Err(bad("Choose a valid report category"));
    }
    if !(10..=2000).contains(&body.details.trim().len()) {
        return Err(bad("Report details must contain 10–2,000 characters"));
    }
    let reportable: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1 AND status='active' AND agent_id<>$2)",
    )
    .bind(*property_id)
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    if !reportable {
        return Err(bad("This listing cannot be reported"));
    }
    sqlx::query(
        "INSERT INTO property_reports(id,property_id,reporter_id,category,details) VALUES($1,$2,$3,$4,$5)",
    )
    .bind(Uuid::new_v4())
    .bind(*property_id)
    .bind(user.id)
    .bind(&body.category)
    .bind(body.details.trim())
    .execute(pool.get_ref())
    .await?;
    Ok(HttpResponse::Created().finish())
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/properties/{id}/reports", web::post().to(create));
}
