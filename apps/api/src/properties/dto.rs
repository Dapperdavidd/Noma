use crate::error::{ApiError, bad};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Deserialize, Default)]
pub struct Search {
    pub q: Option<String>,
    pub listing_type: Option<String>,
    pub property_type: Option<String>,
    pub state_id: Option<Uuid>,
    pub city_id: Option<Uuid>,
    pub area_id: Option<Uuid>,
    pub min_price: Option<i64>,
    pub max_price: Option<i64>,
    pub min_bedrooms: Option<i16>,
    pub max_bedrooms: Option<i16>,
    pub amenities: Option<String>,
    pub media: Option<String>,
    pub sort: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}
#[derive(Deserialize)]
#[serde(untagged)]
pub enum ListingImage {
    External(String),
    Managed { upload_id: Uuid, url: String },
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum ListingVideo {
    External(String),
    Managed { upload_id: Uuid, url: String },
}

impl ListingVideo {
    pub fn url(&self) -> &str {
        match self {
            Self::External(url) | Self::Managed { url, .. } => url,
        }
    }

    pub fn upload_id(&self) -> Option<Uuid> {
        match self {
            Self::External(_) => None,
            Self::Managed { upload_id, .. } => Some(*upload_id),
        }
    }
}

impl ListingImage {
    pub fn url(&self) -> &str {
        match self {
            Self::External(url) | Self::Managed { url, .. } => url,
        }
    }

    pub fn upload_id(&self) -> Option<Uuid> {
        match self {
            Self::External(_) => None,
            Self::Managed { upload_id, .. } => Some(*upload_id),
        }
    }
}

#[derive(Deserialize)]
pub struct Listing {
    pub title: String,
    pub description: String,
    pub listing_type: String,
    #[serde(default = "default_lister_relationship")]
    pub lister_relationship: String,
    pub property_type: String,
    pub price: i64,
    pub rental_period: Option<String>,
    pub bedrooms: Option<i16>,
    pub bathrooms: Option<i16>,
    pub size_sqm: Option<i32>,
    pub state_id: Uuid,
    pub city_id: Uuid,
    pub area_id: Option<Uuid>,
    pub address: String,
    pub images: Vec<ListingImage>,
    #[serde(default)]
    pub videos: Vec<ListingVideo>,
    #[serde(default)]
    pub amenity_ids: Vec<Uuid>,
}
impl Listing {
    pub fn validate(&self) -> Result<(), ApiError> {
        if !(5..=200).contains(&self.title.trim().len())
            || !(30..=20000).contains(&self.description.trim().len())
            || self.address.trim().is_empty()
            || self.address.len() > 500
        {
            return Err(bad(
                "Provide a title (5–200 characters), description (30–20,000 characters), and address",
            ));
        }
        if !["sale", "rent", "short_let"].contains(&self.listing_type.as_str())
            || ![
                "apartment",
                "house",
                "duplex",
                "land",
                "commercial",
                "office",
            ]
            .contains(&self.property_type.as_str())
        {
            return Err(bad("Invalid property or listing type"));
        }
        if !["owner", "authorized_agent"].contains(&self.lister_relationship.as_str()) {
            return Err(bad("Invalid relationship to the property"));
        }
        if self.price <= 0
            || self.price > 9_007_199_254_740_991
            || self.bedrooms.is_some_and(|v| v < 0)
            || self.bathrooms.is_some_and(|v| v < 0)
            || self.size_sqm.is_some_and(|v| v <= 0)
        {
            return Err(bad("Invalid price, room count, or size"));
        }
        if (self.listing_type == "sale" && self.rental_period.is_some())
            || (self.listing_type != "sale"
                && !self
                    .rental_period
                    .as_deref()
                    .is_some_and(|v| ["day", "month", "year"].contains(&v)))
        {
            return Err(bad("Choose a rental period for rental listings"));
        }
        if self.amenity_ids.len() > 30 {
            return Err(bad("Choose at most 30 amenities"));
        }
        if self.images.is_empty()
            || self.images.len() > 20
            || self
                .images
                .iter()
                .map(ListingImage::url)
                .any(|url| !url.starts_with("https://") || url.len() > 2048)
        {
            return Err(bad("Provide 1–20 HTTPS image URLs"));
        }
        if self.videos.len() > 8
            || self
                .videos
                .iter()
                .map(ListingVideo::url)
                .any(|url| !url.starts_with("https://") || url.len() > 2048)
        {
            return Err(bad("Provide up to 8 HTTPS video or YouTube URLs"));
        }
        let mut upload_ids = self
            .images
            .iter()
            .filter_map(ListingImage::upload_id)
            .collect::<Vec<_>>();
        let managed_count = upload_ids.len();
        upload_ids.sort_unstable();
        upload_ids.dedup();
        if upload_ids.len() != managed_count {
            return Err(bad("A managed photo cannot be used more than once"));
        }
        let mut video_upload_ids = self
            .videos
            .iter()
            .filter_map(ListingVideo::upload_id)
            .collect::<Vec<_>>();
        let video_managed_count = video_upload_ids.len();
        video_upload_ids.sort_unstable();
        video_upload_ids.dedup();
        if video_upload_ids.len() != video_managed_count {
            return Err(bad("A managed video cannot be used more than once"));
        }
        Ok(())
    }
}

fn default_lister_relationship() -> String {
    "owner".into()
}
#[derive(Deserialize)]
pub struct Status {
    pub status: String,
}
