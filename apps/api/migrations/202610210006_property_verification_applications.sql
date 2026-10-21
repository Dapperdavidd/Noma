CREATE TABLE property_verification_applications (
    id uuid PRIMARY KEY,
    property_id uuid NOT NULL REFERENCES properties ON DELETE CASCADE,
    applicant_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    lister_relationship text NOT NULL
        CHECK (lister_relationship IN ('owner','authorized_agent')),
    evidence_type text NOT NULL CHECK (evidence_type IN (
        'certificate_of_occupancy','deed_of_assignment','tenancy_authorization',
        'agency_mandate','other'
    )),
    document_reference text,
    evidence_note text NOT NULL CHECK (length(evidence_note) BETWEEN 30 AND 2000),
    evidence_url text CHECK (evidence_url IS NULL OR evidence_url LIKE 'https://%'),
    property_snapshot jsonb NOT NULL,
    declaration_accepted_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','withdrawn')),
    reviewer_id uuid REFERENCES users ON DELETE SET NULL,
    review_reason text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

CREATE UNIQUE INDEX one_pending_property_verification
ON property_verification_applications(property_id)
WHERE status='pending';

CREATE INDEX property_verification_review_queue
ON property_verification_applications(submitted_at,id)
WHERE status='pending';
