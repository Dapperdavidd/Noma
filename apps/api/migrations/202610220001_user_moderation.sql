ALTER TABLE moderation_events
DROP CONSTRAINT moderation_events_target_type_check;

ALTER TABLE moderation_events
ADD CONSTRAINT moderation_events_target_type_check
CHECK(target_type IN ('property','agent','report','user'));
