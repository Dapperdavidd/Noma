use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn agent(req: &HttpRequest, pool: &PgPool) -> Result<auth::User, ApiError> {
    let user = auth::current(req, pool).await?;
    if !["agent", "admin"].contains(&user.role.as_str()) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "An agent account is required",
        ));
    }
    Ok(user)
}

pub async fn profile(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let user = agent(&req, &pool).await?;
    let data: Value =
        sqlx::query_scalar("SELECT to_jsonb(a) FROM agent_profiles a WHERE user_id=$1")
            .bind(user.id)
            .fetch_one(pool.get_ref())
            .await?;
    Ok(HttpResponse::Ok().json(data))
}

pub async fn public_profile(
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let data: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',u.id,'first_name',u.first_name,'last_name',u.last_name,
            'agency_name',a.agency_name,'bio',a.bio,'profile_image_url',a.profile_image_url,
            'license_number',a.license_number,'years_experience',a.years_experience,
            'service_areas',a.service_areas,'website_url',a.website_url,
            'verification_status',a.verification_status,
            'rating',COALESCE((SELECT round(avg(r.rating)::numeric,1) FROM agent_reviews r WHERE r.agent_id=u.id),0),
            'review_count',(SELECT count(*) FROM agent_reviews r WHERE r.agent_id=u.id),
            'completed_inspections',(SELECT count(*) FROM inspections i WHERE i.agent_id=u.id AND i.status='completed'),
            'active_properties',(SELECT count(*) FROM properties p WHERE p.agent_id=u.id AND p.status='active'),
            'member_since',u.created_at,
            'reviews',COALESCE((SELECT jsonb_agg(recent.review ORDER BY recent.created_at DESC) FROM (
                SELECT jsonb_build_object(
                    'id',r.id,'rating',r.rating,'communication',r.communication,
                    'punctuality',r.punctuality,'property_accuracy',r.property_accuracy,
                    'professionalism',r.professionalism,'comment',r.comment,'created_at',r.created_at,
                    'reviewer_name',reviewer.first_name || ' ' || left(reviewer.last_name,1) || '.'
                ) AS review,r.created_at
                FROM agent_reviews r JOIN users reviewer ON reviewer.id=r.reviewer_id
                WHERE r.agent_id=u.id ORDER BY r.created_at DESC LIMIT 20
            ) recent),'[]'::jsonb)
        )
        FROM users u JOIN agent_profiles a ON a.user_id=u.id
        WHERE u.id=$1 AND u.role='agent' AND u.is_active",
    )
    .bind(*id)
    .fetch_optional(pool.get_ref())
    .await?;
    let data = data.ok_or(ApiError(StatusCode::NOT_FOUND, "Agent profile not found"))?;
    Ok(HttpResponse::Ok().json(data))
}

#[derive(Deserialize)]
pub struct Profile {
    agency_name: String,
    bio: String,
    license_number: Option<String>,
    years_experience: Option<i16>,
    service_areas: Option<Vec<String>>,
    website_url: Option<String>,
    profile_image_url: Option<String>,
}

fn optional(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub async fn update(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<Profile>,
) -> Result<HttpResponse, ApiError> {
    let user = agent(&req, &pool).await?;
    let service_areas: Vec<String> = body
        .service_areas
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|area| area.trim().to_owned())
        .filter(|area| !area.is_empty())
        .collect();
    if body.agency_name.len() > 200
        || body.bio.len() > 3000
        || body
            .license_number
            .as_deref()
            .is_some_and(|v| v.len() > 120)
        || body
            .years_experience
            .is_some_and(|years| !(0..=80).contains(&years))
        || service_areas.len() > 12
        || service_areas.iter().any(|area| area.len() > 100)
        || body
            .website_url
            .as_deref()
            .is_some_and(|url| !url.is_empty() && (!url.starts_with("https://") || url.len() > 500))
        || body.profile_image_url.as_deref().is_some_and(|url| {
            !url.is_empty() && (!url.starts_with("https://") || url.len() > 2000)
        })
    {
        return Err(bad(
            "Review the profile lengths, links, experience and service areas",
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE agent_verification_applications SET status='withdrawn',reviewed_at=now()
         WHERE agent_id=$1 AND status='pending'",
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO agent_profiles(
            id,user_id,agency_name,bio,license_number,years_experience,
            service_areas,website_url,profile_image_url,verification_status
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'unsubmitted')
         ON CONFLICT(user_id) DO UPDATE SET
            agency_name=EXCLUDED.agency_name,bio=EXCLUDED.bio,
            license_number=EXCLUDED.license_number,
            years_experience=EXCLUDED.years_experience,
            service_areas=EXCLUDED.service_areas,
            website_url=EXCLUDED.website_url,
            profile_image_url=EXCLUDED.profile_image_url,
            verification_status='unsubmitted',verification_requested_at=NULL,updated_at=now()",
    )
    .bind(Uuid::new_v4())
    .bind(user.id)
    .bind(body.agency_name.trim())
    .bind(body.bio.trim())
    .bind(optional(&body.license_number))
    .bind(body.years_experience)
    .bind(&service_areas)
    .bind(optional(&body.website_url))
    .bind(optional(&body.profile_image_url))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct VerificationDeclaration {
    declaration: bool,
}

pub async fn submit_verification(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<VerificationDeclaration>,
) -> Result<HttpResponse, ApiError> {
    let user = agent(&req, &pool).await?;
    if !body.declaration {
        return Err(bad("Accept the professional declaration to continue"));
    }
    let mut tx = pool.begin().await?;
    let profile: Option<Value> =
        sqlx::query_scalar("SELECT to_jsonb(a) FROM agent_profiles a WHERE user_id=$1 FOR UPDATE")
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await?;
    let profile = profile.ok_or_else(|| bad("Complete your agent profile first"))?;
    let complete = profile["agency_name"]
        .as_str()
        .is_some_and(|value| !value.trim().is_empty())
        && profile["bio"]
            .as_str()
            .is_some_and(|value| value.trim().len() >= 40)
        && profile["years_experience"].as_i64().is_some()
        && profile["service_areas"]
            .as_array()
            .is_some_and(|areas| !areas.is_empty());
    if !complete {
        return Err(bad(
            "Add an agency name, a detailed bio, experience and service areas before applying",
        ));
    }
    sqlx::query(
        "INSERT INTO agent_verification_applications(
            id,agent_id,profile_snapshot,declaration_accepted_at
         ) VALUES($1,$2,$3,now())",
    )
    .bind(Uuid::new_v4())
    .bind(user.id)
    .bind(profile)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE agent_profiles SET verification_status='pending',verification_requested_at=now(),updated_at=now() WHERE user_id=$1",
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(HttpResponse::Created().json(json!({"status":"pending"})))
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/agent/profile", web::get().to(profile))
        .route("/agent/profile", web::put().to(update))
        .route("/agent/verification", web::post().to(submit_verification))
        .route("/agents/{id}", web::get().to(public_profile));
}
