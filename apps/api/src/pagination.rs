use crate::error::{ApiError, bad};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize, Default)]
pub struct Page {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

impl Page {
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(20).clamp(1, 50)
    }

    pub fn decoded_cursor(&self) -> Result<Option<(DateTime<Utc>, Uuid)>, ApiError> {
        let Some(cursor) = &self.cursor else {
            return Ok(None);
        };
        let (timestamp, id) = cursor
            .rsplit_once('|')
            .ok_or_else(|| bad("Invalid cursor"))?;
        let timestamp = DateTime::parse_from_rfc3339(timestamp)
            .map_err(|_| bad("Invalid cursor"))?
            .with_timezone(&Utc);
        let id = Uuid::parse_str(id).map_err(|_| bad("Invalid cursor"))?;
        Ok(Some((timestamp, id)))
    }
}

pub fn cursor(timestamp: &str, id: &str) -> String {
    format!("{timestamp}|{id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_cursor_round_trips() {
        let id = Uuid::new_v4();
        let timestamp = "2026-09-29T09:00:00+00:00";
        let page = Page {
            cursor: Some(cursor(timestamp, &id.to_string())),
            limit: Some(500),
        };
        let decoded = page.decoded_cursor().unwrap().unwrap();
        assert_eq!(decoded.0.to_rfc3339(), timestamp);
        assert_eq!(decoded.1, id);
        assert_eq!(page.limit(), 50);
    }
}
