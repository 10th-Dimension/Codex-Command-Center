-- Session summaries are used by snapshot rebuilds and retention, not just UI reads.
CREATE INDEX IF NOT EXISTS idx_codex_session_summary_last_seen
  ON codex_session_summary(last_seen_at DESC);

-- Three durable claims coalesce refreshes across Worker isolates. No raw backfill.
CREATE TABLE IF NOT EXISTS codex_snapshot_refresh_lease (
  range TEXT PRIMARY KEY CHECK (range IN ('24h', '7d', '30d')),
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
