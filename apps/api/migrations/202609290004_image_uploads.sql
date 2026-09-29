CREATE TABLE image_uploads (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
 public_id text NOT NULL UNIQUE,
 secure_url text,
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','uploaded','attached','pending_delete','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 attached_at timestamptz
);

CREATE INDEX image_uploads_pending_cleanup
ON image_uploads(created_at)
WHERE status IN ('pending','uploaded','pending_delete');

ALTER TABLE property_images
ADD COLUMN upload_id uuid UNIQUE REFERENCES image_uploads(id);
