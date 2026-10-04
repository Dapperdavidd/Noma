use crate::{
    auth,
    error::{ApiError, bad},
    pagination::{Page, cursor},
};
use actix_web::{HttpRequest, HttpResponse, http::StatusCode, web};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;
async fn admin(req: &HttpRequest, pool: &PgPool) -> Result<auth::User, ApiError> {
    let user = auth::current(req, pool).await?;
    if user.role != "admin" {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Administrator access is required",
        ));
    }
    Ok(user)
}

pub async fn metrics(req: HttpRequest, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    admin(&req, &pool).await?;
    let data: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'total_users',(SELECT count(*) FROM users WHERE is_active),
          'active_users',(SELECT count(DISTINCT user_id) FROM sessions WHERE expires_at>now()),
          'property_seekers',(SELECT count(*) FROM users WHERE is_active AND role='user'),
          'new_users_today',(SELECT count(*) FROM users WHERE created_at>=current_date),
          'total_properties',(SELECT count(*) FROM properties),
          'published_properties',(SELECT count(*) FROM properties WHERE status='active'),
          'properties_updated_today',(SELECT count(*) FROM properties WHERE updated_at>=current_date),
          'photos_uploaded_today',(SELECT count(*) FROM image_uploads WHERE resource_type='image' AND created_at>=current_date),
          'videos_uploaded_today',(SELECT count(*) FROM image_uploads WHERE resource_type='video' AND created_at>=current_date),
          'open_reports',(SELECT count(*) FROM property_reports WHERE status='open'))",
    )
    .fetch_one(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(data))
}
fn paged(mut data: Vec<Value>, limit: i64) -> Value {
    let more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let next_cursor = if more {
        data.last()
            .and_then(|item| Some(cursor(item["created_at"].as_str()?, item["id"].as_str()?)))
    } else {
        None
    };
    json!({"data":data,"next_cursor":next_cursor})
}

