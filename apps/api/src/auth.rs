use crate::error::{ApiError, bad, unauthorized};
use actix_web::{
    HttpRequest, HttpResponse,
    cookie::{Cookie, SameSite, time::Duration},
    web,
};
use argon2::{
    Argon2, PasswordHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString, rand_core::OsRng},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;
#[derive(Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
}
#[derive(Deserialize)]
pub struct Credentials {
    email: String,
    password: String,
    first_name: Option<String>,
    last_name: Option<String>,
    role: Option<String>,
}
fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub async fn current(req: &HttpRequest, pool: &PgPool) -> Result<User, ApiError> {
    let token = req.cookie("noma_session").ok_or_else(unauthorized)?;
    let user=sqlx::query_as::<_,User>("SELECT u.id,u.email,u.first_name,u.last_name,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active").bind(hash_token(token.value())).fetch_optional(pool).await?.ok_or_else(unauthorized)?;
    Ok(user)
}
fn session_cookie(token: String) -> Cookie<'static> {
    Cookie::build("noma_session", token)
        .path("/")
        .http_only(true)
        .secure(std::env::var("COOKIE_SECURE").as_deref() != Ok("false"))
        .same_site(SameSite::Strict)
        .max_age(Duration::days(7))
        .finish()
}
async fn sign_in(pool: &PgPool, user: User) -> Result<HttpResponse, ApiError> {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    sqlx::query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    )
    .bind(hash_token(&token))
    .bind(user.id)
    .execute(pool)
    .await?;
    Ok(HttpResponse::Ok().cookie(session_cookie(token)).json(user))
}
pub async fn register(
    pool: web::Data<PgPool>,
    body: web::Json<Credentials>,
) -> Result<HttpResponse, ApiError> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@')
        || email.len() > 254
        || body.password.len() < 12
        || body.password.len() > 128
    {
        return Err(bad("Use a valid email and a password of 12–128 characters"));
    }
    let first = body.first_name.as_deref().unwrap_or("").trim();
    let last = body.last_name.as_deref().unwrap_or("").trim();
    if first.is_empty() || last.is_empty() || first.len() > 100 || last.len() > 100 {
        return Err(bad(
            "First and last names are required (maximum 100 characters)",
        ));
    }
    let role = body.role.as_deref().unwrap_or("user");
    if !["user", "agent"].contains(&role) {
        return Err(bad("Invalid account role"));
    }
    let password = body.password.clone();
    let hash = web::block(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(|_| bad("Unable to register"))?
    .map_err(|_| bad("Unable to register"))?;
    let mut tx = pool.begin().await?;
    let id = Uuid::new_v4();
    let user=sqlx::query_as::<_,User>("INSERT INTO users(id,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email,first_name,last_name,role").bind(id).bind(email).bind(hash).bind(first).bind(last).bind(role).fetch_one(&mut *tx).await?;
    if role == "agent" {
        sqlx::query("INSERT INTO agent_profiles(id,user_id) VALUES($1,$2)")
            .bind(Uuid::new_v4())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    sign_in(&pool, user).await
}
pub async fn login(
    pool: web::Data<PgPool>,
    body: web::Json<Credentials>,
) -> Result<HttpResponse, ApiError> {
    if body.password.len() > 128 {
        return Err(unauthorized());
    }
    let row = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id,password_hash FROM users WHERE email=$1 AND is_active",
    )
    .bind(body.email.trim().to_lowercase())
    .fetch_optional(pool.get_ref())
    .await?
    .ok_or_else(unauthorized)?;
    let password = body.password.clone();
    let valid = web::block(move || {
        PasswordHash::new(&row.1)
            .map(|h| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &h)
                    .is_ok()
            })
            .unwrap_or(false)
    })
    .await
    .map_err(|_| unauthorized())?;
    if !valid {
        return Err(unauthorized());
    }
    let user = sqlx::query_as::<_, User>(
        "SELECT id,email,first_name,last_name,role FROM users WHERE id=$1",
    )
    .bind(row.0)
    .fetch_one(pool.get_ref())
    .await?;
    sign_in(&pool, user).await
}
pub async fn me(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(current(&req, &pool).await?))
}
pub async fn logout(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    if let Some(cookie) = req.cookie("noma_session") {
        sqlx::query("DELETE FROM sessions WHERE token_hash=$1")
            .bind(hash_token(cookie.value()))
            .execute(pool.get_ref())
            .await?;
    }
    let mut cookie = session_cookie(String::new());
    cookie.make_removal();
    Ok(HttpResponse::NoContent().cookie(cookie).finish())
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/auth/register", web::post().to(register))
        .route("/auth/login", web::post().to(login))
        .route("/auth/me", web::get().to(me))
        .route("/auth/logout", web::post().to(logout));
}
