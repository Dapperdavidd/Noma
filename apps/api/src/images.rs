use crate::{auth, error::ApiError};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;
fn setting(key: &str) -> Result<String, ApiError> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Photo uploads are not connected yet. Please use an HTTPS image link.",
        ))
}
fn sign(parameters: &str, secret: &str) -> String {
    hex::encode(Sha256::digest(format!("{parameters}{secret}").as_bytes()))
}
/// Cloudinary signs a canonical, alphabetically ordered parameter string.
/// https://cloudinary.com/documentation/authentication_signatures
pub async fn signature(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !["agent", "admin"].contains(&user.role.as_str()) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "An agent account is required",
        ));
    }
    let cloud = setting("CLOUDINARY_CLOUD_NAME")?;
    let key = setting("CLOUDINARY_API_KEY")?;
    let secret = setting("CLOUDINARY_API_SECRET")?;
    // A signed preset must restrict accepted formats and maximum file size at the provider.
    let preset = setting("CLOUDINARY_UPLOAD_PRESET")?;
    let public_id = format!("noma/{}/{}", user.id, Uuid::new_v4());
    let timestamp = chrono::Utc::now().timestamp();
    let parameters = format!(
        "overwrite=false&public_id={public_id}&timestamp={timestamp}&upload_preset={preset}"
    );
    Ok(HttpResponse::Ok().json(json!({"cloud_name":cloud,"api_key":key,"timestamp":timestamp,"public_id":public_id,"overwrite":false,"upload_preset":preset,"signature":sign(&parameters,&secret)})))
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/images/signature", web::post().to(signature));
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signatures_are_deterministic_and_secret_dependent() {
        let a = sign("timestamp=123", "secret");
        assert_eq!(a.len(), 64);
        assert_eq!(a, sign("timestamp=123", "secret"));
        assert_ne!(a, sign("timestamp=123", "other"));
    }
}
