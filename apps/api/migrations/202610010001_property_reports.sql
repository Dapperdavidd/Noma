ALTER TABLE moderation_events
    DROP CONSTRAINT moderation_events_target_type_check;
ALTER TABLE moderation_events
    ADD CONSTRAINT moderation_events_target_type_check
    CHECK(target_type IN ('property','agent','report'));

CREATE TABLE property_reports (
 id uuid PRIMARY KEY,
 property_id uuid NOT NULL REFERENCES properties ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('suspected_scam','duplicate','inaccurate','unavailable','other')),
 details text NOT NULL CHECK(length(details) BETWEEN 10 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
 resolution_reason text CHECK(resolution_reason IS NULL OR length(resolution_reason) BETWEEN 5 AND 2000),
 reviewed_by uuid REFERENCES users,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='open' AND reviewed_by IS NULL AND reviewed_at IS NULL AND resolution_reason IS NULL)
    OR (status<>'open' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_property_report
    ON property_reports(property_id,reporter_id) WHERE status='open';
CREATE INDEX property_reports_review_queue
    ON property_reports(created_at,id) WHERE status='open';
