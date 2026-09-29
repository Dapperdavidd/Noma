mod dto;
mod handlers;
pub(crate) mod repository;
use actix_web::web;
use handlers::*;
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/properties", web::get().to(list))
        .route("/properties", web::post().to(save))
        .route("/properties/{id}", web::put().to(save))
        .route("/properties/{id}/status", web::patch().to(status))
        .route("/properties/{id}", web::get().to(detail))
        .route("/dashboard/properties", web::get().to(mine));
}
