-- Migration 012: Toggl Integration — Drop Stale Tables + Create Members
-- Removes pre-synced Toggl tables, creates toggl_members for role config.
-- Time entries now come from live Toggl API calls (cached, rate-limited).

DROP TABLE IF EXISTS toggl_time_entries;
DROP TABLE IF EXISTS toggl_sync_state;
DROP TABLE IF EXISTS toggl_projects;
DROP TABLE IF EXISTS toggl_clients;

-- Team members with roles (drives weekly hour targets)
CREATE TABLE IF NOT EXISTS toggl_members (
  id          SERIAL PRIMARY KEY,
  toggl_name  TEXT NOT NULL UNIQUE,
  email       TEXT,
  role        TEXT NOT NULL CHECK (role IN ('leadership', 'developer', 'non-developer')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
