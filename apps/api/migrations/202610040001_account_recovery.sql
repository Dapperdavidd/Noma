ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_identities (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('google')),
 subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider, subject),
 UNIQUE(user_id, provider)
);

CREATE TABLE auth_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_purpose
ON auth_tokens(user_id, purpose, created_at DESC)
WHERE used_at IS NULL;

CREATE INDEX auth_tokens_expiry
ON auth_tokens(expires_at)
WHERE used_at IS NULL;
