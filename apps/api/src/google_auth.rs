use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;

use crate::error::{ApiError, bad};

#[derive(Clone)]
pub struct GoogleVerifier {
    client_id: Option<String>,
    http: reqwest::Client,
    cache: Arc<RwLock<KeyCache>>,
}

struct KeyCache {
    keys: HashMap<String, DecodingKey>,
    expires_at: Instant,
}

#[derive(Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    #[serde(default)]
    alg: String,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleClaims {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    #[serde(default)]
    pub given_name: String,
    #[serde(default)]
    pub family_name: String,
    #[serde(default)]
    pub name: String,
}

impl GoogleVerifier {
    pub fn from_env() -> Self {
        Self {
            client_id: std::env::var("GOOGLE_CLIENT_ID")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("valid Google HTTP client"),
            cache: Arc::new(RwLock::new(KeyCache {
                keys: HashMap::new(),
                expires_at: Instant::now(),
            })),
        }
    }

    pub fn client_id(&self) -> Option<&str> {
        self.client_id.as_deref()
    }

    async fn refresh_keys(&self) -> Result<(), ApiError> {
        let set = self
            .http
            .get("https://www.googleapis.com/oauth2/v3/certs")
            .send()
            .await
            .map_err(|_| bad("Google sign-in is temporarily unavailable"))?
            .error_for_status()
            .map_err(|_| bad("Google sign-in is temporarily unavailable"))?
            .json::<JwkSet>()
            .await
            .map_err(|_| bad("Google sign-in is temporarily unavailable"))?;
        let mut keys = HashMap::new();
        for key in set.keys {
            if key.kty == "RSA"
                && (key.alg.is_empty() || key.alg == "RS256")
                && let Ok(decoding) = DecodingKey::from_rsa_components(&key.n, &key.e)
            {
                keys.insert(key.kid, decoding);
            }
        }
        if keys.is_empty() {
            return Err(bad("Google sign-in is temporarily unavailable"));
        }
        let mut cache = self.cache.write().expect("Google key cache poisoned");
        cache.keys = keys;
        cache.expires_at = Instant::now() + Duration::from_secs(60 * 60);
        Ok(())
    }

    pub async fn verify(&self, credential: &str) -> Result<GoogleClaims, ApiError> {
        let client_id = self
            .client_id
            .as_deref()
            .ok_or_else(|| bad("Google sign-in is not configured"))?;
        if credential.len() > 16_384 {
            return Err(bad("Invalid Google credential"));
        }
        let header = decode_header(credential).map_err(|_| bad("Invalid Google credential"))?;
        if header.alg != Algorithm::RS256 {
            return Err(bad("Invalid Google credential"));
        }
        let kid = header.kid.ok_or_else(|| bad("Invalid Google credential"))?;
        let needs_refresh = {
            let cache = self.cache.read().expect("Google key cache poisoned");
            cache.expires_at <= Instant::now() || !cache.keys.contains_key(&kid)
        };
        if needs_refresh {
            self.refresh_keys().await?;
        }
        let key = {
            let cache = self.cache.read().expect("Google key cache poisoned");
            cache.keys.get(&kid).cloned()
        }
        .ok_or_else(|| bad("Invalid Google credential"))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[client_id]);
        validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
        let claims = decode::<GoogleClaims>(credential, &key, &validation)
            .map_err(|_| bad("Invalid Google credential"))?
            .claims;
        if !claims.email_verified || claims.sub.is_empty() || !claims.email.contains('@') {
            return Err(bad("Google did not verify this email address"));
        }
        Ok(claims)
    }
}
