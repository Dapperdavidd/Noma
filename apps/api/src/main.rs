mod auth;
mod community;
mod error;
mod properties;
use actix_web::{
    App, HttpResponse, HttpServer,
    dev::Service,
    middleware::{DefaultHeaders, Logger},
    web,
};
use sqlx::postgres::PgPoolOptions;
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let database = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&database)
        .await
        .expect("Cannot connect to PostgreSQL");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Database migrations failed");
    let origin = std::env::var("WEB_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into());
    let bind = std::env::var("API_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    tracing::info!(%bind,"NOMA API starting");
    HttpServer::new(move || {
        let allowed = origin.clone();
        App::new()
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::JsonConfig::default().limit(64 * 1024))
            .wrap(Logger::default())
            .wrap(
                DefaultHeaders::new()
                    .add(("X-Content-Type-Options", "nosniff"))
                    .add(("Cache-Control", "no-store")),
            )
            .wrap(
                actix_cors::Cors::default()
                    .allowed_origin(&origin)
                    .allowed_methods(vec!["GET", "POST", "PUT", "PATCH", "DELETE"])
                    .allowed_headers(vec!["Content-Type"])
                    .supports_credentials(),
            )
            .wrap_fn(move |req, srv| {
                let safe = matches!(
                    *req.method(),
                    actix_web::http::Method::GET
                        | actix_web::http::Method::HEAD
                        | actix_web::http::Method::OPTIONS
                );
                let valid = safe
                    || req
                        .headers()
                        .get("origin")
                        .and_then(|v| v.to_str().ok())
                        .is_some_and(|v| v == allowed);
                let future = if valid { Some(srv.call(req)) } else { None };
                async move {
                    match future {
                        Some(f) => f.await,
                        None => Err(actix_web::error::ErrorForbidden("Invalid request origin")),
                    }
                }
            })
            .route(
                "/health",
                web::get()
                    .to(|| async { HttpResponse::Ok().json(serde_json::json!({"status":"ok"})) }),
            )
            .service(
                web::scope("/api/v1")
                    .configure(auth::routes)
                    .configure(properties::routes)
                    .configure(community::routes),
            )
    })
    .bind(bind)?
    .run()
    .await
}
