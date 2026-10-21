use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, web};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',id,'kind',kind,'title',title,'body',body,'href',href,
            'read_at',read_at,'created_at',created_at
         )
         FROM notifications
         WHERE user_id=$1
         ORDER BY created_at DESC,id DESC
         LIMIT 100",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await?;
    let unread: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM notifications WHERE user_id=$1 AND read_at IS NULL",
    )
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(json!({"data":items,"unread":unread})))
}

pub async fn unread_count(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let unread: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM notifications WHERE user_id=$1 AND read_at IS NULL",
    )
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(json!({"unread": unread})))
}

pub async fn mark_read(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let result = sqlx::query(
        "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2",
    )
    .bind(*id)
    .bind(user.id)
    .execute(pool.get_ref())
    .await?;
    if result.rows_affected() == 0 {
        return Err(bad("Notification not found"));
    }
    Ok(HttpResponse::NoContent().finish())
}

pub async fn mark_all_read(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    sqlx::query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL")
        .bind(user.id)
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/notifications", web::get().to(list))
        .route("/notifications/unread", web::get().to(unread_count))
        .route("/notifications/read-all", web::post().to(mark_all_read))
        .route("/notifications/{id}/read", web::patch().to(mark_read));
}
