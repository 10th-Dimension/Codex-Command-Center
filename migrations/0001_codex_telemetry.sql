CREATE TABLE IF NOT EXISTS codex_telemetry_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_fingerprint TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL,
  environment TEXT,
  severity_text TEXT,
  severity_number INTEGER,
  session_id TEXT,
  thread_id TEXT,
  task_id TEXT,
  project_id TEXT,
  project_name TEXT,
  repository_id TEXT,
  workspace_id TEXT,
  model TEXT,
  tool_name TEXT,
  tool_type TEXT,
  tool_status TEXT,
  decision TEXT,
  approval_decision TEXT,
  mcp_server TEXT,
  mcp_tool TEXT,
  network_host TEXT,
  network_decision TEXT,
  success INTEGER,
  status TEXT,
  error_type TEXT,
  duration_ms REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_output_tokens INTEGER,
  safe_attribute_keys_json TEXT NOT NULL DEFAULT '[]',
  unknown_attribute_keys_json TEXT NOT NULL DEFAULT '[]',
  redacted_attribute_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'openai-codex-otel',
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_occurred_at
ON codex_telemetry_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_category_occurred_at
ON codex_telemetry_events(event_category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_session_occurred_at
ON codex_telemetry_events(session_id, occurred_at DESC)
WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_project_occurred_at
ON codex_telemetry_events(project_id, occurred_at DESC)
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_model_occurred_at
ON codex_telemetry_events(model, occurred_at DESC)
WHERE model IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_tool_occurred_at
ON codex_telemetry_events(tool_name, occurred_at DESC)
WHERE tool_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_mcp_server_occurred_at
ON codex_telemetry_events(mcp_server, occurred_at DESC)
WHERE mcp_server IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_success_occurred_at
ON codex_telemetry_events(success, occurred_at DESC)
WHERE success IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_codex_telemetry_events_network_decision_occurred_at
ON codex_telemetry_events(network_decision, occurred_at DESC)
WHERE network_decision IS NOT NULL;

PRAGMA optimize;
