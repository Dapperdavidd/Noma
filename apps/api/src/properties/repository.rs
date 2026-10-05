use super::dto::{Listing, ListingImage, ListingVideo, Search, Status};
use crate::{
    auth,
    error::{ApiError, bad},
    pagination::{Page, cursor},
};
use actix_web::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;
pub(crate) const CARD: &str = "SELECT jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'price',p.price,'listing_type',p.listing_type,'property_type',p.property_type,'rental_period',p.rental_period,'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,'size_sqm',p.size_sqm,'status',p.status,'is_verified',p.is_verified,'is_featured',COALESCE(p.featured_until>now(),false),'has_video',EXISTS(SELECT 1 FROM property_videos WHERE property_id=p.id),'created_at',p.created_at,'city',c.name,'state',s.name,'area',a.name,'cover_image',(SELECT url FROM property_images WHERE property_id=p.id ORDER BY is_cover DESC,position LIMIT 1)) FROM properties p JOIN cities c ON c.id=p.city_id JOIN states s ON s.id=p.state_id LEFT JOIN areas a ON a.id=p.area_id";
pub async fn search(pool: &PgPool, query: &Search) -> Result<Value, ApiError> {
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let sort = query.sort.as_deref().unwrap_or("newest");
    if !["newest", "price_asc", "price_desc", "featured"].contains(&sort) {
        return Err(bad("Invalid sort order"));
    }
    if query
        .listing_type
        .as_deref()
        .is_some_and(|value| !["sale", "rent", "short_let"].contains(&value))
        || query.property_type.as_deref().is_some_and(|value| {
            ![
                "apartment",
                "house",
                "duplex",
                "land",
                "commercial",
                "office",
            ]
            .contains(&value)
        })
    {
        return Err(bad("Invalid property or listing type"));
    }
    if query
        .media
        .as_deref()
        .is_some_and(|value| !["photos", "videos"].contains(&value))
    {
        return Err(bad("Invalid media filter"));
    }
    if query.min_price.is_some_and(|v| v < 0)
        || query.max_price.is_some_and(|v| v < 0)
        || matches!((query.min_price,query.max_price),(Some(a),Some(b)) if a>b)
    {
        return Err(bad("Invalid price range"));
    }
    if query.min_bedrooms.is_some_and(|value| value < 0)
        || query.max_bedrooms.is_some_and(|value| value < 0)
        || matches!((query.min_bedrooms,query.max_bedrooms),(Some(a),Some(b)) if a>b)
    {
        return Err(bad("Invalid bedroom range"));
    }
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(CARD);
    qb.push(" WHERE p.status='active'");
    if let Some(v) = &query.q {
        if v.len() > 200 {
            return Err(bad("Search is too long"));
        }
        qb.push(" AND (to_tsvector('english',p.title || ' ' || p.description) @@ plainto_tsquery('english',").push_bind(v).push(") OR c.name ILIKE ").push_bind(format!("%{}%",v.replace('%',"\\%").replace('_',"\\_"))).push(" OR a.name ILIKE ").push_bind(format!("%{}%",v.replace('%',"\\%").replace('_',"\\_"))).push(")");
    }
    if let Some(v) = &query.listing_type {
        qb.push(" AND p.listing_type=").push_bind(v);
    }
    if let Some(v) = &query.property_type {
        qb.push(" AND p.property_type=").push_bind(v);
    }
    if let Some(v) = query.state_id {
        qb.push(" AND p.state_id=").push_bind(v);
    }
    if let Some(v) = query.city_id {
        qb.push(" AND p.city_id=").push_bind(v);
    }
    if let Some(v) = query.area_id {
        qb.push(" AND p.area_id=").push_bind(v);
    }
    if let Some(v) = query.min_price {
        qb.push(" AND p.price>=").push_bind(v);
    }
    if let Some(v) = query.max_price {
        qb.push(" AND p.price<=").push_bind(v);
    }
    if let Some(v) = query.min_bedrooms {
        qb.push(" AND p.bedrooms>=").push_bind(v);
    }
    if let Some(v) = query.max_bedrooms {
        qb.push(" AND p.bedrooms<=").push_bind(v);
    }
    if let Some(v) = &query.amenities {
        let ids: Vec<Uuid> = v
            .split(',')
            .filter(|v| !v.is_empty())
            .map(Uuid::parse_str)
            .collect::<Result<_, _>>()
            .map_err(|_| bad("Invalid amenity filter"))?;
        if ids.len() > 30 {
            return Err(bad("Too many amenity filters"));
        }
        for id in ids {
            qb.push(" AND EXISTS(SELECT 1 FROM property_amenities pa WHERE pa.property_id=p.id AND pa.amenity_id=").push_bind(id).push(")");
        }
    }
    match query.media.as_deref() {
        Some("photos") => {
            qb.push(" AND EXISTS(SELECT 1 FROM property_images pi WHERE pi.property_id=p.id)")
        }
        Some("videos") => {
            qb.push(" AND EXISTS(SELECT 1 FROM property_videos pv WHERE pv.property_id=p.id)")
        }
        _ => &mut qb,
    };
    if let Some(cursor) = &query.cursor {
        let (value, id) = cursor
            .rsplit_once('|')
            .ok_or_else(|| bad("Invalid cursor"))?;
        let id = Uuid::parse_str(id).map_err(|_| bad("Invalid cursor"))?;
        if sort == "featured" {
            let values = value.split('~').collect::<Vec<_>>();
            if values.len() != 3 {
                return Err(bad("Invalid cursor"));
            }
            let featured = values[0]
                .parse::<bool>()
                .map_err(|_| bad("Invalid cursor"))?;
            let verified = values[1]
                .parse::<bool>()
                .map_err(|_| bad("Invalid cursor"))?;
            let date = chrono::DateTime::parse_from_rfc3339(values[2])
                .map_err(|_| bad("Invalid cursor"))?
                .with_timezone(&chrono::Utc);
            qb.push(
                " AND (COALESCE(p.featured_until>now(),false),p.is_verified,p.created_at,p.id)<(",
            )
            .push_bind(featured)
            .push(",")
            .push_bind(verified)
            .push(",")
            .push_bind(date)
            .push(",")
            .push_bind(id)
            .push(")");
        } else if sort == "newest" {
            let date = chrono::DateTime::parse_from_rfc3339(value)
                .map_err(|_| bad("Invalid cursor"))?
                .with_timezone(&chrono::Utc);
            qb.push(" AND (p.created_at,p.id)<(")
                .push_bind(date)
                .push(",")
                .push_bind(id)
                .push(")");
        } else {
            let price = value.parse::<i64>().map_err(|_| bad("Invalid cursor"))?;
            qb.push(if sort == "price_asc" {
                " AND (p.price,p.id)>("
            } else {
                " AND (p.price,p.id)<("
            })
            .push_bind(price)
            .push(",")
            .push_bind(id)
            .push(")");
        }
    }
    qb.push(match sort {
        "price_asc" => " ORDER BY p.price ASC,p.id ASC",
        "price_desc" => " ORDER BY p.price DESC,p.id DESC",
        "featured" => {
            " ORDER BY COALESCE(p.featured_until>now(),false) DESC,p.is_verified DESC,p.created_at DESC,p.id DESC"
        }
        _ => " ORDER BY p.created_at DESC,p.id DESC",
    })
    .push(" LIMIT ")
    .push_bind(limit + 1);
    let mut data: Vec<Value> = qb.build_query_scalar().fetch_all(pool).await?;
    let more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let cursor = if more {
        data.last().map(|v| {
            format!(
                "{}|{}",
                if sort == "featured" {
                    format!(
                        "{}~{}~{}",
                        v["is_featured"].as_bool().unwrap_or(false),
                        v["is_verified"].as_bool().unwrap_or(false),
                        v["created_at"].as_str().unwrap_or_default()
                    )
                } else if sort == "newest" {
                    v["created_at"].as_str().unwrap_or_default().to_string()
                } else {
                    v["price"].to_string()
                },
                v["id"].as_str().unwrap_or_default()
            )
        })
    } else {
        None
    };
    Ok(json!({"data":data,"next_cursor":cursor}))
}
pub async fn detail(
    pool: &PgPool,
    slug: String,
    owner: Option<&auth::User>,
) -> Result<Value, ApiError> {
    let row:Value=sqlx::query_scalar("SELECT to_jsonb(p) || jsonb_build_object('city',c.name,'state',s.name,'area',a.name,'images',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.position) FROM property_images i WHERE i.property_id=p.id),'[]'::jsonb),'videos',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.position) FROM property_videos v WHERE v.property_id=p.id),'[]'::jsonb),'amenity_ids',COALESCE((SELECT jsonb_agg(pa.amenity_id) FROM property_amenities pa WHERE pa.property_id=p.id),'[]'::jsonb),'amenities',COALESCE((SELECT jsonb_agg(am.name) FROM amenities am JOIN property_amenities pa ON pa.amenity_id=am.id WHERE pa.property_id=p.id),'[]'::jsonb),'agent',jsonb_build_object('id',u.id,'first_name',u.first_name,'last_name',u.last_name,'phone',u.phone,'whatsapp',u.whatsapp,'telegram',u.telegram,'instagram',u.instagram,'agency_name',ap.agency_name,'role',u.role,'verification_status',COALESCE(ap.verification_status,'pending'),'rating',COALESCE((SELECT round(avg(r.rating)::numeric,1) FROM agent_reviews r WHERE r.agent_id=u.id),0),'review_count',(SELECT count(*) FROM agent_reviews r WHERE r.agent_id=u.id))) FROM properties p JOIN cities c ON c.id=p.city_id JOIN states s ON s.id=p.state_id LEFT JOIN areas a ON a.id=p.area_id JOIN users u ON u.id=p.agent_id LEFT JOIN agent_profiles ap ON ap.user_id=u.id WHERE p.slug=$1 AND (p.status='active' OR p.agent_id=$2 OR $3)").bind(slug).bind(owner.as_ref().map(|u|u.id)).bind(owner.as_ref().is_some_and(|u|u.role=="admin")).fetch_one(pool).await?;
    Ok(row)
}
pub async fn save(
    pool: &PgPool,
    user: &auth::User,
    path: Option<Uuid>,
    body: &Listing,
) -> Result<Value, ApiError> {
    body.validate()?;
    if body.lister_relationship == "authorized_agent"
        && user.role != "agent"
        && user.role != "admin"
    {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only an agent account can list on behalf of an owner",
        ));
    }
    let mut tx = pool.begin().await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cities c WHERE c.id=$1 AND c.state_id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM areas a WHERE a.id=$3 AND a.city_id=c.id)))").bind(body.city_id).bind(body.state_id).bind(body.area_id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(bad("Choose a valid state, city and area"));
    }
    let mut amenity_ids = body.amenity_ids.clone();
    amenity_ids.sort_unstable();
    amenity_ids.dedup();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM amenities WHERE id=ANY($1)")
        .bind(&amenity_ids)
        .fetch_one(&mut *tx)
        .await?;
    if count != amenity_ids.len() as i64 {
        return Err(bad("Choose valid amenities"));
    }
    let id = path.unwrap_or_else(Uuid::new_v4);
    if path.is_some() {
        let owner: Uuid =
            sqlx::query_scalar("SELECT agent_id FROM properties WHERE id=$1 FOR UPDATE")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        if owner != user.id && user.role != "admin" {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "You do not own this property",
            ));
        }
    }
    let mut prepared_images = Vec::with_capacity(body.images.len());
    for image in &body.images {
        match image {
            ListingImage::External(url) => {
                prepared_images.push((url.clone(), None, None));
            }
            ListingImage::Managed { upload_id, url } => {
                let upload: Option<(String, String)> = sqlx::query_as(
                    "SELECT public_id,secure_url FROM image_uploads WHERE id=$1 AND secure_url=$2 AND ((user_id=$3 AND status='uploaded') OR (property_id=$4 AND status='attached'))",
                )
                .bind(upload_id)
                .bind(url)
                .bind(user.id)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
                let (public_id, secure_url) = upload.ok_or_else(|| {
                    bad("An uploaded photo is unavailable or belongs to another account")
                })?;
                prepared_images.push((secure_url, Some(public_id), Some(*upload_id)));
            }
        }
    }
    let selected_upload_ids = prepared_images
        .iter()
        .filter_map(|(_, _, upload_id)| *upload_id)
        .collect::<Vec<_>>();
    let removed_uploads: Vec<(Uuid, String)> = if path.is_some() {
        sqlx::query_as(
            "SELECT upload_id,public_id FROM property_images WHERE property_id=$1 AND upload_id IS NOT NULL AND NOT (upload_id=ANY($2))",
        )
        .bind(id)
        .bind(&selected_upload_ids)
        .fetch_all(&mut *tx)
        .await?
    } else {
        Vec::new()
    };
    let mut prepared_videos = Vec::with_capacity(body.videos.len());
    for video in &body.videos {
        match video {
            ListingVideo::External(url) => {
                let kind = if url.contains("youtube.com/") || url.contains("youtu.be/") {
                    "youtube"
                } else {
                    "external"
                };
                prepared_videos.push((url.clone(), kind, None, None));
            }
            ListingVideo::Managed { upload_id, url } => {
                let upload: Option<(String, String)> = sqlx::query_as(
                    "SELECT public_id,secure_url FROM image_uploads WHERE id=$1 AND secure_url=$2 AND resource_type='video' AND ((user_id=$3 AND status='uploaded') OR (property_id=$4 AND status='attached'))",
                )
                .bind(upload_id)
                .bind(url)
                .bind(user.id)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
                let (public_id, secure_url) = upload.ok_or_else(|| {
                    bad("An uploaded video is unavailable or belongs to another account")
                })?;
                prepared_videos.push((secure_url, "upload", Some(public_id), Some(*upload_id)));
            }
        }
    }
    let selected_video_upload_ids = prepared_videos
        .iter()
        .filter_map(|(_, _, _, upload_id)| *upload_id)
        .collect::<Vec<_>>();
    let removed_video_uploads: Vec<(Uuid, String)> = if path.is_some() {
        sqlx::query_as(
            "SELECT upload_id,public_id FROM property_videos WHERE property_id=$1 AND upload_id IS NOT NULL AND NOT (upload_id=ANY($2))",
        )
        .bind(id)
        .bind(&selected_video_upload_ids)
        .fetch_all(&mut *tx)
        .await?
    } else {
        Vec::new()
    };
    let slug = format!(
        "{}-{}",
        body.title
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>(),
        id
    );
    let saved_slug:String=sqlx::query_scalar("INSERT INTO properties(id,agent_id,title,slug,description,listing_type,lister_relationship,property_type,price,rental_period,bedrooms,bathrooms,size_sqm,state_id,city_id,area_id,address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,listing_type=EXCLUDED.listing_type,lister_relationship=EXCLUDED.lister_relationship,property_type=EXCLUDED.property_type,price=EXCLUDED.price,rental_period=EXCLUDED.rental_period,bedrooms=EXCLUDED.bedrooms,bathrooms=EXCLUDED.bathrooms,size_sqm=EXCLUDED.size_sqm,state_id=EXCLUDED.state_id,city_id=EXCLUDED.city_id,area_id=EXCLUDED.area_id,address=EXCLUDED.address,is_verified=false,updated_at=now() RETURNING slug").bind(id).bind(user.id).bind(body.title.trim()).bind(slug).bind(body.description.trim()).bind(&body.listing_type).bind(&body.lister_relationship).bind(&body.property_type).bind(body.price).bind(&body.rental_period).bind(body.bedrooms).bind(body.bathrooms).bind(body.size_sqm).bind(body.state_id).bind(body.city_id).bind(body.area_id).bind(&body.address).fetch_one(&mut *tx).await?;
    sqlx::query("DELETE FROM property_images WHERE property_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (index, (url, public_id, upload_id)) in prepared_images.iter().enumerate() {
        sqlx::query("INSERT INTO property_images(id,property_id,url,public_id,upload_id,position,is_cover) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(id).bind(url).bind(public_id).bind(upload_id).bind(index as i16).bind(index==0).execute(&mut *tx).await?;
        if let Some(upload_id) = upload_id {
            sqlx::query("UPDATE image_uploads SET property_id=$1,status='attached',attached_at=COALESCE(attached_at,now()) WHERE id=$2")
                .bind(id)
                .bind(upload_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("DELETE FROM property_videos WHERE property_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (index, (url, kind, public_id, upload_id)) in prepared_videos.iter().enumerate() {
        sqlx::query("INSERT INTO property_videos(id,property_id,url,kind,public_id,upload_id,position) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(id).bind(url).bind(kind).bind(public_id).bind(upload_id).bind(index as i16).execute(&mut *tx).await?;
        if let Some(upload_id) = upload_id {
            sqlx::query("UPDATE image_uploads SET property_id=$1,status='attached',attached_at=COALESCE(attached_at,now()) WHERE id=$2")
                .bind(id)
                .bind(upload_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    for (upload_id, _) in &removed_uploads {
        sqlx::query(
            "UPDATE image_uploads SET property_id=NULL,status='pending_delete' WHERE id=$1",
        )
        .bind(upload_id)
        .execute(&mut *tx)
        .await?;
    }
    for (upload_id, _) in &removed_video_uploads {
        sqlx::query(
            "UPDATE image_uploads SET property_id=NULL,status='pending_delete' WHERE id=$1",
        )
        .bind(upload_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM property_amenities WHERE property_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for amenity_id in amenity_ids {
        sqlx::query("INSERT INTO property_amenities(property_id,amenity_id) VALUES($1,$2)")
            .bind(id)
            .bind(amenity_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    for (upload_id, public_id) in removed_uploads {
        match crate::images::delete_asset(&public_id, "image").await {
            Ok(()) => {
                if let Err(error) =
                    sqlx::query("UPDATE image_uploads SET status='deleted' WHERE id=$1")
                        .bind(upload_id)
                        .execute(pool)
                        .await
                {
                    tracing::warn!(%error, %upload_id, "Photo was removed from Cloudinary but its cleanup record was not updated");
                }
            }
            Err(error) => {
                tracing::warn!(%error, %upload_id, "Removed photo remains queued for cleanup");
            }
        }
    }
    for (upload_id, public_id) in removed_video_uploads {
        match crate::images::delete_asset(&public_id, "video").await {
            Ok(()) => {
                if let Err(error) =
                    sqlx::query("UPDATE image_uploads SET status='deleted' WHERE id=$1")
                        .bind(upload_id)
                        .execute(pool)
                        .await
                {
                    tracing::warn!(%error, %upload_id, "Video was removed from Cloudinary but its cleanup record was not updated");
                }
            }
            Err(error) => {
                tracing::warn!(%error, %upload_id, "Removed video remains queued for cleanup")
            }
        }
    }
    Ok(json!({"id":id,"slug":saved_slug}))
}
pub async fn transition(
    pool: &PgPool,
    user: &auth::User,
    id: Uuid,
    body: &Status,
) -> Result<(), ApiError> {
    if !["draft", "active", "sold", "rented", "expired", "suspended"]
        .contains(&body.status.as_str())
    {
        return Err(bad("Invalid status"));
    }
    let mut tx = pool.begin().await?;
    let (owner, old): (Uuid, String) =
        sqlx::query_as("SELECT agent_id,status FROM properties WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if old == "suspended"
        || body.status == "suspended"
        || (user.role != "admin" && owner != user.id)
    {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Use the administrator review workflow for suspended properties",
        ));
    }
    sqlx::query("UPDATE properties SET status=$1,updated_at=now(),published_at=CASE WHEN $1='active' THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=$2").bind(&body.status).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn mine(pool: &PgPool, user_id: Uuid, page: &Page) -> Result<Value, ApiError> {
    let limit = page.limit();
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(CARD);
    query.push(" WHERE p.agent_id=").push_bind(user_id);
    if let Some((created_at, id)) = page.decoded_cursor()? {
        query
            .push(" AND (p.created_at,p.id)<(")
            .push_bind(created_at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    query
        .push(" ORDER BY p.created_at DESC,p.id DESC LIMIT ")
        .push_bind(limit + 1);
    let mut data: Vec<Value> = query.build_query_scalar().fetch_all(pool).await?;
    let more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let next_cursor = if more {
        data.last().and_then(|property| {
            Some(cursor(
                property["created_at"].as_str()?,
                property["id"].as_str()?,
            ))
        })
    } else {
        None
    };
    Ok(json!({"data":data,"next_cursor":next_cursor}))
}
