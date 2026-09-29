use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;
async fn agent(req: &HttpRequest, pool: &PgPool) -> Result<auth::User, ApiError> {
    let user = auth::current(req, pool).await?;
    if !["agent", "admin"].contains(&user.role.as_str()) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "An agent account is required",
        ));
    }
    Ok(user)
}
pub async fn profile(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let user = agent(&req, &pool).await?;
    let data: Value =
        sqlx::query_scalar("SELECT to_jsonb(a) FROM agent_profiles a WHERE user_id=$1")
            .bind(user.id)
            .fetch_one(pool.get_ref())
            .await?;
    Ok(HttpResponse::Ok().json(data))
}
#[derive(Deserialize)]
pub struct Profile {
    agency_name: String,
    bio: String,
}
pub async fn update(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<Profile>,
) -> Result<HttpResponse, ApiError> {
    let user = agent(&req, &pool).await?;
    if body.agency_name.len() > 200 || body.bio.len() > 3000 {
        return Err(bad(
            "Agency name must be at most 200 characters and bio at most 3,000",
        ));
    }
    sqlx::query("INSERT INTO agent_profiles(id,user_id,agency_name,bio) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET agency_name=EXCLUDED.agency_name,bio=EXCLUDED.bio,verification_status='pending',updated_at=now()").bind(Uuid::new_v4()).bind(user.id).bind(body.agency_name.trim()).bind(body.bio.trim()).execute(pool.get_ref()).await?;
    Ok(HttpResponse::NoContent().finish())
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/agent/profile", web::get().to(profile))
        .route("/agent/profile", web::put().to(update));
}
