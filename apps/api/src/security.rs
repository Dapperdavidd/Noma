use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

/// Per-process guardrail. Trust only the socket peer, never arbitrary forwarding headers.
/// A production reverse proxy should apply distributed limits before forwarding traffic.
#[derive(Default)]
pub struct RateLimiter {
    buckets: Mutex<HashMap<(IpAddr, bool), (Instant, u32)>>,
}
impl RateLimiter {
    pub fn allow(&self, ip: IpAddr, authentication: bool) -> bool {
        let now = Instant::now();
        let window = if authentication {
            Duration::from_secs(900)
        } else {
            Duration::from_secs(60)
        };
        let limit = if authentication { 30 } else { 120 };
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
