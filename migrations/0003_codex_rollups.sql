-- Incremental, privacy-safe analytics for normal Codex dashboard reads.
-- Raw events remain the forensic source of truth and are not scanned by normal UI paths.

CREATE TABLE IF NOT EXISTS codex_rollup_hourly (
  hour_start TEXT PRIMARY KEY,
  event_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  input_samples INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  output_samples INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cached_samples INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_samples INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_samples INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  tool_token_samples INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  completed_tools INTEGER NOT NULL DEFAULT 0,
  failed_tools INTEGER NOT NULL DEFAULT 0,
  approvals INTEGER NOT NULL DEFAULT 0,
  ttft_sum_ms REAL NOT NULL DEFAULT 0,
  ttft_sample_count INTEGER NOT NULL DEFAULT 0,
  duration_sum_ms REAL NOT NULL DEFAULT 0,
  duration_sample_count INTEGER NOT NULL DEFAULT 0,
  last_received_at TEXT
);

CREATE TABLE IF NOT EXISTS codex_rollup_model_hourly (
  hour_start TEXT NOT NULL,
  model TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  ttft_sum_ms REAL NOT NULL DEFAULT 0,
  ttft_sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, model)
);

CREATE TABLE IF NOT EXISTS codex_rollup_reasoning_hourly (
  hour_start TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  ttft_sum_ms REAL NOT NULL DEFAULT 0,
  ttft_sample_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, reasoning_effort)
);

CREATE TABLE IF NOT EXISTS codex_session_summary (
  session_id TEXT PRIMARY KEY,
  project_name TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_model TEXT,
  latest_reasoning_effort TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  completed_tools INTEGER NOT NULL DEFAULT 0,
  failed_tools INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  approvals INTEGER NOT NULL DEFAULT 0,
  ttft_sum_ms REAL NOT NULL DEFAULT 0,
  ttft_sample_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_codex_session_summary_last_seen
  ON codex_session_summary(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS codex_dashboard_snapshot (
  range TEXT PRIMARY KEY CHECK (range IN ('24h', '7d', '30d')),
  generated_at TEXT NOT NULL,
  source_updated_at TEXT,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 262144)
);

PRAGMA optimize;
