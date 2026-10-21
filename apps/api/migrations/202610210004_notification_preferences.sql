CREATE TABLE notification_preferences (
    user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
    email_activity boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
