use crate::{
    email::EmailClient,
    error::{ApiError, bad, unauthorized},
    google_auth::{GoogleClaims, GoogleVerifier},
};
use actix_web::{
    HttpRequest, HttpResponse,
    cookie::{Cookie, SameSite, time::Duration},
    http::StatusCode,
    web,
};
use argon2::{
    Argon2, PasswordHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString, rand_core::OsRng},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
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
    pub is_verified: bool,
    pub has_password: bool,
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

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

async fn create_auth_token(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    purpose: &str,
    lifetime: &str,
) -> Result<String, ApiError> {
    let token = random_token();
    sqlx::query(
        "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",
    )
    .bind(user_id)
    .bind(purpose)
    .execute(&mut **tx)
    .await?;
    // Lifetime is selected internally and never accepts request input.
    let interval = match lifetime {
        "24 hours" => "24 hours",
        _ => "1 hour",
    };
    sqlx::query("INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+$4::interval)")
        .bind(hash_token(&token))
        .bind(user_id)
        .bind(purpose)
        .bind(interval)
        .execute(&mut **tx)
        .await?;
    Ok(token)
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
    sqlx::query(
        "DELETE FROM auth_tokens WHERE expires_at<=now() OR used_at<now()-interval '7 days'",
    )
    .execute(pool)
    .await?;
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
    let user=sqlx::query_as::<_,User>("SELECT u.id,u.email,u.first_name,u.last_name,u.phone,u.role,u.is_verified,(u.password_hash IS NOT NULL) AS has_password FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active").bind(hash_token(token.value())).fetch_optional(pool).await?.ok_or_else(unauthorized)?;
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
    let token = random_token();
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
    email_client: web::Data<EmailClient>,
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
    let user=sqlx::query_as::<_,User>("INSERT INTO users(id,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email,first_name,last_name,phone,role,is_verified,true AS has_password").bind(id).bind(email).bind(hash).bind(first).bind(last).bind(role).fetch_one(&mut *tx).await?;
    if role == "agent" {
        sqlx::query("INSERT INTO agent_profiles(id,user_id) VALUES($1,$2)")
            .bind(Uuid::new_v4())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let verification = create_auth_token(&mut tx, id, "verify_email", "24 hours").await?;
    tx.commit().await?;
    if let Err(error) = email_client.verification(&user.email, &verification).await {
        tracing::warn!(%error, user_id=%user.id, "Verification email delivery failed");
    }
    sign_in(&pool, user).await
}
pub async fn login(
    pool: web::Data<PgPool>,
    body: web::Json<Credentials>,
) -> Result<HttpResponse, ApiError> {
    if body.password.len() > 128 {
        return Err(unauthorized());
    }
    let row = sqlx::query_as::<_, (Uuid, Option<String>)>(
        "SELECT id,password_hash FROM users WHERE email=$1 AND is_active",
    )
    .bind(body.email.trim().to_lowercase())
    .fetch_optional(pool.get_ref())
    .await?
    .ok_or_else(unauthorized)?;
    let valid = match row.1 {
        Some(hash) => password_valid(hash, body.password.clone()).await?,
        None => false,
    };
    if !valid {
        return Err(unauthorized());
    }
    let user = sqlx::query_as::<_, User>(
        "SELECT id,email,first_name,last_name,phone,role,is_verified,(password_hash IS NOT NULL) AS has_password FROM users WHERE id=$1",
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
        "UPDATE users SET first_name=$1,last_name=$2,phone=$3,updated_at=now() WHERE id=$4 RETURNING id,email,first_name,last_name,phone,role,is_verified,(password_hash IS NOT NULL) AS has_password",
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
    let existing: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
            .bind(user.id)
            .fetch_one(pool.get_ref())
            .await?;
    if let Some(hash) = existing
        && !password_valid(hash, body.current_password.clone()).await?
    {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
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

#[derive(Deserialize)]
pub struct GoogleCredential {
    credential: String,
    role: Option<String>,
}

fn names(claims: &GoogleClaims) -> (String, String) {
    let first = claims.given_name.trim();
    let last = claims.family_name.trim();
    if !first.is_empty() {
        return (
            first.chars().take(100).collect(),
            last.chars().take(100).collect(),
        );
    }
    let mut parts = claims.name.split_whitespace();
    let fallback = claims.email.split('@').next().unwrap_or("NOMA user");
    let first = parts.next().unwrap_or(fallback).chars().take(100).collect();
    let last = parts
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(100)
        .collect();
    (first, last)
}

pub async fn google_sign_in(
    pool: web::Data<PgPool>,
    verifier: web::Data<GoogleVerifier>,
    body: web::Json<GoogleCredential>,
) -> Result<HttpResponse, ApiError> {
    let claims = verifier.verify(&body.credential).await?;
    let role = body.role.as_deref().unwrap_or("user");
    if !["user", "agent"].contains(&role) {
        return Err(bad("Invalid account role"));
    }
    let email = claims.email.trim().to_lowercase();
    let mut tx = pool.begin().await?;
    let existing_identity = sqlx::query_as::<_, User>(
        "SELECT u.id,u.email,u.first_name,u.last_name,u.phone,u.role,u.is_verified,(u.password_hash IS NOT NULL) AS has_password FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.provider='google' AND i.subject=$1 AND u.is_active",
    )
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await?;
    let user = if let Some(user) = existing_identity {
        user
    } else if let Some(user) = sqlx::query_as::<_, User>(
        "UPDATE users SET is_verified=true,updated_at=now() WHERE email=$1 AND is_active RETURNING id,email,first_name,last_name,phone,role,is_verified,(password_hash IS NOT NULL) AS has_password",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?
    {
        let linked = sqlx::query_scalar::<_, String>(
            "SELECT subject FROM user_identities WHERE user_id=$1 AND provider='google'",
        )
        .bind(user.id)
        .fetch_optional(&mut *tx)
        .await?;
        match linked {
            Some(subject) if subject != claims.sub => {
                return Err(bad("This email is linked to a different Google account"));
            }
            Some(_) => {}
            None => {
                sqlx::query("INSERT INTO user_identities(id,user_id,provider,subject) VALUES($1,$2,'google',$3)")
                    .bind(Uuid::new_v4())
                    .bind(user.id)
                    .bind(&claims.sub)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        user
    } else {
        let id = Uuid::new_v4();
        let (first, last) = names(&claims);
        let user = sqlx::query_as::<_, User>(
            "INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_verified) VALUES($1,$2,NULL,$3,$4,$5,true) RETURNING id,email,first_name,last_name,phone,role,is_verified,false AS has_password",
        )
        .bind(id)
        .bind(&email)
        .bind(first)
        .bind(last)
        .bind(role)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO user_identities(id,user_id,provider,subject) VALUES($1,$2,'google',$3)")
            .bind(Uuid::new_v4())
            .bind(id)
            .bind(&claims.sub)
            .execute(&mut *tx)
            .await?;
        if role == "agent" {
            sqlx::query("INSERT INTO agent_profiles(id,user_id) VALUES($1,$2)")
                .bind(Uuid::new_v4())
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        user
    };
    tx.commit().await?;
    sign_in(&pool, user).await
}

#[derive(Serialize)]
struct Providers<'a> {
    google_client_id: Option<&'a str>,
    email: bool,
}

pub async fn providers(
    verifier: web::Data<GoogleVerifier>,
    email: web::Data<EmailClient>,
) -> HttpResponse {
    HttpResponse::Ok().json(Providers {
        google_client_id: verifier.client_id(),
        email: email.configured(),
    })
}

#[derive(Deserialize)]
pub struct EmailRequest {
    email: String,
}

pub async fn request_password_reset(
    pool: web::Data<PgPool>,
    email_client: web::Data<EmailClient>,
    body: web::Json<EmailRequest>,
) -> Result<HttpResponse, ApiError> {
    let email = body.email.trim().to_lowercase();
    if email.len() <= 254
        && email.contains('@')
        && let Some(id) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE email=$1 AND is_active AND password_hash IS NOT NULL",
        )
        .bind(&email)
        .fetch_optional(pool.get_ref())
        .await?
    {
        let mut tx = pool.begin().await?;
        let token = create_auth_token(&mut tx, id, "reset_password", "1 hour").await?;
        tx.commit().await?;
        if let Err(error) = email_client.password_reset(&email, &token).await {
            tracing::warn!(%error, user_id=%id, "Password reset email delivery failed");
        }
    }
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct TokenBody {
    token: String,
}

pub async fn verify_email(
    pool: web::Data<PgPool>,
    body: web::Json<TokenBody>,
) -> Result<HttpResponse, ApiError> {
    let mut tx = pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND purpose='verify_email' AND used_at IS NULL AND expires_at>now() RETURNING user_id",
    )
    .bind(hash_token(&body.token))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| bad("This verification link is invalid or has expired"))?;
    sqlx::query("UPDATE users SET is_verified=true,updated_at=now() WHERE id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn resend_verification(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    email_client: web::Data<EmailClient>,
) -> Result<HttpResponse, ApiError> {
    let user = current(&req, &pool).await?;
    if !user.is_verified {
        let mut tx = pool.begin().await?;
        let token = create_auth_token(&mut tx, user.id, "verify_email", "24 hours").await?;
        tx.commit().await?;
        if let Err(error) = email_client.verification(&user.email, &token).await {
            tracing::warn!(%error, user_id=%user.id, "Verification email delivery failed");
            return Err(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "We could not send the verification email. Please try again shortly.",
            ));
        }
    }
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct PasswordReset {
    token: String,
    new_password: String,
}

pub async fn reset_password(
    pool: web::Data<PgPool>,
    body: web::Json<PasswordReset>,
) -> Result<HttpResponse, ApiError> {
    if !(12..=128).contains(&body.new_password.len()) {
        return Err(bad("Password must contain 12–128 characters"));
    }
    let replacement = password_hash(body.new_password.clone()).await?;
    let mut tx = pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND purpose='reset_password' AND used_at IS NULL AND expires_at>now() RETURNING user_id",
    )
    .bind(hash_token(&body.token))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| bad("This password reset link is invalid or has expired"))?;
    sqlx::query("UPDATE users SET password_hash=$1,is_verified=true,updated_at=now() WHERE id=$2")
        .bind(replacement)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
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
    cfg.route("/auth/providers", web::get().to(providers))
        .route("/auth/register", web::post().to(register))
        .route("/auth/login", web::post().to(login))
        .route("/auth/google", web::post().to(google_sign_in))
        .route("/auth/verify-email", web::post().to(verify_email))
        .route(
            "/auth/verify-email/resend",
            web::post().to(resend_verification),
        )
        .route(
            "/auth/password/forgot",
            web::post().to(request_password_reset),
        )
        .route("/auth/password/reset", web::post().to(reset_password))
        .route("/auth/me", web::get().to(me))
        .route("/auth/logout", web::post().to(logout))
        .route("/account/profile", web::put().to(update_profile))
        .route("/account/password", web::put().to(change_password));
}
