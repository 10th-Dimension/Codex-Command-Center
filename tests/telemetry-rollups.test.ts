import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../src/lib/telemetry/database";
import type { NormalizedTelemetryEvent } from "../src/lib/telemetry/normalize";
import { applyTelemetryRollups, buildMaterializedSnapshot, groupTelemetryRollups, refreshStaleMaterializedSnapshots, writeMaterializedSnapshot } from "../src/lib/telemetry/rollups";

const now = new Date("2026-09-13T12:00:00.000Z");

function event(overrides: Partial<NormalizedTelemetryEvent> = {}): NormalizedTelemetryEvent {
  return {
    id: overrides.id ?? "event-1", fingerprint: overrides.fingerprint ?? "fingerprint-1",
    occurredAt: overrides.occurredAt ?? "2026-09-13T11:42:00.000Z", receivedAt: overrides.receivedAt ?? "2026-09-13T11:42:01.000Z",
    eventName: overrides.eventName ?? "codex.api_request", category: overrides.category ?? "api-request",
    safeAttributeKeys: [], unknownAttributeKeys: [], redactedAttributeCount: 0, source: "openai-codex-otel", schemaVersion: 2,
    ...overrides,
  };
}

class Statement implements D1PreparedStatementLike {
  values: unknown[] = [];
  constructor(readonly database: SnapshotD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1ResultLike<T>> { return this.database.execute(this) as D1ResultLike<T>; }
  async all<T>(): Promise<D1ResultLike<T>> { return this.database.execute(this) as D1ResultLike<T>; }
}

class SnapshotD1 implements D1DatabaseLike {
  statements: Statement[] = [];
  existingSnapshots: Record<string, unknown>[] = [];
  sessionRows: Record<string, unknown>[] = [{ session_id: "session-1", project_name: "Command Center", first_seen_at: "2026-09-13T11:00:00.000Z", last_seen_at: "2026-09-13T11:50:00.000Z", latest_model: "model-0", latest_reasoning_effort: "xhigh", event_count: 3, input_tokens: 18, output_tokens: 4, cached_tokens: 5, cache_write_tokens: 0, reasoning_tokens: 7, tool_tokens: 3, completed_tools: 2, failed_tools: 1, error_count: 1, warning_count: 0, approvals: 1, ttft_sum_ms: 300, ttft_sample_count: 2, range_session_count: 1 }];
  prepare(sql: string) { const statement = new Statement(this, sql); this.statements.push(statement); return statement; }
  async batch<T>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> { return statements.map((statement) => this.execute(statement as Statement) as D1ResultLike<T>); }
  execute(statement: Statement): D1ResultLike {
    if (statement.sql.includes("FROM codex_rollup_hourly")) return { success: true, results: [{ label: "2026-09-13T11:00:00.000Z", event_count: 3, input_tokens: 18, input_samples: 2, output_tokens: 4, output_samples: 1, cached_tokens: 5, cached_samples: 1, cache_write_tokens: 0, cache_write_samples: 0, reasoning_tokens: 7, reasoning_samples: 1, tool_tokens: 3, tool_token_samples: 1, error_count: 1, warning_count: 0, completed_tools: 2, failed_tools: 1, approvals: 1, ttft_sum_ms: 300, ttft_sample_count: 2, duration_sum_ms: 900, duration_sample_count: 3, last_received_at: "2026-09-13T11:50:00.000Z" }] };
    if (statement.sql.includes("FROM codex_rollup_model_hourly")) return { success: true, results: Array.from({ length: 12 }, (_, index) => ({ label: `model-${index}`, count: 12 - index })).slice(0, 8) };
    if (statement.sql.includes("FROM codex_rollup_reasoning_hourly")) return { success: true, results: [{ label: "xhigh", count: 2 }] };
    if (statement.sql.includes("FROM codex_session_summary")) return { success: true, results: this.sessionRows };
    if (statement.sql.includes("FROM codex_dashboard_snapshot")) return { success: true, results: this.existingSnapshots };
    return { success: true, meta: { changes: 1 } };
  }
}

test("rollups group scalar trends into ten-minute buckets while dimensions stay hourly", () => {
  const grouped = groupTelemetryRollups([
    event({ id: "1", fingerprint: "1", sessionId: "session-1", model: "gpt-a", reasoningEffort: "high", inputTokens: 10, outputTokens: 4, ttftMs: 100, durationMs: 300, toolExecutionState: "succeeded" }),
    event({ id: "2", fingerprint: "2", sessionId: "session-1", model: "gpt-a", reasoningEffort: "high", inputTokens: 8, cachedInputTokens: 5, reasoningTokens: 7, toolTokens: 3, ttftMs: 200, durationMs: 400, toolExecutionState: "failed", category: "error" }),
    event({ id: "3", fingerprint: "3", sessionId: "session-1", occurredAt: "2026-09-13T12:01:00.000Z", category: "approval", durationMs: 200 }),
  ]);
  assert.equal(grouped.hourly.size, 2);
  assert.equal(grouped.models.size, 1);
  assert.equal(grouped.reasoning.size, 1);
  assert.equal(grouped.sessions.size, 1);
  const firstBucket = grouped.hourly.get("2026-09-13T11:40:00.000Z");
  assert.deepEqual({ events: firstBucket?.eventCount, input: firstBucket?.inputTokens, inputSamples: firstBucket?.inputSamples, completed: firstBucket?.completedTools, failed: firstBucket?.failedTools, errors: firstBucket?.errorCount, ttft: firstBucket?.ttftSumMs, ttftSamples: firstBucket?.ttftSampleCount }, { events: 2, input: 18, inputSamples: 2, completed: 2, failed: 1, errors: 1, ttft: 300, ttftSamples: 2 });
  const session = grouped.sessions.get("session-1");
  assert.equal(session?.eventCount, 3);
  assert.equal(session?.approvals, 1);
  assert.equal(session?.durationSumMs, 900);
});

test("ten-minute trend buckets preserve exact event boundaries without increasing dimension buckets", () => {
  const grouped = groupTelemetryRollups([
    event({ id: "early", fingerprint: "early", occurredAt: "2026-09-13T11:09:59.000Z", model: "gpt-a", reasoningEffort: "high" }),
    event({ id: "next", fingerprint: "next", occurredAt: "2026-09-13T11:10:00.000Z", model: "gpt-a", reasoningEffort: "high" }),
  ]);
  assert.deepEqual([...grouped.hourly.keys()], ["2026-09-13T11:00:00.000Z", "2026-09-13T11:10:00.000Z"]);
  assert.equal(grouped.models.size, 1);
  assert.equal(grouped.reasoning.size, 1);
});

test("session latest dimensions follow telemetry time and never cross session boundaries", () => {
  const grouped = groupTelemetryRollups([
    event({ id: "new", fingerprint: "new", sessionId: "session-a", occurredAt: "2026-09-13T11:55:00.000Z", model: "gpt-5.6-sol", reasoningEffort: "medium" }),
    event({ id: "old", fingerprint: "old", sessionId: "session-a", occurredAt: "2026-09-13T11:05:00.000Z", model: "gpt-5.6-luna", reasoningEffort: "low" }),
    event({ id: "missing", fingerprint: "missing", sessionId: "session-b", occurredAt: "2026-09-13T11:59:00.000Z" }),
  ]);
  assert.equal(grouped.sessions.get("session-a")?.latestModel, "gpt-5.6-sol");
  assert.equal(grouped.sessions.get("session-a")?.latestReasoningEffort, "medium");
  assert.equal(grouped.sessions.get("session-b")?.latestModel, undefined);
  assert.equal(grouped.sessions.get("session-b")?.latestReasoningEffort, undefined);
});

test("session model and reasoning retain independent latest non-null observations", () => {
  const grouped = groupTelemetryRollups([
    event({ id: "model", fingerprint: "model", sessionId: "one", occurredAt: "2026-09-13T11:10:00.000Z", model: "gpt-future-model" }),
    event({ id: "reasoning", fingerprint: "reasoning", sessionId: "one", occurredAt: "2026-09-13T11:20:00.000Z", reasoningEffort: "future-effort" }),
    event({ id: "empty", fingerprint: "empty", sessionId: "one", occurredAt: "2026-09-13T11:30:00.000Z" }),
  ]);
  assert.equal(grouped.sessions.get("one")?.latestModel, "gpt-future-model");
  assert.equal(grouped.sessions.get("one")?.latestReasoningEffort, "future-effort");
});

test("rollup writes are bounded to grouped upserts rather than event-by-event writes", async () => {
  const database = new SnapshotD1();
  const events = Array.from({ length: 10 }, (_, index) => event({ id: String(index), fingerprint: String(index), sessionId: "one-session", model: "one-model", reasoningEffort: "high" }));
  const result = await applyTelemetryRollups(database, events);
  assert.deepEqual(result, { hourlyGroups: 1, modelGroups: 1, reasoningGroups: 1, sessionGroups: 1 });
  assert.equal(database.statements.filter((statement) => statement.sql.startsWith("INSERT INTO codex_")).length, 4);
});

test("materialized snapshots preserve measured missingness, averages, bounds, and privacy", async () => {
  const database = new SnapshotD1();
  const snapshot = await buildMaterializedSnapshot(database, "24h", now);
  assert.equal(snapshot.summary.events, 3);
  assert.deepEqual(snapshot.summary.inputTokens, { availability: "available", value: 18, sampleCount: 2 });
  assert.deepEqual(snapshot.summary.cacheWriteTokens, { availability: "no-samples", sampleCount: 0 });
  assert.equal(snapshot.summary.averageTtftMs, 150);
  assert.equal(snapshot.summary.failedTools, 1);
  assert.equal(snapshot.models.length, 8);
  assert.equal(snapshot.sessions[0].failedTools, 1);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /"(?:prompt|command|arguments|stdout|stderr|reasoningText|authorization|credential|secret)"\s*:/i);
  await writeMaterializedSnapshot(database, snapshot);
  const write = database.statements.find((statement) => statement.sql.startsWith("INSERT INTO codex_dashboard_snapshot"));
  assert.ok(write);
  assert.ok(String(write.values[3]).length < 262_144);
  const trendRead = database.statements.find((statement) => statement.sql.includes("FROM codex_rollup_hourly"));
  assert.ok(trendRead);
  assert.match(trendRead.sql, /WHERE hour_start>=\?/);
  assert.match(trendRead.sql, /LIMIT 744/);
  assert.doesNotMatch(trendRead.sql, /codex_telemetry_events/);
});

