use crate::{
    auth,
    error::{ApiError, bad},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct InspectionRequest {
    proposed_at: DateTime<Utc>,
    note: String,
}

pub async fn create(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    property_id: web::Path<Uuid>,
    body: web::Json<InspectionRequest>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !(10..=1000).contains(&body.note.trim().len()) {
        return Err(bad("Inspection note must contain 10–1,000 characters"));
    }
    if body.proposed_at <= Utc::now() || body.proposed_at > Utc::now() + chrono::Duration::days(180)
    {
        return Err(bad("Choose an inspection time within the next 180 days"));
    }
    let agent_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT p.agent_id FROM properties p JOIN users u ON u.id=p.agent_id WHERE p.id=$1 AND p.status='active' AND u.role='agent' AND p.agent_id<>$2",
    )
    .bind(*property_id)
    .bind(user.id)
    .fetch_optional(pool.get_ref())
    .await?;
    let agent_id = agent_id.ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "Inspections can only be requested for an active agent listing",
    ))?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO inspections(id,property_id,seeker_id,agent_id,proposed_at,note) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id)
        .bind(*property_id)
        .bind(user.id)
        .bind(agent_id)
        .bind(body.proposed_at)
        .bind(body.note.trim())
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::Created().json(json!({"id": id})))
}

pub async fn mine(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let data: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',i.id,'status',i.status,'proposed_at',i.proposed_at,'note',i.note,
            'created_at',i.created_at,'role',CASE WHEN i.agent_id=$1 THEN 'host' ELSE 'guest' END,
            'property',jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug),
            'other_party',CASE WHEN i.agent_id=$1
                THEN jsonb_build_object('id',seeker.id,'name',seeker.first_name || ' ' || seeker.last_name)
                ELSE jsonb_build_object('id',agent.id,'name',agent.first_name || ' ' || agent.last_name) END,
            'reviewed',EXISTS(SELECT 1 FROM agent_reviews r WHERE r.inspection_id=i.id)
        )
        FROM inspections i
        JOIN properties p ON p.id=i.property_id
        JOIN users seeker ON seeker.id=i.seeker_id
        JOIN users agent ON agent.id=i.agent_id
        WHERE i.agent_id=$1 OR i.seeker_id=$1
        ORDER BY i.created_at DESC LIMIT 100",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(data))
}

#[derive(Deserialize)]
pub struct InspectionStatus {
    status: String,
}

pub async fn update(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<InspectionStatus>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let mut tx = pool.begin().await?;
    let row: Option<(Uuid, Uuid, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT agent_id,seeker_id,status,proposed_at FROM inspections WHERE id=$1 FOR UPDATE",
    )
    .bind(*id)
    .fetch_optional(&mut *tx)
    .await?;
    let (agent_id, seeker_id, current, proposed_at) = row.ok_or(ApiError(
        StatusCode::NOT_FOUND,
        "Inspection request not found",
    ))?;
    let allowed = if user.id == agent_id {
        matches!(
            (current.as_str(), body.status.as_str()),
            ("requested", "confirmed")
                | ("requested", "cancelled")
                | ("confirmed", "completed")
                | ("confirmed", "cancelled")
        )
    } else if user.id == seeker_id {
        matches!(
            (current.as_str(), body.status.as_str()),
            ("requested", "cancelled") | ("confirmed", "cancelled")
        )
    } else {
        false
    };
    if !allowed {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "This inspection status change is not allowed",
        ));
    }
    if body.status == "completed" && proposed_at > Utc::now() {
        return Err(bad(
            "An inspection can only be completed after its scheduled time",
        ));
    }
    sqlx::query("UPDATE inspections SET status=$1,updated_at=now() WHERE id=$2")
        .bind(&body.status)
        .bind(*id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct Review {
    rating: i16,
    communication: i16,
    punctuality: i16,
    property_accuracy: i16,
    professionalism: i16,
    comment: String,
}

pub async fn review(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Review>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let scores = [
        body.rating,
        body.communication,
        body.punctuality,
        body.property_accuracy,
        body.professionalism,
    ];
    if scores.iter().any(|score| !(1..=5).contains(score))
        || !(10..=1500).contains(&body.comment.trim().len())
    {
        return Err(bad(
            "Ratings must be 1–5 and the review must contain 10–1,500 characters",
        ));
    }
    let agent_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT agent_id FROM inspections WHERE id=$1 AND seeker_id=$2 AND status='completed'",
    )
    .bind(*id)
    .bind(user.id)
    .fetch_optional(pool.get_ref())
    .await?;
    let agent_id = agent_id.ok_or(ApiError(
        StatusCode::FORBIDDEN,
        "Only the customer from a completed inspection can review this agent",
    ))?;
    sqlx::query("INSERT INTO agent_reviews(id,inspection_id,agent_id,reviewer_id,rating,communication,punctuality,property_accuracy,professionalism,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(Uuid::new_v4())
        .bind(*id)
        .bind(agent_id)
        .bind(user.id)
        .bind(body.rating)
        .bind(body.communication)
        .bind(body.punctuality)
        .bind(body.property_accuracy)
        .bind(body.professionalism)
        .bind(body.comment.trim())
        .execute(pool.get_ref())
        .await?;
    Ok(HttpResponse::Created().finish())
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/properties/{id}/inspections", web::post().to(create))
        .route("/dashboard/inspections", web::get().to(mine))
        .route("/inspections/{id}", web::patch().to(update))
        .route("/inspections/{id}/review", web::post().to(review));
}
