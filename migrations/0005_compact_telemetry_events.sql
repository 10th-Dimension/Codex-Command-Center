-- Route new raw telemetry into one clustered WITHOUT ROWID structure. The
-- occurred_at-leading primary key serves retention and forensic range reads,
-- while id retains the existing event-fingerprint deduplication identity.
-- Existing raw evidence remains in codex_telemetry_events and is exposed
-- together with new evidence through codex_telemetry_events_all.

CREATE TABLE IF NOT EXISTS codex_telemetry_events_compact (
  id TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
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
  schema_version INTEGER NOT NULL DEFAULT 2,
  event_kind TEXT,
  reasoning_effort TEXT,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  tool_tokens INTEGER,
  ttft_ms REAL,
  tool_namespace TEXT,
  call_id_hash TEXT,
  tool_execution_state TEXT,
  approval_policy TEXT,
  sandbox_policy TEXT,
  agent_name TEXT,
  provider_name TEXT,
  originator TEXT,
  mcp_server_origin TEXT,
  app_version TEXT,
  service_name TEXT,
  service_version TEXT,
  startup_phase TEXT,
  startup_status TEXT,
  terminal_type TEXT,
  PRIMARY KEY (occurred_at, id)
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS codex_telemetry_events_all AS
  SELECT * FROM codex_telemetry_events
  UNION ALL
  SELECT * FROM codex_telemetry_events_compact;

-- Normal dashboard and overlay reads no longer use raw dimensions. Explicit
-- Forensics is capped before fan-out and can use the retained occurred_at
-- index, so these secondary indexes only amplify legacy retention deletes.
DROP INDEX IF EXISTS idx_codex_telemetry_events_category_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_session_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_project_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_model_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_tool_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_mcp_server_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_success_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_network_decision_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_reasoning_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_call_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_tool_state_occurred_at;
DROP INDEX IF EXISTS idx_codex_telemetry_events_ttft_occurred_at;
DROP INDEX IF EXISTS idx_codex_session_summary_last_seen;

PRAGMA optimize;
