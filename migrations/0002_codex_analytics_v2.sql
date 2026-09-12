-- Codex telemetry analytics v2
-- Additive, privacy-reviewed scalar dimensions only. No content-bearing values.

ALTER TABLE codex_telemetry_events ADD COLUMN event_kind TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN reasoning_effort TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE codex_telemetry_events ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE codex_telemetry_events ADD COLUMN tool_tokens INTEGER;
ALTER TABLE codex_telemetry_events ADD COLUMN ttft_ms REAL;
ALTER TABLE codex_telemetry_events ADD COLUMN tool_namespace TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN call_id_hash TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN tool_execution_state TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN approval_policy TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN sandbox_policy TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN agent_name TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN provider_name TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN originator TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN mcp_server_origin TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN app_version TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN service_name TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN service_version TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN startup_phase TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN startup_status TEXT;
ALTER TABLE codex_telemetry_events ADD COLUMN terminal_type TEXT;

-- Recover only categories supported by values already retained in schema v1.
-- Attribute values intentionally discarded by v1 remain unrecoverable.
UPDATE codex_telemetry_events
SET event_category = CASE
  WHEN error_type IS NOT NULL OR severity_number >= 17 OR lower(COALESCE(severity_text, '')) LIKE '%error%' THEN 'error'
  WHEN severity_number >= 13 OR lower(COALESCE(severity_text, '')) LIKE '%warn%' THEN 'warning'
  WHEN approval_decision IS NOT NULL OR decision IS NOT NULL THEN 'approval'
  WHEN mcp_server IS NOT NULL OR mcp_tool IS NOT NULL THEN 'mcp'
  WHEN tool_name IS NOT NULL OR tool_type IS NOT NULL OR tool_status IS NOT NULL THEN 'tool'
  WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL THEN 'usage'
  ELSE event_category
END
WHERE event_category = 'unknown';

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_reasoning_occurred_at
  ON codex_telemetry_events(reasoning_effort, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_call_occurred_at
  ON codex_telemetry_events(call_id_hash, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_tool_state_occurred_at
  ON codex_telemetry_events(tool_execution_state, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_ttft_occurred_at
  ON codex_telemetry_events(occurred_at DESC) WHERE ttft_ms IS NOT NULL;

PRAGMA optimize;
