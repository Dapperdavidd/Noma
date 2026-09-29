use actix_web::{HttpResponse, web};
use serde_json::json;
use sqlx::PgPool;

pub async fn live() -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "service": "noma-api",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn ready(pool: web::Data<PgPool>) -> HttpResponse {
    match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool.get_ref())
        .await
    {
        Ok(_) => HttpResponse::Ok().json(json!({"status":"ready"})),
        Err(error) => {
            tracing::error!(%error, "Readiness database check failed");
            HttpResponse::ServiceUnavailable().json(json!({"status":"unavailable"}))
        }
    }
}
