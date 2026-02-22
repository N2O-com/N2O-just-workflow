-- Skill quality: add per-tool-call token tracking to workflow_events
ALTER TABLE workflow_events ADD COLUMN input_tokens INTEGER;
ALTER TABLE workflow_events ADD COLUMN output_tokens INTEGER;
ALTER TABLE workflow_events ADD COLUMN tool_calls_in_msg INTEGER;

-- Index for skill-level queries
CREATE INDEX IF NOT EXISTS idx_events_skill ON workflow_events(skill_name);
