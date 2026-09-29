CREATE TABLE moderation_events (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users,
 target_id uuid NOT NULL, target_type text NOT NULL CHECK(target_type IN ('property','agent')),
 action text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_target ON moderation_events(target_id,created_at DESC);
