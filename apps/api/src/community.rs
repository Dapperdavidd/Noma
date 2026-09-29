use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, web};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;
pub async fn locations(pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let data:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',s.name,'cities',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) ORDER BY a.name) FROM areas a WHERE a.city_id=c.id),'[]'::jsonb)) ORDER BY c.name) FROM cities c WHERE c.state_id=s.id),'[]'::jsonb)) FROM states s ORDER BY s.name").fetch_all(pool.get_ref()).await?;
    Ok(HttpResponse::Ok().json(data))
}
pub async fn favorites(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT property_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(ids))
}
pub async fn favorite(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if req.method() == actix_web::http::Method::DELETE {
        sqlx::query("DELETE FROM favorites WHERE user_id=$1 AND property_id=$2")
            .bind(user.id)
            .bind(*id)
            .execute(pool.get_ref())
            .await?;
    } else {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1 AND status='active')",
        )
        .bind(*id)
        .fetch_one(pool.get_ref())
        .await?;
        if !exists {
            return Err(bad("This listing is unavailable"));
        }
        sqlx::query(
            "INSERT INTO favorites(user_id,property_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id)
        .bind(*id)
        .execute(pool.get_ref())
        .await?;
    }
    Ok(HttpResponse::NoContent().finish())
}
#[derive(Deserialize)]
pub struct Inquiry {
    message: String,
}
pub async fn inquire(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Inquiry>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !(10..=3000).contains(&body.message.trim().len()) {
        return Err(bad("Message must contain 10–3,000 characters"));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1 AND status='active' AND agent_id<>$2)",
    )
    .bind(*id)
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    if !exists {
        return Err(bad("You cannot inquire about this listing"));
    }
    sqlx::query("INSERT INTO inquiries(id,property_id,user_id,message) VALUES($1,$2,$3,$4)")
        .bind(Uuid::new_v4())
        .bind(*id)
        .bind(user.id)
        .bind(body.message.trim())
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::Created().finish())
}
pub async fn leads(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let data:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',i.id,'message',i.message,'status',i.status,'created_at',i.created_at,'property',p.title,'name',u.first_name || ' ' || u.last_name,'email',u.email) FROM inquiries i JOIN properties p ON p.id=i.property_id JOIN users u ON u.id=i.user_id WHERE p.agent_id=$1 ORDER BY i.created_at DESC LIMIT 100").bind(user.id).fetch_all(pool.get_ref()).await?;
    Ok(HttpResponse::Ok().json(data))
}

pub async fn saved_properties(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let data:Vec<Value>=sqlx::query_scalar(&format!("{} JOIN favorites f ON f.property_id=p.id WHERE f.user_id=$1 AND p.status='active' ORDER BY f.created_at DESC LIMIT 100",crate::properties::CARD)).bind(user.id).fetch_all(pool.get_ref()).await?;
    Ok(HttpResponse::Ok().json(data))
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/locations", web::get().to(locations))
        .route("/favorites", web::get().to(favorites))
        .route("/favorites/properties", web::get().to(saved_properties))
        .route("/favorites/{id}", web::put().to(favorite))
        .route("/favorites/{id}", web::delete().to(favorite))
        .route("/properties/{id}/inquiries", web::post().to(inquire))
        .route("/dashboard/inquiries", web::get().to(leads));
}
