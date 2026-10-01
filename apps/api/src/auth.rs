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

const SESSION_CLEANUP_BATCH: u64 = 1_000;
const SESSION_CLEANUP_BATCHES: usize = 10;
#[derive(Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
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

async fn password_hash(password: String) -> Result<String, ApiError> {
    web::block(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
    })
    .await
    .map_err(|_| bad("Unable to secure password"))?
    .map_err(|_| bad("Unable to secure password"))
}

async fn password_valid(hash: String, password: String) -> Result<bool, ApiError> {
    web::block(move || {
        PasswordHash::new(&hash)
            .map(|parsed| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .is_ok()
            })
            .unwrap_or(false)
    })
    .await
    .map_err(|_| unauthorized())
}

async fn cleanup_expired_sessions(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut deleted = 0;
    for _ in 0..SESSION_CLEANUP_BATCHES {
        let result = sqlx::query(
            "WITH expired AS (SELECT token_hash FROM sessions WHERE expires_at<=now() ORDER BY expires_at LIMIT $1) DELETE FROM sessions s USING expired WHERE s.token_hash=expired.token_hash",
        )
        .bind(SESSION_CLEANUP_BATCH as i64)
        .execute(pool)
        .await?;
        deleted += result.rows_affected();
        if result.rows_affected() < SESSION_CLEANUP_BATCH {
            break;
        }
    }
    Ok(deleted)
}

pub fn spawn_session_cleanup(pool: PgPool) {
    actix_web::rt::spawn(async move {
        let mut schedule = actix_web::rt::time::interval(std::time::Duration::from_secs(60 * 60));
        loop {
            schedule.tick().await;
            match cleanup_expired_sessions(&pool).await {
                Ok(deleted) if deleted > 0 => {
                    tracing::info!(deleted, "Expired sessions removed")
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "Expired session cleanup failed"),
            }
        }
    });
}

pub async fn current(req: &HttpRequest, pool: &PgPool) -> Result<User, ApiError> {
    let token = req.cookie("noma_session").ok_or_else(unauthorized)?;
    let user=sqlx::query_as::<_,User>("SELECT u.id,u.email,u.first_name,u.last_name,u.phone,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active").bind(hash_token(token.value())).fetch_optional(pool).await?.ok_or_else(unauthorized)?;
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
    let hash = password_hash(body.password.clone()).await?;
    let mut tx = pool.begin().await?;
    let id = Uuid::new_v4();
    let user=sqlx::query_as::<_,User>("INSERT INTO users(id,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email,first_name,last_name,phone,role").bind(id).bind(email).bind(hash).bind(first).bind(last).bind(role).fetch_one(&mut *tx).await?;
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
    let valid = password_valid(row.1, body.password.clone()).await?;
    if !valid {
        return Err(unauthorized());
    }
    let user = sqlx::query_as::<_, User>(
        "SELECT id,email,first_name,last_name,phone,role FROM users WHERE id=$1",
    )
    .bind(row.0)
    .fetch_one(pool.get_ref())
    .await?;
    sign_in(&pool, user).await
}
pub async fn me(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(current(&req, &pool).await?))
}

#[derive(Deserialize)]
pub struct AccountProfile {
    first_name: String,
    last_name: String,
    phone: Option<String>,
}

pub async fn update_profile(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<AccountProfile>,
) -> Result<HttpResponse, ApiError> {
    let user = current(&req, &pool).await?;
    let first = body.first_name.trim();
    let last = body.last_name.trim();
    if first.is_empty() || last.is_empty() || first.len() > 100 || last.len() > 100 {
        return Err(bad(
            "First and last names are required (maximum 100 characters)",
        ));
    }
    let phone = body
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = phone {
        let digits = value
            .chars()
            .filter(|character| character.is_ascii_digit())
            .count();
        if !(7..=15).contains(&digits)
            || value.len() > 30
            || !value
                .chars()
                .all(|character| character.is_ascii_digit() || "+ -()".contains(character))
        {
            return Err(bad("Use a valid phone number"));
        }
    }
    let updated = sqlx::query_as::<_, User>(
        "UPDATE users SET first_name=$1,last_name=$2,phone=$3,updated_at=now() WHERE id=$4 RETURNING id,email,first_name,last_name,phone,role",
    )
    .bind(first)
    .bind(last)
    .bind(phone)
    .bind(user.id)
    .fetch_one(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(updated))
}

#[derive(Deserialize)]
pub struct PasswordChange {
    current_password: String,
    new_password: String,
}

pub async fn change_password(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<PasswordChange>,
) -> Result<HttpResponse, ApiError> {
    let user = current(&req, &pool).await?;
    if !(12..=128).contains(&body.new_password.len()) {
        return Err(bad("New password must contain 12–128 characters"));
    }
    if body.current_password == body.new_password {
        return Err(bad("Choose a password you have not already used"));
    }
    let existing: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(user.id)
        .fetch_one(pool.get_ref())
        .await?;
    if !password_valid(existing, body.current_password.clone()).await? {
        return Err(ApiError(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "Current password is incorrect",
        ));
    }
    let replacement = password_hash(body.new_password.clone()).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2")
        .bind(replacement)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let mut cookie = session_cookie(String::new());
    cookie.make_removal();
    Ok(HttpResponse::NoContent().cookie(cookie).finish())
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
        .route("/auth/logout", web::post().to(logout))
        .route("/account/profile", web::put().to(update_profile))
        .route("/account/password", web::put().to(change_password));
}
