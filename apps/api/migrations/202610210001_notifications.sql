CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN (
        'inquiry_received',
        'inquiry_updated',
        'inspection_requested',
        'inspection_updated',
        'review_received'
    )),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    href text NOT NULL CHECK (href LIKE '/%'),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_feed
ON notifications(user_id, created_at DESC, id DESC);

CREATE INDEX notifications_user_unread
ON notifications(user_id, created_at DESC)
WHERE read_at IS NULL;
