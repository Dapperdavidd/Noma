use super::{
    dto::{Listing, Search, Status},
    repository,
};
use crate::{auth, error::ApiError, pagination::Page};
use actix_web::{HttpRequest, HttpResponse, web};
use sqlx::PgPool;
use uuid::Uuid;
pub async fn list(
    pool: web::Data<PgPool>,
    query: web::Query<Search>,
) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(repository::search(&pool, &query).await?))
}
pub async fn detail(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    slug: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let owner = auth::current(&req, &pool).await.ok();
    Ok(
        HttpResponse::Ok()
            .json(repository::detail(&pool, slug.into_inner(), owner.as_ref()).await?),
    )
}
pub async fn create(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<Listing>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    Ok(HttpResponse::Ok().json(repository::save(&pool, &user, None, &body).await?))
}
pub async fn update(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Listing>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    Ok(HttpResponse::Ok().json(repository::save(&pool, &user, Some(*id), &body).await?))
}
pub async fn status(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Status>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    repository::transition(&pool, &user, *id, &body).await?;
    Ok(HttpResponse::NoContent().finish())
}
pub async fn mine(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    page: web::Query<Page>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    Ok(HttpResponse::Ok().json(repository::mine(&pool, user.id, &page).await?))
}