test("materialized snapshot keeps the newest observed model and reasoning first", async () => {
  const database = new SnapshotD1();
  const base = database.sessionRows[0];
  database.sessionRows = [
    { ...base, session_id: "new-sol", last_seen_at: "2026-09-13T11:58:00.000Z", latest_model: "gpt-5.6-sol", latest_reasoning_effort: "medium", range_session_count: 2 },
    { ...base, session_id: "old-luna", last_seen_at: "2026-09-13T11:20:00.000Z", latest_model: "gpt-5.6-luna", latest_reasoning_effort: "low", range_session_count: 2 },
  ];
  const snapshot = await buildMaterializedSnapshot(database, "24h", now);
  assert.equal(snapshot.sessions[0].models[0], "gpt-5.6-sol");
  assert.equal(snapshot.sessions[0].reasoningEfforts[0], "medium");
});

test("snapshot freshness refreshes only stale ranges", async () => {
  const database = new SnapshotD1();
  database.existingSnapshots = [
    { range: "24h", generated_at: "2026-09-13T11:59:30.000Z", payload_json: "{}" },
    { range: "7d", generated_at: "2026-09-13T11:50:00.000Z", payload_json: "{}" },
    { range: "30d", generated_at: "2026-09-13T11:30:00.000Z", payload_json: "{}" },
  ];
  assert.deepEqual(await refreshStaleMaterializedSnapshots(database, now), { refreshed: ["30d"] });
});

