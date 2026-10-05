ALTER TABLE properties
ADD COLUMN lister_relationship text NOT NULL DEFAULT 'owner'
CHECK (lister_relationship IN ('owner', 'authorized_agent'));

CREATE TABLE inspections (
    id uuid PRIMARY KEY,
    property_id uuid NOT NULL REFERENCES properties ON DELETE CASCADE,
    seeker_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    proposed_at timestamptz NOT NULL,
    note text NOT NULL CHECK (length(note) BETWEEN 10 AND 1000),
    status text NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (seeker_id <> agent_id)
);

CREATE INDEX inspections_seeker ON inspections(seeker_id, created_at DESC);
CREATE INDEX inspections_agent ON inspections(agent_id, created_at DESC);
CREATE UNIQUE INDEX one_open_inspection_per_property
ON inspections(property_id, seeker_id)
WHERE status IN ('requested', 'confirmed');

CREATE TABLE agent_reviews (
    id uuid PRIMARY KEY,
    inspection_id uuid NOT NULL UNIQUE REFERENCES inspections ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    communication smallint NOT NULL CHECK (communication BETWEEN 1 AND 5),
    punctuality smallint NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
    property_accuracy smallint NOT NULL CHECK (property_accuracy BETWEEN 1 AND 5),
    professionalism smallint NOT NULL CHECK (professionalism BETWEEN 1 AND 5),
    comment text NOT NULL CHECK (length(comment) BETWEEN 10 AND 1500),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reviewer_id <> agent_id)
);

CREATE INDEX agent_reviews_profile ON agent_reviews(agent_id, created_at DESC);
