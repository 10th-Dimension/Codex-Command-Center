import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1 } from "./helpers/sqlite-d1";
import { readTelemetryForensicActivity, readTelemetryForensics } from "../src/lib/telemetry/database";
import { buildMaterializedSnapshot, readMaterializedSnapshot, refreshStaleMaterializedSnapshots, writeMaterializedSnapshot } from "../src/lib/telemetry/rollups";
import { createCodexTelemetryProvider } from "../src/lib/providers/codex-core";

const now = new Date("2026-10-26T12:00:00.000Z");
const cutoff = "2026-10-25T12:00:00.000Z";

function seedSessions(database: SqliteD1) {
  database.sqlite.exec(`WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<49999)
    INSERT INTO codex_session_summary(session_id,first_seen_at,last_seen_at,event_count)
    SELECT 'session-'||n,'2026-10-01T00:00:00.000Z',
      CASE WHEN n<2000 THEN '2026-10-26T11:'||printf('%02d',n%60)||':00.000Z' ELSE '2026-10-01T00:00:00.000Z' END,1 FROM seq`);
}

function plan(database: SqliteD1, sql: string, values: unknown[]) {
  return database.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values as never[]).map((row) => String(row.detail));
}

test("session refresh uses a covering count and indexed top-20 instead of scanning/sorting wide history", async () => {
  const database = new SqliteD1();
  try {
    seedSessions(database);
    database.sqlite.exec("DROP INDEX idx_codex_session_summary_last_seen");
    const oldSql = "SELECT *,COUNT(*) OVER() AS range_session_count FROM codex_session_summary WHERE last_seen_at>=? ORDER BY last_seen_at DESC LIMIT 20";
    const before = plan(database, oldSql, [cutoff]);
    assert.ok(before.some((detail) => detail.includes("SCAN codex_session_summary")));
    assert.ok(before.some((detail) => detail.includes("TEMP B-TREE FOR ORDER BY")));
    database.sqlite.exec("CREATE INDEX idx_codex_session_summary_last_seen ON codex_session_summary(last_seen_at DESC)");
    const snapshot = await buildMaterializedSnapshot(database, "24h", now);
    const statement = database.statements.find((item) => item.sql.includes("FROM codex_session_summary"));
    assert.ok(statement);
    const after = plan(database, statement.sql, statement.values);
    assert.ok(after.some((detail) => detail.includes("COVERING INDEX idx_codex_session_summary_last_seen")));
    assert.ok(after.some((detail) => /SEARCH s USING INDEX idx_codex_session_summary_last_seen/.test(detail)));
    assert.ok(!after.some((detail) => /SCAN |TEMP B-TREE/.test(detail)));
    assert.equal(snapshot.summary.sessions, 2000);
    assert.equal(snapshot.sessions.length, 20);
    assert.ok(snapshot.sessions.every((session) => session.lastSeenAt === "2026-10-26T11:59:00.000Z"));
    assert.equal((await buildMaterializedSnapshot(database, "7d", now)).summary.sessions, 2000);
    assert.equal((await buildMaterializedSnapshot(database, "30d", now)).summary.sessions, 50000);
    database.sqlite.exec("DELETE FROM codex_session_summary");
    assert.equal((await buildMaterializedSnapshot(database, "24h", now)).summary.sessions, 0);
    console.log("SESSION QUERY PLANS", { before, after, syntheticSessions: 50000, matching24h: 2000 });
  } finally { database.sqlite.close(); }
});

test("durable claims coalesce concurrent isolates, including a stale metadata read after publication", async () => {
  const first = new SqliteD1();
  const second = new SqliteD1(first.sqlite, false);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let pause = true;
  first.beforeExecute = async (sql) => {
    if (pause && sql.includes("FROM codex_rollup_hourly")) { pause = false; started(); await blocked; }
  };
  try {
    const pending = refreshStaleMaterializedSnapshots(first, now);
    await entered;
    const other = await refreshStaleMaterializedSnapshots(second, now);
    release();
    const original = await pending;
    assert.deepEqual([...original.refreshed, ...other.refreshed].sort(), ["24h", "30d", "7d"]);
    assert.equal([...first.statements, ...second.statements].filter((item) => item.sql.includes("FROM codex_rollup_hourly")).length, 3);
    assert.equal(first.sqlite.prepare("SELECT COUNT(*) AS n FROM codex_snapshot_refresh_lease").get()?.n, 3);
    const readsBefore = second.statements.length;
    assert.deepEqual((await refreshStaleMaterializedSnapshots(second, now)).refreshed, []);
    assert.equal(second.statements.length - readsBefore, 1, "freshness costs one metadata read, no payload or aggregate read");
    assert.ok(!second.statements.at(-1)?.sql.includes("payload_json"));
  } finally { release(); first.sqlite.close(); }
});

