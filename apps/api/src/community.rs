use crate::{
    auth,
    email::EmailClient,
    error::{ApiError, bad},
    notifications,
    pagination::{Page, cursor},
};
use actix_web::{HttpRequest, HttpResponse, web};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;
pub async fn locations(pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let data:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',s.name,'cities',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) ORDER BY a.name) FROM areas a WHERE a.city_id=c.id),'[]'::jsonb)) ORDER BY c.name) FROM cities c WHERE c.state_id=s.id),'[]'::jsonb)) FROM states s ORDER BY s.name").fetch_all(pool.get_ref()).await?;
    Ok(HttpResponse::Ok().json(data))
}
pub async fn favorites(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT property_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await?;
    Ok(HttpResponse::Ok().json(ids))
}
pub async fn favorite(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if req.method() == actix_web::http::Method::DELETE {
        sqlx::query("DELETE FROM favorites WHERE user_id=$1 AND property_id=$2")
            .bind(user.id)
            .bind(*id)
            .execute(pool.get_ref())
            .await?;
    } else {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1 AND status='active')",
        )
        .bind(*id)
        .fetch_one(pool.get_ref())
        .await?;
        if !exists {
            return Err(bad("This listing is unavailable"));
        }
        sqlx::query(
            "INSERT INTO favorites(user_id,property_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id)
        .bind(*id)
        .execute(pool.get_ref())
        .await?;
    }
    Ok(HttpResponse::NoContent().finish())
}
#[derive(Deserialize)]
pub struct Inquiry {
    message: String,
}
pub async fn inquire(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    email: web::Data<EmailClient>,
    id: web::Path<Uuid>,
    body: web::Json<Inquiry>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !(10..=3000).contains(&body.message.trim().len()) {
        return Err(bad("Message must contain 10–3,000 characters"));
    }
    let listing: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT agent_id,title FROM properties WHERE id=$1 AND status='active' AND agent_id<>$2",
    )
    .bind(*id)
    .bind(user.id)
    .fetch_optional(pool.get_ref())
    .await?;
    let (agent_id, property_title) =
        listing.ok_or_else(|| bad("You cannot inquire about this listing"))?;
    let mut tx = pool.begin().await?;
    let inquiry_id = Uuid::new_v4();
    sqlx::query("INSERT INTO inquiries(id,property_id,user_id,message) VALUES($1,$2,$3,$4)")
        .bind(inquiry_id)
        .bind(*id)
        .bind(user.id)
        .bind(body.message.trim())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO notifications(id,user_id,kind,title,body,href)
         SELECT $1,p.agent_id,'inquiry_received','New property inquiry',
                $2 || ' sent an inquiry about ' || p.title,
                '/dashboard?tab=inquiries'
         FROM properties p WHERE p.id=$3",
    )
    .bind(Uuid::new_v4())
    .bind(format!("{} {}", user.first_name, user.last_name))
    .bind(*id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if email.configured()
        && let Some(address) = notifications::activity_email(&pool, agent_id).await?
        && let Err(error) = email
            .activity(
                &address,
                "New inquiry on NOMA",
                "A property seeker contacted you",
                &format!(
                    "{} {} sent an inquiry about {property_title}.",
                    user.first_name, user.last_name
                ),
                "/dashboard?tab=inquiries",
            )
            .await
    {
        tracing::warn!(%error, user_id=%agent_id, "Unable to deliver inquiry email");
    }
    Ok(HttpResponse::Created().finish())
}
pub async fn leads(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    page: web::Query<Page>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let limit = page.limit();
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT jsonb_build_object('id',i.id,'message',i.message,'status',i.status,'created_at',i.created_at,'property',p.title,'name',u.first_name || ' ' || u.last_name,'email',u.email) FROM inquiries i JOIN properties p ON p.id=i.property_id JOIN users u ON u.id=i.user_id WHERE p.agent_id=",
    );
    query.push_bind(user.id);
    if let Some((created_at, id)) = page.decoded_cursor()? {
        query
            .push(" AND (i.created_at,i.id)<(")
            .push_bind(created_at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY i.created_at DESC,i.id DESC LIMIT ")
        .push_bind(limit + 1);
    let mut data: Vec<Value> = query.build_query_scalar().fetch_all(pool.get_ref()).await?;
    let more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let next_cursor = if more {
        data.last()
            .and_then(|lead| Some(cursor(lead["created_at"].as_str()?, lead["id"].as_str()?)))
    } else {
        None
    };
    Ok(HttpResponse::Ok().json(json!({"data":data,"next_cursor":next_cursor})))
}

pub async fn dashboard_summary(
    req: HttpRequest,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let (total_properties, active_properties, inquiries): (i64, i64, i64) =
        sqlx::query_as(
            "SELECT COUNT(*)::bigint, COUNT(*) FILTER (WHERE status='active')::bigint, (SELECT COUNT(*)::bigint FROM inquiries i JOIN properties owned ON owned.id=i.property_id WHERE owned.agent_id=$1) FROM properties WHERE agent_id=$1",
        )
        .bind(user.id)
        .fetch_one(pool.get_ref())
        .await?;
    Ok(HttpResponse::Ok().json(json!({
        "total_properties": total_properties,
        "active_properties": active_properties,
        "inquiries": inquiries,
    })))
}

pub async fn saved_properties(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    page: web::Query<Page>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    let limit = page.limit();
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT f.property_id,f.created_at FROM favorites f JOIN properties p ON p.id=f.property_id WHERE f.user_id=",
    );
    query.push_bind(user.id).push(" AND p.status='active'");
    if let Some((created_at, id)) = page.decoded_cursor()? {
        query
            .push(" AND (f.created_at,f.property_id)<(")
            .push_bind(created_at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY f.created_at DESC,f.property_id DESC LIMIT ")
        .push_bind(limit + 1);
    let mut saved: Vec<(Uuid, DateTime<Utc>)> =
        query.build_query_as().fetch_all(pool.get_ref()).await?;
    let more = saved.len() > limit as usize;
    saved.truncate(limit as usize);
    let next_cursor = if more {
        saved
            .last()
            .map(|(id, created_at)| cursor(&created_at.to_rfc3339(), &id.to_string()))
    } else {
        None
    };
    let ids: Vec<Uuid> = saved.into_iter().map(|(id, _)| id).collect();
    let data: Vec<Value> = if ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_scalar(&format!(
            "{} WHERE p.id=ANY($1) ORDER BY array_position($1,p.id)",
            crate::properties::repository::CARD
        ))
        .bind(&ids)
        .fetch_all(pool.get_ref())
        .await?
    };
    Ok(HttpResponse::Ok().json(json!({"data":data,"next_cursor":next_cursor})))
}

pub async fn amenities(pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let data: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(a) FROM amenities a ORDER BY name")
        .fetch_all(pool.get_ref())
        .await?;
    Ok(HttpResponse::Ok().json(data))
}
#[derive(Deserialize)]
pub struct LeadStatus {
    status: String,
}
pub async fn lead_status(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    email: web::Data<EmailClient>,
    id: web::Path<Uuid>,
    body: web::Json<LeadStatus>,
) -> Result<HttpResponse, ApiError> {
    let user = auth::current(&req, &pool).await?;
    if !["new", "contacted", "closed"].contains(&body.status.as_str()) {
        return Err(bad("Invalid inquiry status"));
    }
    let mut tx = pool.begin().await?;
    let updated: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE inquiries i SET status=$1 FROM properties p
         WHERE i.property_id=p.id AND i.id=$2 AND p.agent_id=$3
         RETURNING i.user_id,p.title",
    )
    .bind(&body.status)
    .bind(*id)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((recipient, property)) = updated else {
        return Err(ApiError(
            actix_web::http::StatusCode::NOT_FOUND,
            "Inquiry not found",
        ));
    };
    sqlx::query(
        "INSERT INTO notifications(id,user_id,kind,title,body,href)
         VALUES($1,$2,'inquiry_updated','Inquiry updated',$3,'/dashboard?tab=inquiries')",
    )
    .bind(Uuid::new_v4())
    .bind(recipient)
    .bind(format!(
        "Your inquiry about {property} is now {}",
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
                "Your NOMA inquiry was updated",
                "Inquiry status updated",
                &format!("Your inquiry about {property} is now {}.", body.status),
                "/dashboard?tab=inquiries",
            )
            .await
    {
        tracing::warn!(%error, user_id=%recipient, "Unable to deliver inquiry-status email");
    }
    Ok(HttpResponse::NoContent().finish())
}
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/locations", web::get().to(locations))
        .route("/amenities", web::get().to(amenities))
        .route("/dashboard/inquiries/{id}", web::patch().to(lead_status))
        .route("/favorites", web::get().to(favorites))
        .route("/favorites/properties", web::get().to(saved_properties))
        .route("/favorites/{id}", web::put().to(favorite))
        .route("/favorites/{id}", web::delete().to(favorite))
        .route("/properties/{id}/inquiries", web::post().to(inquire))
        .route("/dashboard/summary", web::get().to(dashboard_summary))
        .route("/dashboard/inquiries", web::get().to(leads));
}
