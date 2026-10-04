ALTER TABLE users
ADD COLUMN whatsapp text,
ADD COLUMN telegram text,
ADD COLUMN instagram text;

ALTER TABLE image_uploads
ADD COLUMN resource_type text NOT NULL DEFAULT 'image'
CHECK (resource_type IN ('image', 'video'));

CREATE TABLE property_videos (
 id uuid PRIMARY KEY,
 property_id uuid NOT NULL REFERENCES properties ON DELETE CASCADE,
 url text NOT NULL CHECK(url LIKE 'https://%'),
 kind text NOT NULL CHECK(kind IN ('upload','youtube','external')),
 public_id text,
 upload_id uuid UNIQUE REFERENCES image_uploads(id),
 position smallint NOT NULL CHECK(position >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(property_id,position)
);

CREATE INDEX property_videos_property ON property_videos(property_id,position);
CREATE INDEX properties_discovery_priority
ON properties(featured_until DESC NULLS LAST,is_verified DESC,published_at DESC,id DESC)
WHERE status='active';
