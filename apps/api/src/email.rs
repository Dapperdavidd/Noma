use serde::Serialize;
use std::time::Duration;

#[derive(Clone)]
pub struct EmailClient {
    http: reqwest::Client,
    api_key: Option<String>,
    sender: String,
    app_url: String,
}

#[derive(Serialize)]
struct Message<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'a str,
    html: String,
}

impl EmailClient {
    pub fn from_env() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("valid email HTTP client"),
            api_key: std::env::var("RESEND_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            sender: std::env::var("EMAIL_FROM")
                .unwrap_or_else(|_| "NOMA <onboarding@resend.dev>".into()),
            app_url: std::env::var("PUBLIC_APP_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into())
                .trim_end_matches('/')
                .to_owned(),
        }
    }

    pub fn configured(&self) -> bool {
        self.api_key.is_some()
    }

    async fn send(&self, to: &str, subject: &str, html: String) -> Result<(), String> {
        let key = self
            .api_key
            .as_deref()
            .ok_or_else(|| "RESEND_API_KEY is not configured".to_owned())?;
        let response = self
            .http
            .post("https://api.resend.com/emails")
            .bearer_auth(key)
            .json(&Message {
                from: &self.sender,
                to: [to],
                subject,
                html,
            })
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("Resend returned status {}", response.status()))
        }
    }

    pub async fn verification(&self, to: &str, token: &str) -> Result<(), String> {
        let link = format!("{}/verify-email?token={}", self.app_url, token);
        self.send(
            to,
            "Verify your NOMA email",
            format!(
                "<h1>Welcome to NOMA</h1><p>Confirm your email address to secure your account.</p><p><a href=\"{link}\">Verify email</a></p><p>This link expires in 24 hours.</p>"
            ),
        )
        .await
    }

    pub async fn password_reset(&self, to: &str, token: &str) -> Result<(), String> {
        let link = format!("{}/reset-password?token={}", self.app_url, token);
        self.send(
            to,
            "Reset your NOMA password",
            format!(
                "<h1>Reset your password</h1><p>A password reset was requested for your NOMA account.</p><p><a href=\"{link}\">Choose a new password</a></p><p>This link expires in one hour. Ignore this email if you did not request it.</p>"
            ),
        )
        .await
    }
}
