-- Migration 013: Add time_tracking_user_id to developers table
-- Links N2O developers to their external time-tracking provider user ID (currently Toggl).

ALTER TABLE developers ADD COLUMN time_tracking_user_id INTEGER;
COMMENT ON COLUMN developers.time_tracking_user_id IS 'External time-tracking provider user ID (currently Toggl)';
