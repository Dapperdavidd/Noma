use actix_web::{HttpResponse, ResponseError, http::StatusCode};
use serde_json::json;
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub &'static str);
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.1)
    }
}
impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        self.0
    }
    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.0).json(json!({"error":self.1}))
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error=%e,"database operation failed");
        match &e {
            sqlx::Error::RowNotFound => Self(StatusCode::NOT_FOUND, "Not found"),
            sqlx::Error::Database(d) if d.is_unique_violation() => {
                Self(StatusCode::CONFLICT, "This record already exists")
            }
            _ => Self(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to complete request",
            ),
        }
    }
}
pub fn bad(message: &'static str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message)
}
pub fn unauthorized() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Please sign in")
}