pub async fn queue(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    kind: web::Path<String>,
    page: web::Query<Page>,
) -> Result<HttpResponse, ApiError> {
    admin(&req, &pool).await?;
    let limit = page.limit();
    let cursor_value = page.decoded_cursor()?;
    let data: Vec<Value> = match kind.as_str() {
        "properties" => {
            let mut query: QueryBuilder<Postgres> =
                QueryBuilder::new(crate::properties::repository::CARD);
            query.push(" WHERE p.status IN ('active','suspended')");
            if let Some((created_at, id)) = cursor_value {
                query
                    .push(" AND (p.created_at,p.id)>(")
                    .push_bind(created_at)
                    .push(",")
                    .push_bind(id)
                    .push(")");
            }
            query
                .push(" ORDER BY p.created_at,p.id LIMIT ")
                .push_bind(limit + 1);
            query.build_query_scalar().fetch_all(pool.get_ref()).await?
        }
        "agents" => {
            let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
                "SELECT jsonb_build_object('id',a.user_id,'name',u.first_name || ' ' || u.last_name,'agency_name',a.agency_name,'verification_status',a.verification_status,'created_at',a.created_at) FROM agent_profiles a JOIN users u ON u.id=a.user_id WHERE a.verification_status='pending'",
            );
            if let Some((created_at, id)) = cursor_value {
                query
                    .push(" AND (a.created_at,a.user_id)>(")
                    .push_bind(created_at)
                    .push(",")
                    .push_bind(id)
                    .push(")");
            }
            query
                .push(" ORDER BY a.created_at,a.user_id LIMIT ")
                .push_bind(limit + 1);
            query.build_query_scalar().fetch_all(pool.get_ref()).await?
        }
        "reports" => {
            let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
                "SELECT jsonb_build_object('id',r.id,'category',r.category,'details',r.details,'created_at',r.created_at,'property_id',p.id,'property',p.title,'slug',p.slug,'reporter',u.first_name || ' ' || u.last_name,'reporter_email',u.email) FROM property_reports r JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=r.reporter_id WHERE r.status='open'",
            );
            if let Some((created_at, id)) = cursor_value {
                query
                    .push(" AND (r.created_at,r.id)>(")
                    .push_bind(created_at)
                    .push(",")
                    .push_bind(id)
                    .push(")");
            }
            query
                .push(" ORDER BY r.created_at,r.id LIMIT ")
                .push_bind(limit + 1);
            query.build_query_scalar().fetch_all(pool.get_ref()).await?
        }
        _ => return Err(bad("Invalid review queue")),
    };
    Ok(HttpResponse::Ok().json(paged(data, limit)))
}
#[derive(Deserialize)]
pub struct Review {
    target_type: String,
    action: String,
    reason: String,
}
pub async fn review(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<Review>,
) -> Result<HttpResponse, ApiError> {
    let user = admin(&req, &pool).await?;
    if !(5..=2000).contains(&body.reason.trim().len()) {
        return Err(bad("A review reason of 5–2,000 characters is required"));
    }
    let mut tx = pool.begin().await?;
    let changed=match(body.target_type.as_str(),body.action.as_str()){
 ("property","verify")=>sqlx::query("UPDATE properties SET is_verified=true,updated_at=now() WHERE id=$1 AND status='active'").bind(*id).execute(&mut *tx).await?,
 ("property","suspend")=>sqlx::query("UPDATE properties SET status='suspended',is_verified=false,updated_at=now() WHERE id=$1").bind(*id).execute(&mut *tx).await?,
 ("property","restore")=>sqlx::query("UPDATE properties SET status='draft',updated_at=now() WHERE id=$1 AND status='suspended'").bind(*id).execute(&mut *tx).await?,
 ("property","feature")=>sqlx::query("UPDATE properties SET featured_until=now()+interval '30 days',updated_at=now() WHERE id=$1 AND status='active'").bind(*id).execute(&mut *tx).await?,
 ("property","unfeature")=>sqlx::query("UPDATE properties SET featured_until=NULL,updated_at=now() WHERE id=$1").bind(*id).execute(&mut *tx).await?,
 ("agent","verify"|"reject")=>sqlx::query("UPDATE agent_profiles SET verification_status=$1,updated_at=now() WHERE user_id=$2").bind(if body.action=="verify"{"verified"}else{"rejected"}).bind(*id).execute(&mut *tx).await?,
 _=>return Err(bad("Invalid review action"))};
    if changed.rows_affected() == 0 {
        return Err(bad("The item is unavailable for this action"));
    }
    sqlx::query("INSERT INTO moderation_events(id,actor_id,target_id,target_type,action,reason) VALUES($1,$2,$3,$4,$5,$6)").bind(Uuid::new_v4()).bind(user.id).bind(*id).bind(&body.target_type).bind(&body.action).bind(body.reason.trim()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
pub struct ReportReview {
    action: String,
    reason: String,
}

pub async fn review_report(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
    body: web::Json<ReportReview>,
) -> Result<HttpResponse, ApiError> {
    let user = admin(&req, &pool).await?;
    if !["resolved", "dismissed"].contains(&body.action.as_str()) {
        return Err(bad("Invalid report decision"));
    }
    if !(5..=2000).contains(&body.reason.trim().len()) {
        return Err(bad("A decision reason of 5–2,000 characters is required"));
    }
    let mut tx = pool.begin().await?;
    let changed = sqlx::query(
        "UPDATE property_reports SET status=$1,resolution_reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 AND status='open'",
    )
    .bind(&body.action)
    .bind(body.reason.trim())
    .bind(user.id)
    .bind(*id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(bad("The report is unavailable for this action"));
    }
    sqlx::query("INSERT INTO moderation_events(id,actor_id,target_id,target_type,action,reason) VALUES($1,$2,$3,'report',$4,$5)")
        .bind(Uuid::new_v4())
        .bind(user.id)
        .bind(*id)
        .bind(&body.action)
        .bind(body.reason.trim())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(HttpResponse::NoContent().finish())
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/admin/metrics", web::get().to(metrics))
        .route("/admin/queue/{kind}", web::get().to(queue))
        .route("/admin/reviews/{id}", web::post().to(review))
        .route("/admin/reports/{id}", web::patch().to(review_report));
}
