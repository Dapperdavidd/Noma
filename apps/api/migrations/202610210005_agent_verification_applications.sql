ALTER TABLE agent_profiles
DROP CONSTRAINT agent_profiles_verification_status_check;

ALTER TABLE agent_profiles
ALTER COLUMN verification_status SET DEFAULT 'unsubmitted';

UPDATE agent_profiles
SET verification_status='unsubmitted'
WHERE verification_status='pending';

ALTER TABLE agent_profiles
ADD CONSTRAINT agent_profiles_verification_status_check
CHECK (verification_status IN ('unsubmitted','pending','verified','rejected'));

ALTER TABLE agent_profiles
ADD COLUMN license_number text,
ADD COLUMN years_experience smallint CHECK (years_experience BETWEEN 0 AND 80),
ADD COLUMN service_areas text[] NOT NULL DEFAULT '{}',
ADD COLUMN website_url text CHECK (website_url IS NULL OR website_url LIKE 'https://%'),
ADD COLUMN verification_requested_at timestamptz;

CREATE TABLE agent_verification_applications (
    id uuid PRIMARY KEY,
    agent_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    profile_snapshot jsonb NOT NULL,
    declaration_accepted_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','withdrawn')),
    reviewer_id uuid REFERENCES users ON DELETE SET NULL,
    review_reason text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

CREATE UNIQUE INDEX one_pending_agent_verification
ON agent_verification_applications(agent_id)
WHERE status='pending';

CREATE INDEX agent_verification_review_queue
ON agent_verification_applications(submitted_at,id)
WHERE status='pending';
