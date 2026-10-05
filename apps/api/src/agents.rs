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

pub async fn public_profile(
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let data: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',u.id,'first_name',u.first_name,'last_name',u.last_name,
            'agency_name',a.agency_name,'bio',a.bio,'profile_image_url',a.profile_image_url,
            'verification_status',a.verification_status,
            'rating',COALESCE((SELECT round(avg(r.rating)::numeric,1) FROM agent_reviews r WHERE r.agent_id=u.id),0),
            'review_count',(SELECT count(*) FROM agent_reviews r WHERE r.agent_id=u.id),
            'completed_inspections',(SELECT count(*) FROM inspections i WHERE i.agent_id=u.id AND i.status='completed'),
            'active_properties',(SELECT count(*) FROM properties p WHERE p.agent_id=u.id AND p.status='active'),
            'member_since',u.created_at,
            'reviews',COALESCE((SELECT jsonb_agg(recent.review ORDER BY recent.created_at DESC) FROM (
                SELECT jsonb_build_object(
                    'id',r.id,'rating',r.rating,'communication',r.communication,
                    'punctuality',r.punctuality,'property_accuracy',r.property_accuracy,
                    'professionalism',r.professionalism,'comment',r.comment,'created_at',r.created_at,
                    'reviewer_name',reviewer.first_name || ' ' || left(reviewer.last_name,1) || '.'
                ) AS review,r.created_at
                FROM agent_reviews r JOIN users reviewer ON reviewer.id=r.reviewer_id
                WHERE r.agent_id=u.id ORDER BY r.created_at DESC LIMIT 20
            ) recent),'[]'::jsonb)
        )
        FROM users u JOIN agent_profiles a ON a.user_id=u.id
        WHERE u.id=$1 AND u.role='agent' AND u.is_active",
    )
    .bind(*id)
    .fetch_optional(pool.get_ref())
    .await?;
    let data = data.ok_or(ApiError(StatusCode::NOT_FOUND, "Agent profile not found"))?;
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
        .route("/agent/profile", web::put().to(update))
        .route("/agents/{id}", web::get().to(public_profile));
}
