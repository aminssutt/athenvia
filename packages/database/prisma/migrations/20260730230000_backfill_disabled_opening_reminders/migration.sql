-- The former Settings switch used notify_on_open as the master opening-reminder
-- toggle while leaving positive offsets behind. Preserve that explicit opt-out
-- before the new UI starts treating notify_on_open as the day-zero choice.
UPDATE "notification_preferences"
SET "before_open_days" = ARRAY[]::INTEGER[]
WHERE "notify_on_open" = false
  AND cardinality("before_open_days") > 0;
