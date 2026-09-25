import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../src/lib/telemetry/database";
import type { NormalizedTelemetryEvent } from "../src/lib/telemetry/normalize";
import { applyTelemetryRollups, buildMaterializedSnapshot, groupTelemetryRollups, readMaterializedSnapshot, refreshStaleMaterializedSnapshots, writeMaterializedSnapshot } from "../src/lib/telemetry/rollups";

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
  hourlyRows: Record<string, unknown>[] = [{ label: "2026-09-13T11:00:00.000Z", event_count: 3, input_tokens: 18, input_samples: 2, output_tokens: 4, output_samples: 1, cached_tokens: 5, cached_samples: 1, cache_write_tokens: 0, cache_write_samples: 0, reasoning_tokens: 7, reasoning_samples: 1, tool_tokens: 3, tool_token_samples: 1, error_count: 1, warning_count: 0, completed_tools: 2, failed_tools: 1, approvals: 1, ttft_sum_ms: 300, ttft_sample_count: 2, duration_sum_ms: 900, duration_sample_count: 3, last_received_at: "2026-09-13T11:50:00.000Z", pricing_input_tokens: 18, pricing_input_samples: 2, pricing_cached_tokens: 5, pricing_cached_samples: 1, pricing_cache_write_tokens: 0, pricing_cache_write_samples: 0, pricing_output_tokens: 4, pricing_output_samples: 1 }];
  modelRows: Record<string, unknown>[] = Array.from({ length: 12 }, (_, index) => ({ label: `model-${index}`, count: 12 - index, input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, tool_tokens: 0, pricing_input_tokens: 0, pricing_cached_tokens: 0, pricing_cache_write_tokens: 0, pricing_output_tokens: 0, pricing_sample_count: 0, pricing_category_overlap_tokens: 0, model_count: 12, model_token_count: 0 }));
  sessionRows: Record<string, unknown>[] = [{ session_id: "session-1", project_name: "Command Center", first_seen_at: "2026-09-13T11:00:00.000Z", last_seen_at: "2026-09-13T11:50:00.000Z", latest_model: "model-0", latest_reasoning_effort: "xhigh", event_count: 3, input_tokens: 18, output_tokens: 4, cached_tokens: 5, cache_write_tokens: 0, reasoning_tokens: 7, tool_tokens: 3, completed_tools: 2, failed_tools: 1, error_count: 1, warning_count: 0, approvals: 1, ttft_sum_ms: 300, ttft_sample_count: 2, range_session_count: 1 }];
  prepare(sql: string) { const statement = new Statement(this, sql); this.statements.push(statement); return statement; }
  async batch<T>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> { return statements.map((statement) => this.execute(statement as Statement) as D1ResultLike<T>); }
  execute(statement: Statement): D1ResultLike {
    if (statement.sql.includes("FROM codex_rollup_hourly")) return { success: true, results: this.hourlyRows };
    if (statement.sql.includes("FROM codex_rollup_model_hourly")) return { success: true, results: this.modelRows.slice(0, 8) };
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

test("model rollups retain exact disjoint pricing categories only for complete non-overlapping samples", () => {
  const grouped = groupTelemetryRollups([
    event({ id: "complete", fingerprint: "complete", model: "gpt-6-sol", inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 10, outputTokens: 30 }),
    event({ id: "incomplete", fingerprint: "incomplete", model: "gpt-6-sol", inputTokens: 50, outputTokens: 10 }),
    event({ id: "overlap", fingerprint: "overlap", model: "gpt-6-sol", inputTokens: 20, cachedInputTokens: 15, cacheWriteTokens: 10, outputTokens: 5 }),
  ]);
  const model = grouped.models.get("2026-09-13T11:00:00.000Z\u0000gpt-6-sol");
  assert.ok(model);
  assert.equal(model.pricingInputTokens, 100);
  assert.equal(model.pricingCachedTokens, 20);
  assert.equal(model.pricingCacheWriteTokens, 10);
  assert.equal(model.pricingOutputTokens, 30);
  assert.equal(model.pricingSampleCount, 1);
  assert.equal(model.pricingCategoryOverlapTokens, 5);
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

test("pricing snapshot aligns scalar and model rollups to the same complete-hour cutoff", async () => {
  const database = new SnapshotD1();
  database.hourlyRows = [{
    label: "2026-09-13T12:00:00.000Z", event_count: 1, input_tokens: 100, input_samples: 1, output_tokens: 20, output_samples: 1,
    cached_tokens: 20, cached_samples: 1, cache_write_tokens: 10, cache_write_samples: 1, reasoning_tokens: 5, reasoning_samples: 1,
    tool_tokens: 0, tool_token_samples: 0, error_count: 0, warning_count: 0, completed_tools: 0, failed_tools: 0, approvals: 0,
    ttft_sum_ms: 0, ttft_sample_count: 0, duration_sum_ms: 0, duration_sample_count: 0, last_received_at: "2026-09-13T12:43:00.000Z",
    pricing_input_tokens: 100, pricing_input_samples: 1, pricing_cached_tokens: 20, pricing_cached_samples: 1,
    pricing_cache_write_tokens: 10, pricing_cache_write_samples: 1, pricing_output_tokens: 20, pricing_output_samples: 1,
  }];
  database.modelRows = [{
    label: "gpt-6-sol", count: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 20, reasoning_tokens: 5, tool_tokens: 0,
    pricing_input_tokens: 100, pricing_cached_tokens: 20, pricing_cache_write_tokens: 10, pricing_output_tokens: 20,
    pricing_sample_count: 1, pricing_category_overlap_tokens: 0, model_count: 1, model_token_count: 120,
  }];

  const snapshot = await buildMaterializedSnapshot(database, "24h", new Date("2026-09-13T12:43:00.000Z"));
  const cutoff = "2026-09-12T12:43:00.000Z";
  const completeHourCutoff = "2026-09-12T13:00:00.000Z";
  const hourlyRead = database.statements.find((statement) => statement.sql.includes("FROM codex_rollup_hourly"));
  const modelRead = database.statements.find((statement) => statement.sql.includes("FROM codex_rollup_model_hourly"));
  assert.ok(hourlyRead && modelRead);
  assert.deepEqual(hourlyRead.values.slice(0, 8), Array(8).fill(completeHourCutoff));
  assert.equal(hourlyRead.values[8], cutoff);
  assert.deepEqual(modelRead.values, [completeHourCutoff]);
  assert.equal(snapshot.pricing?.observedTokenCount, 120);
  assert.equal(snapshot.pricing?.modelAttributedTokenCount, 120);
  assert.equal(snapshot.pricing?.pricedTokenCount, 120);
  assert.equal(snapshot.pricing?.coveragePercent, 100);
});

test("pricing snapshot returns 100% coverage without including Codex auto-review in model math", async () => {
  const database = new SnapshotD1();
  database.hourlyRows = [{
    label: "2026-09-13T12:00:00.000Z", event_count: 2, input_tokens: 1_011_738, input_samples: 2, output_tokens: 0, output_samples: 2,
    cached_tokens: 0, cached_samples: 2, cache_write_tokens: 0, cache_write_samples: 2, reasoning_tokens: 0, reasoning_samples: 0,
    tool_tokens: 0, tool_token_samples: 0, error_count: 0, warning_count: 0, completed_tools: 0, failed_tools: 0, approvals: 0,
    ttft_sum_ms: 0, ttft_sample_count: 0, duration_sum_ms: 0, duration_sample_count: 0, last_received_at: "2026-09-13T12:43:00.000Z",
    pricing_input_tokens: 1_011_738, pricing_input_samples: 2, pricing_cached_tokens: 0, pricing_cached_samples: 2,
    pricing_cache_write_tokens: 0, pricing_cache_write_samples: 2, pricing_output_tokens: 0, pricing_output_samples: 2,
  }];
  database.modelRows = [
    {
      label: "codex-auto-review", count: 1, input_tokens: 11_738, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, tool_tokens: 0,
      pricing_input_tokens: 0, pricing_cached_tokens: 0, pricing_cache_write_tokens: 0, pricing_output_tokens: 0,
      pricing_sample_count: 0, pricing_category_overlap_tokens: 0, model_count: 2, model_token_count: 1_011_738,
    },
    {
      label: "gpt-6-astra", count: 100, input_tokens: 1_000_000, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, tool_tokens: 0,
      pricing_input_tokens: 1_000_000, pricing_cached_tokens: 0, pricing_cache_write_tokens: 0, pricing_output_tokens: 0,
      pricing_sample_count: 1, pricing_category_overlap_tokens: 0, model_count: 2, model_token_count: 1_011_738,
    },
  ];

  const snapshot = await buildMaterializedSnapshot(database, "24h", new Date("2026-09-13T12:43:00.000Z"));
  const modelRead = database.statements.find((statement) => statement.sql.includes("FROM codex_rollup_model_hourly"));
  assert.ok(modelRead);
  assert.match(modelRead.sql, /ORDER BY CASE WHEN label='codex-auto-review' THEN 0 ELSE 1 END,count DESC LIMIT 65/);
  assert.deepEqual(snapshot.models, [{ label: "gpt-6-astra", count: 100 }, { label: "codex-auto-review", count: 1 }]);
  assert.equal(snapshot.pricing?.observedTokenCount, 1_000_000);
  assert.equal(snapshot.pricing?.pricedTokenCount, 1_000_000);
  assert.equal(snapshot.pricing?.unpricedModelTokenCount, 0);
  assert.equal(snapshot.pricing?.modelCount, 1);
  assert.deepEqual(snapshot.pricing?.byModel.map((model) => model.model), ["gpt-6-astra"]);
  assert.equal(snapshot.pricing?.coveragePercent, 100);
});

test("legacy materialized pricing snapshots exclude Codex auto-review on read without a D1 write", async () => {
  const database = new SnapshotD1();
  database.existingSnapshots = [{
    range: "24h",
    generated_at: "2026-09-13T12:00:00.000Z",
    payload_json: JSON.stringify({
      schemaVersion: 1,
      range: "24h",
      generatedAt: "2026-09-13T12:00:00.000Z",
      summary: {}, trend: [], models: [], reasoningEfforts: [], sessions: [],
      pricing: {
        status: "partial", basis: "codex-token-credit-rates", rateCardId: "old-rate-card", featureChargesIncluded: false,
        apiCredits: "2383", usdEquivalent: "99.934752", observedTokenCount: 1_011_738,
        modelAttributedTokenCount: 1_011_738, pricedTokenCount: 1_000_000, unpricedTokenCount: 11_738,
        unpricedModelTokenCount: 11_738, unattributedTokenCount: 0, tokenFieldsUnavailableTokenCount: 0,
        truncatedModelTokenCount: 0, categoryOverlapTokenCount: 0, accountingMismatchTokenCount: 0,
        coveragePercent: 99.99, modelCount: 2, pricedModelCount: 1, unpricedModelCount: 1,
        incompleteModelCount: 0, modelsTruncated: false,
        byModel: [
          { model: "gpt-6-astra", displayName: "GPT-6 Astra", status: "priced", eventCount: 10, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, pricedTokenCount: 1_000_000, apiCredits: "250", usdEquivalent: "10" },
          { model: "codex-auto-review", displayName: "codex-auto-review", status: "unpriced", eventCount: 12, inputTokens: 11_738, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, pricedTokenCount: 0, reason: "No published rate is available for this model." },
        ],
        note: "legacy note",
      },
    }),
  }];

  const snapshot = await readMaterializedSnapshot(database, "24h");
  assert.equal(snapshot?.pricing?.status, "available");
  assert.equal(snapshot?.pricing?.coveragePercent, 100);
  assert.equal(snapshot?.pricing?.observedTokenCount, 1_000_000);
  assert.equal(snapshot?.pricing?.modelAttributedTokenCount, 1_000_000);
  assert.equal(snapshot?.pricing?.unpricedTokenCount, 0);
  assert.equal(snapshot?.pricing?.unpricedModelTokenCount, 0);
  assert.equal(snapshot?.pricing?.modelCount, 1);
  assert.equal(snapshot?.pricing?.unpricedModelCount, 0);
  assert.deepEqual(snapshot?.pricing?.byModel.map((model) => model.model), ["gpt-6-astra"]);
  assert.match(snapshot?.pricing?.note ?? "", /Codex auto-review activity is excluded/);
  assert.equal(database.statements.length, 1);
  assert.ok(database.statements[0].sql.startsWith("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot"));

  const inconsistentPayload = JSON.parse(String(database.existingSnapshots[0].payload_json)) as { pricing: { unpricedTokenCount: number } };
  inconsistentPayload.pricing.unpricedTokenCount = 1;
  database.existingSnapshots[0].payload_json = JSON.stringify(inconsistentPayload);
  const inconsistentSnapshot = await readMaterializedSnapshot(database, "24h");
  assert.equal(inconsistentSnapshot?.pricing?.status, "partial");
  assert.deepEqual(inconsistentSnapshot?.pricing?.byModel.map((model) => model.model), ["gpt-6-astra", "codex-auto-review"]);
});

test("legacy model rollups with no exact pricing samples remain incomplete, not zero-cost or fully covered", async () => {
  const database = new SnapshotD1();
  database.hourlyRows = [{
    label: "2026-09-13T11:00:00.000Z", event_count: 1, input_tokens: 100, input_samples: 1, output_tokens: 20, output_samples: 1,
    cached_tokens: 0, cached_samples: 0, cache_write_tokens: 0, cache_write_samples: 0, reasoning_tokens: 0, reasoning_samples: 0,
    tool_tokens: 0, tool_token_samples: 0, error_count: 0, warning_count: 0, completed_tools: 0, failed_tools: 0, approvals: 0,
    ttft_sum_ms: 0, ttft_sample_count: 0, duration_sum_ms: 0, duration_sample_count: 0, last_received_at: "2026-09-13T11:30:00.000Z",
    pricing_input_tokens: 100, pricing_input_samples: 1, pricing_cached_tokens: 0, pricing_cached_samples: 0,
    pricing_cache_write_tokens: 0, pricing_cache_write_samples: 0, pricing_output_tokens: 20, pricing_output_samples: 1,
  }];
  database.modelRows = [{
    label: "gpt-6-sol", count: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, reasoning_tokens: 0, tool_tokens: 0,
    pricing_input_tokens: 0, pricing_cached_tokens: 0, pricing_cache_write_tokens: 0, pricing_output_tokens: 0,
    pricing_sample_count: 0, pricing_category_overlap_tokens: 0, model_count: 1, model_token_count: 120,
  }];

  const snapshot = await buildMaterializedSnapshot(database, "24h", now);
  assert.equal(snapshot.pricing?.observedTokenCount, 120);
  assert.equal(snapshot.pricing?.pricedTokenCount, 0);
  assert.equal(snapshot.pricing?.coveragePercent, 0);
  assert.equal(snapshot.pricing?.tokenFieldsUnavailableTokenCount, 120);
  assert.equal(snapshot.pricing?.byModel[0]?.status, "incomplete");
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

test("migration 0004 adds only forward-looking model pricing-attribution counters", async () => {
  const migration = await readFile(new URL("../migrations/0004_pricing_attribution.sql", import.meta.url), "utf8");
  for (const column of ["pricing_input_tokens", "pricing_cached_tokens", "pricing_cache_write_tokens", "pricing_output_tokens", "pricing_sample_count", "pricing_category_overlap_tokens"]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`));
  }
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|UPDATE\s|INSERT\s|codex_telemetry_events|prompt|command|arguments|stdout|stderr|credential|secret/i);
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