test("failed refresh backs off across isolates and an expired claim can recover", async () => {
  const database = new SqliteD1();
  const other = new SqliteD1(database.sqlite, false);
  try {
    for (const range of ["7d", "30d"] as const) await writeMaterializedSnapshot(database, await buildMaterializedSnapshot(database, range, now));
    database.beforeExecute = async (sql) => { if (sql.includes("FROM codex_rollup_hourly")) throw new Error("temporary read failure"); };
    await assert.rejects(refreshStaleMaterializedSnapshots(database, now), /temporary read failure/);
    assert.deepEqual((await refreshStaleMaterializedSnapshots(other, new Date(now.getTime() + 59999))).refreshed, []);
    assert.equal(other.statements.filter((item) => item.sql.includes("FROM codex_rollup_hourly")).length, 0);
    assert.deepEqual((await refreshStaleMaterializedSnapshots(other, new Date(now.getTime() + 60000))).refreshed, ["24h"]);
  } finally { database.sqlite.close(); }
});

test("an old owner cannot overwrite the newer owner's snapshot", async () => {
  const database = new SqliteD1();
  try {
    const old = await buildMaterializedSnapshot(database, "24h", now);
    const newer = { ...old, generatedAt: new Date(now.getTime() + 60000).toISOString() };
    database.sqlite.prepare("INSERT INTO codex_snapshot_refresh_lease VALUES ('24h','new-owner',?)").run(now.getTime() + 120000);
    assert.equal((await writeMaterializedSnapshot(database, newer, "new-owner")).changes, 1);
    assert.equal((await writeMaterializedSnapshot(database, old, "expired-owner")).changes, 0);
    assert.equal((await readMaterializedSnapshot(database, "24h"))?.generatedAt, newer.generatedAt);
  } finally { database.sqlite.close(); }
});

function seedRaw(database: SqliteD1, count: number, table: string, timestamp: string, prefix: string) {
  database.sqlite.exec(`WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<${count - 1})
    INSERT INTO ${table}(id,event_fingerprint,occurred_at,received_at,event_name,event_category,input_tokens)
    SELECT '${prefix}-'||n,'${prefix}-'||n,'${timestamp}','${timestamp}','codex.api_request','api-request',10 FROM seq`);
}

test("visible forensics merges indexed bounded generations even above 50k events", async () => {
  const database = new SqliteD1();
  try {
    seedRaw(database, 30000, "codex_telemetry_events", "2026-10-26T10:00:00.000Z", "legacy");
    seedRaw(database, 30000, "codex_telemetry_events_compact", "2026-10-26T11:00:00.000Z", "compact");
    const result = await readTelemetryForensicActivity(database, now);
    assert.equal(result.activity.length, 25);
    assert.equal(result.truncated, true);
    assert.ok(result.activity.every((event) => event.id.startsWith("compact-")));
    assert.equal(database.statements.length, 1);
    const statement = database.statements[0];
    const details = plan(database, statement.sql, statement.values);
    assert.ok(details.some((detail) => detail.includes("idx_codex_telemetry_events_occurred_at")));
    assert.ok(details.some((detail) => detail.includes("PRIMARY KEY (occurred_at>?)")));
    assert.ok(!details.some((detail) => /^SCAN codex_telemetry_events(?:_compact)?$/.test(detail)));
    const provider = createCodexTelemetryProvider({ getRuntime: async () => ({ database, retentionDays: 30 }), now: () => now });
    const provided = await provider.getForensics({ requestedAt: now.toISOString() });
    assert.equal(provided.status, "connected");
    assert.equal(database.statements.length, 2, "the provider must not invoke the analytics fan-out");
  } finally { database.sqlite.close(); }
});

test("full forensic analytics excludes older backlog from every aggregate and its metadata", async () => {
  const database = new SqliteD1();
  try {
    seedRaw(database, 100, "codex_telemetry_events", "2026-08-01T11:00:00.000Z", "expired");
    seedRaw(database, 2, "codex_telemetry_events_compact", "2026-10-26T11:00:00.000Z", "recent");
    const result = await readTelemetryForensics(database, now);
    assert.equal(result.eventCount, 2);
    assert.equal(result.usage.find((item) => item.window === "30d")?.inputTokens.value, 20);
    assert.equal(result.oldestEventAt, "2026-10-26T11:00:00.000Z");
    assert.ok(database.statements.every((item) => /WHERE occurred_at\s*>=\s*\?/.test(item.sql)));
  } finally { database.sqlite.close(); }
});

test("forensic action explicitly disables prefetch", async () => {
  const source = await readFile(new URL("../src/components/dashboard/command-pages.tsx", import.meta.url), "utf8");
  assert.match(source, /<Link prefetch=\{false\} href=\{`[^`]*forensics=1`\}/);
});