test("24h, 7d, and 30d snapshot builders stay range-keyed", async () => {
  const snapshots = await Promise.all((["24h", "7d", "30d"] as const).map((range) => buildMaterializedSnapshot(new SnapshotD1(), range, now)));
  assert.deepEqual(snapshots.map((snapshot) => snapshot.range), ["24h", "7d", "30d"]);
  assert.ok(snapshots.every((snapshot) => snapshot.schemaVersion === 1 && snapshot.trend.length === 1));
});

test("migration 0003 is additive, bounded, and contains no private-content columns", async () => {
  const migration = await readFile(new URL("../migrations/0003_codex_rollups.sql", import.meta.url), "utf8");
  for (const table of ["codex_rollup_hourly", "codex_rollup_model_hourly", "codex_rollup_reasoning_hourly", "codex_session_summary", "codex_dashboard_snapshot"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /length\(payload_json\) <= 262144/);
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|prompt|command|arguments|stdout|stderr|reasoning_text|credential|secret/i);
});

test("normal dashboard and overlay sources cannot reference the raw telemetry table", async () => {
  const [provider, overlay, queries, database] = await Promise.all([
    readFile(new URL("../src/lib/providers/codex-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/overlay/query.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dashboard/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/telemetry/database.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(provider, /codex_telemetry_events/);
  assert.doesNotMatch(overlay, /codex_telemetry_events/);
  assert.match(provider, /readMaterializedSnapshots/);
  assert.match(overlay, /readMaterializedSnapshot/);
  assert.match(database, /readTelemetryForensics[\s\S]+codex_telemetry_events/);
  const githubOnly = queries.slice(queries.indexOf("export async function getGitHubPageData"));
  assert.doesNotMatch(githubOnly, /providerRegistry\.codex|CODEX_TELEMETRY_DB/);
});
