use crate::{
    auth,
    email::EmailClient,
    error::{ApiError, bad},
    notifications,
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
    email: web::Data<EmailClient>,
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
    let listing: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT p.agent_id,p.title FROM properties p JOIN users u ON u.id=p.agent_id WHERE p.id=$1 AND p.status='active' AND u.role='agent' AND p.agent_id<>$2",
    )
    .bind(*property_id)
    .bind(user.id)
    .fetch_optional(pool.get_ref())
    .await?;
    let (agent_id, property_title) = listing.ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "Inspections can only be requested for an active agent listing",
    ))?;
    let id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO inspections(id,property_id,seeker_id,agent_id,proposed_at,note) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id)
        .bind(*property_id)
        .bind(user.id)
        .bind(agent_id)
        .bind(body.proposed_at)
        .bind(body.note.trim())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO notifications(id,user_id,kind,title,body,href)
         VALUES($1,$2,'inspection_requested','New inspection request',$3,'/dashboard?tab=inspections')",
    )
    .bind(Uuid::new_v4())
    .bind(agent_id)
    .bind(format!(
        "{} {} requested an inspection for {property_title}",
        user.first_name, user.last_name
    ))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if email.configured()
        && let Some(address) = notifications::activity_email(&pool, agent_id).await?
        && let Err(error) = email
            .activity(
                &address,
                "New NOMA inspection request",
                "A customer requested an inspection",
                &format!(
                    "{} {} requested an inspection for {property_title}.",
                    user.first_name, user.last_name
                ),
                "/dashboard?tab=inspections",
            )
            .await
    {
        tracing::warn!(%error, user_id=%agent_id, "Unable to deliver inspection-request email");
    }
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
    email: web::Data<EmailClient>,
    id: web::Path<Uuid>,
    body: web::Json<InspectionStatus>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let mut tx = pool.begin().await?;
    let row: Option<(Uuid, Uuid, String, DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT i.agent_id,i.seeker_id,i.status,i.proposed_at,p.title
         FROM inspections i JOIN properties p ON p.id=i.property_id
         WHERE i.id=$1 FOR UPDATE OF i",
    )
    .bind(*id)
    .fetch_optional(&mut *tx)
    .await?;
    let (agent_id, seeker_id, current, proposed_at, property_title) = row.ok_or(ApiError(
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
    let recipient = if user.id == agent_id {
        seeker_id
    } else {
        agent_id
    };
    sqlx::query(
        "INSERT INTO notifications(id,user_id,kind,title,body,href)
         VALUES($1,$2,'inspection_updated','Inspection updated',$3,'/dashboard?tab=inspections')",
    )
    .bind(Uuid::new_v4())
    .bind(recipient)
    .bind(format!(
        "The inspection for {property_title} is now {}",
        body.status
    ))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if email.configured()
        && let Some(address) = notifications::activity_email(&pool, recipient).await?
        && let Err(error) = email
            .activity(
                &address,
                "Your NOMA inspection was updated",
                "Inspection status updated",
                &format!(
                    "The inspection for {property_title} is now {}.",
                    body.status
                ),
                "/dashboard?tab=inspections",
            )
            .await
    {
        tracing::warn!(%error, user_id=%recipient, "Unable to deliver inspection-status email");
    }
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
    email: web::Data<EmailClient>,
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
    let mut tx = pool.begin().await?;
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
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO notifications(id,user_id,kind,title,body,href)
         VALUES($1,$2,'review_received','New customer review',$3,$4)",
    )
    .bind(Uuid::new_v4())
    .bind(agent_id)
    .bind(format!("You received a {}-star review", body.rating))
    .bind(format!("/agents/{agent_id}"))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if email.configured()
        && let Some(address) = notifications::activity_email(&pool, agent_id).await?
        && let Err(error) = email
            .activity(
                &address,
                "New review on your NOMA profile",
                "A customer reviewed your inspection",
                &format!("You received a {}-star review.", body.rating),
                &format!("/agents/{agent_id}"),
            )
            .await
    {
        tracing::warn!(%error, user_id=%agent_id, "Unable to deliver review email");
    }
    Ok(HttpResponse::Created().finish())
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/properties/{id}/inspections", web::post().to(create))
        .route("/dashboard/inspections", web::get().to(mine))
        .route("/inspections/{id}", web::patch().to(update))
        .route("/inspections/{id}/review", web::post().to(review));
}
