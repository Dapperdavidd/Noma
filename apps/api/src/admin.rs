use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
async fn admin(req: &HttpRequest, pool: &PgPool) -> Result<auth::User, ApiError> {
    let user = auth::current(req, pool).await?;
    if user.role != "admin" {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Administrator access is required",
        ));
    }
    Ok(user)
}
pub async fn queue(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    admin(&req, &pool).await?;
    let properties:Vec<Value>=sqlx::query_scalar(&format!("{} WHERE p.status IN ('active','suspended') AND NOT p.is_verified ORDER BY p.created_at LIMIT 100",crate::properties::repository::CARD)).fetch_all(pool.get_ref()).await?;
    let agents:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',a.user_id,'name',u.first_name || ' ' || u.last_name,'agency_name',a.agency_name,'verification_status',a.verification_status) FROM agent_profiles a JOIN users u ON u.id=a.user_id WHERE a.verification_status='pending' ORDER BY a.created_at LIMIT 100").fetch_all(pool.get_ref()).await?;
    let reports:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'category',r.category,'details',r.details,'created_at',r.created_at,'property_id',p.id,'property',p.title,'slug',p.slug,'reporter',u.first_name || ' ' || u.last_name,'reporter_email',u.email) FROM property_reports r JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=r.reporter_id WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 100").fetch_all(pool.get_ref()).await?;
    Ok(HttpResponse::Ok().json(json!({"properties":properties,"agents":agents,"reports":reports})))
}
#[derive(Deserialize)]
pub struct Review {
    target_type: String,
    action: String,
    reason: String,
}
pub async fn review(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Review>,
) -> Result<HttpResponse, ApiError> {
    let user = admin(&req, &pool).await?;
    if !(5..=2000).contains(&body.reason.trim().len()) {
        return Err(bad("A review reason of 5–2,000 characters is required"));
    }
    let mut tx = pool.begin().await?;
    let changed=match(body.target_type.as_str(),body.action.as_str()){
 ("property","verify")=>sqlx::query("UPDATE properties SET is_verified=true,updated_at=now() WHERE id=$1 AND status='active'").bind(*id).execute(&mut *tx).await?,
 ("property","suspend")=>sqlx::query("UPDATE properties SET status='suspended',is_verified=false,updated_at=now() WHERE id=$1").bind(*id).execute(&mut *tx).await?,
 ("property","restore")=>sqlx::query("UPDATE properties SET status='draft',updated_at=now() WHERE id=$1 AND status='suspended'").bind(*id).execute(&mut *tx).await?,
 ("agent","verify"|"reject")=>sqlx::query("UPDATE agent_profiles SET verification_status=$1,updated_at=now() WHERE user_id=$2").bind(if body.action=="verify"{"verified"}else{"rejected"}).bind(*id).execute(&mut *tx).await?,
 _=>return Err(bad("Invalid review action"))};
    if changed.rows_affected() == 0 {
        return Err(bad("The item is unavailable for this action"));
    }
    sqlx::query("INSERT INTO moderation_events(id,actor_id,target_id,target_type,action,reason) VALUES($1,$2,$3,$4,$5,$6)").bind(Uuid::new_v4()).bind(user.id).bind(*id).bind(&body.target_type).bind(&body.action).bind(body.reason.trim()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct ReportReview {
    action: String,
    reason: String,
}

pub async fn review_report(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<ReportReview>,
) -> Result<HttpResponse, ApiError> {
    let user = admin(&req, &pool).await?;
    if !["resolved", "dismissed"].contains(&body.action.as_str()) {
        return Err(bad("Invalid report decision"));
    }
    if !(5..=2000).contains(&body.reason.trim().len()) {
        return Err(bad("A decision reason of 5–2,000 characters is required"));
    }
    let mut tx = pool.begin().await?;
    let changed = sqlx::query(
        "UPDATE property_reports SET status=$1,resolution_reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 AND status='open'",
    )
    .bind(&body.action)
    .bind(body.reason.trim())
    .bind(user.id)
    .bind(*id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(bad("The report is unavailable for this action"));
    }
    sqlx::query("INSERT INTO moderation_events(id,actor_id,target_id,target_type,action,reason) VALUES($1,$2,$3,'report',$4,$5)")
        .bind(Uuid::new_v4())
        .bind(user.id)
        .bind(*id)
        .bind(&body.action)
        .bind(body.reason.trim())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/admin/queue", web::get().to(queue))
        .route("/admin/reviews/{id}", web::post().to(review))
        .route("/admin/reports/{id}", web::patch().to(review_report));
}
