use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

/// Per-process guardrail. Trust only the socket peer, never arbitrary forwarding headers.
/// A production reverse proxy should apply distributed limits before forwarding traffic.
pub struct RateLimiter {
    buckets: Mutex<HashMap<(IpAddr, bool), (Instant, u32)>>,
    authentication_limit: u32,
}
impl Default for RateLimiter {
    fn default() -> Self {
        Self {
            buckets: Mutex::default(),
            authentication_limit: 30,
        }
    }
}
impl RateLimiter {
    pub fn from_env() -> Self {
        let authentication_limit = std::env::var("RATE_LIMIT_AUTH_MAX")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value| (1..=10_000).contains(value))
            .unwrap_or(30);
        Self {
            buckets: Mutex::default(),
            authentication_limit,
        }
    }

    pub fn allow(&self, ip: IpAddr, authentication: bool) -> bool {
        let now = Instant::now();
        let window = if authentication {
            Duration::from_secs(900)
        } else {
            Duration::from_secs(60)
        };
        let limit = if authentication {
            self.authentication_limit
        } else {
            120
        };
        let Ok(mut buckets) = self.buckets.lock() else {
            return false;
        };
        if buckets.len() >= 10_000 {
            buckets.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(900));
            if buckets.len() >= 10_000 && !buckets.contains_key(&(ip, authentication)) {
                return false;
            }
        }
        let entry = buckets.entry((ip, authentication)).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0)
        }
        if entry.1 >= limit {
            return false;
        }
        entry.1 += 1;
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_authentication_attempts_and_separates_clients() {
        let limiter = RateLimiter::default();
        let ip = "127.0.0.1".parse().unwrap();
        for _ in 0..30 {
            assert!(limiter.allow(ip, true))
        }
        assert!(!limiter.allow(ip, true));
        assert!(limiter.allow(ip, false));
        assert!(limiter.allow("127.0.0.2".parse().unwrap(), true));
    }
}
