import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCodexTelemetryProvider } from "../src/lib/providers/codex-core";
import {
  TELEMETRY_RETENTION_DELETE_BATCH_SIZE,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
  readTelemetryForensics,
} from "../src/lib/telemetry/database";
import { handleTelemetryIngest, MAX_TELEMETRY_PAYLOAD_BYTES } from "../src/lib/telemetry/ingest";
import { normalizeOtlpRecords } from "../src/lib/telemetry/normalize";
import { decodeOtlpJson, decodeOtlpProtobuf } from "../src/lib/telemetry/otlp";

const now = "2026-09-11T12:00:00.000Z";
const ingestKey = "unit-test-ingest-key";

function anyValue(value: unknown) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { intValue: String(value) };
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: String(value) };
}

function jsonPayload(eventName = "codex.api_request") {
  return {
    resourceLogs: [{
      resource: { attributes: [{ key: "service.name", value: anyValue("codex_cli_rs") }] },
      scopeLogs: [{
        scope: { name: "codex" },
        logRecords: [{
          timeUnixNano: "1789128000000000000",
          body: anyValue(eventName),
          attributes: [
            { key: "conversation.id", value: anyValue("session-1") },
            { key: "model", value: anyValue("gpt-test") },
            { key: "input_token_count", value: anyValue(12) },
            { key: "output_token_count", value: anyValue(4) },
            { key: "custom.safe-key", value: anyValue("unknown-value-must-not-be-stored") },
            { key: "authorization", value: anyValue("Bearer must-never-appear") },
            { key: "prompt", value: anyValue("private prompt must-never-appear") },
            { key: "tool.output", value: anyValue("private output must-never-appear") },
          ],
        }],
      }],
    }],
  };
}

class FakeStatement implements D1PreparedStatementLike {
  values: unknown[] = [];
  constructor(readonly database: FakeD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1ResultLike<T>> { return this.database.execute(this) as D1ResultLike<T>; }
  async all<T>(): Promise<D1ResultLike<T>> { return this.database.execute(this) as D1ResultLike<T>; }
}

class FakeD1 implements D1DatabaseLike {
  fingerprints = new Set<string>();
  insertedValues: unknown[][] = [];
  statements: FakeStatement[] = [];
  deleted = 0;
  lastDeleteCutoff?: string;
  queryResults?: D1ResultLike[];
  snapshotRows: Record<string, unknown>[] = [];
  rollupInsertCount = 0;
  rawDeleteCount = 0;
  missingRollupSchema = false;
  prepare(sql: string) {
    const statement = new FakeStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }
  async batch<T>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
    if (this.queryResults && statements.every((statement) => !((statement as FakeStatement).sql.includes("INSERT")))) return this.queryResults as D1ResultLike<T>[];
    return statements.map((statement) => this.execute(statement as FakeStatement) as D1ResultLike<T>);
  }
  execute(statement: FakeStatement): D1ResultLike {
    const sql = statement.sql.trim();
    if (this.missingRollupSchema && /codex_(?:rollup|dashboard_snapshot|session_summary)/.test(statement.sql)) throw new Error("no such table: codex_rollup_hourly");
    if (statement.sql.includes("INSERT OR IGNORE")) {
      const fingerprint = String(statement.values[1]);
      if (this.fingerprints.has(fingerprint)) return { success: true, meta: { changes: 0 } };
      this.fingerprints.add(fingerprint);
      this.insertedValues.push(statement.values);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO codex_rollup_")) this.rollupInsertCount += 1;
    if (statement.sql.includes("FROM codex_dashboard_snapshot")) return { success: true, results: this.snapshotRows };
    if (sql.startsWith("DELETE")) { this.deleted += 1; if (statement.sql.includes("codex_telemetry_events")) this.rawDeleteCount += 1; this.lastDeleteCutoff = String(statement.values[0]); return { success: true, meta: { changes: 0 } }; }
    return { success: true, results: [] };
  }
}

class MetadataD1 extends FakeD1 {
  execute(statement: FakeStatement): D1ResultLike {
    const result = super.execute(statement);
    return { ...result, meta: { ...result.meta, rows_written: result.meta?.rows_written ?? 1 } };
  }
}

class ForensicsGuardStatement implements D1PreparedStatementLike {
  values: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1ResultLike<T>> { return { success: true }; }
  async all<T>(): Promise<D1ResultLike<T>> {
    return { success: true, results: Array.from({ length: 50_001 }, (_, index) => ({ id: `event-${index}` })) as T[] };
  }
}

class ForensicsGuardD1 implements D1DatabaseLike {
  prepare(sql: string) { return new ForensicsGuardStatement(sql); }
  async batch<T>(): Promise<D1ResultLike<T>[]> { throw new Error("The guard should stop before the forensic fan-out."); }
}

function requestFor(payload: unknown, key = ingestKey) {
  return new Request("https://example.test/api/telemetry/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-telemetry-key": key },
    body: JSON.stringify(payload),
  });
}

test("OTLP JSON parsing and privacy normalization retain operational fields only", async () => {
  const records = decodeOtlpJson(jsonPayload());
  const events = await normalizeOtlpRecords(records, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, "codex.api_request");
  assert.equal(events[0].sessionId, "session-1");
  assert.equal(events[0].model, "gpt-test");
  assert.equal(events[0].inputTokens, 12);
  assert.deepEqual(events[0].unknownAttributeKeys, ["custom.safe-key"]);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /Bearer must-never-appear|private prompt|private output|unknown-value-must-not-be-stored/);
  assert.doesNotMatch(serialized, /authorization|tool\.output|"prompt"/);
  assert.equal(events[0].redactedAttributeCount, 3);
});

test("secret-shaped bodies and identifiers are not retained as event metadata", async () => {
  const events = await normalizeOtlpRecords([{
    attributes: { "conversation.id": "github_pat_not-a-real-token" },
    body: "github_pat_not-a-real-token",
    resourceAttributes: {},
  }], now);
  assert.equal(events[0].eventName, "unknown");
  assert.equal(events[0].sessionId, undefined);
  assert.doesNotMatch(JSON.stringify(events), /github_pat_not-a-real-token/);
});

test("MCP, network, approval, tool, and workspace dimensions map only when emitted", async () => {
  const [event] = await normalizeOtlpRecords([{
    attributes: {
      "approval.decision": "approved",
      "deployment.environment.name": "production",
      "mcp.server": "example-server",
      "mcp.tool": "example-tool",
      "network.host": "api.example.test",
      "network.decision": "allow",
      "repository.id": "10th-Dimension/Codex-Command-Center",
      "thread.id": "thread-1",
      "tool.status": "success",
      "tool.type": "mcp",
      "workspace.id": "workspace-1",
    },
    body: "codex.mcp_tool_call",
    resourceAttributes: {},
  }], now);
  assert.equal(event.category, "mcp");
  assert.equal(event.mcpServer, "example-server");
  assert.equal(event.mcpTool, "example-tool");
  assert.equal(event.networkHost, "api.example.test");
  assert.equal(event.networkDecision, "allow");
  assert.equal(event.approvalDecision, "approved");
  assert.equal(event.success, true);
  assert.equal(event.environment, "production");
  assert.equal(event.schemaVersion, 2);
  assert.equal(event.source, "openai-codex-otel");
});

test("observed Codex v2 attributes normalize into privacy-safe analytics fields", async () => {
  const [event] = await normalizeOtlpRecords([{
    attributes: {
      "event.kind": "codex.tool_result",
      "conversation.id": "session-v2",
      model: "gpt-5.6-sol",
      model_reasoning_effort: "xhigh",
      tool_names: ["exec_command"],
      tool_namespace: "functions",
      call_id: "call-private-correlation-id",
      status: "completed",
      duration_ms: 125.5,
      ttft_ms: 42,
      cached_token_count: 11,
      cache_write_token_count: 3,
      reasoning_token_count: 7,
      tool_token_count: 5,
      approval_policy: "on-request",
      sandbox_policy: "workspace-write",
      agent_name: "codex",
      provider_name: "openai",
      originator: "desktop",
      mcp_server_origin: "plugin",
      "app.version": "1.2.3",
      "service.name": "codex_cli_rs",
      "service.version": "1.2.3",
      "startup.phase": "ready",
      "startup.status": "ok",
      "terminal.type": "powershell",
    },
    resourceAttributes: {},
  }], now);
  assert.equal(event.eventName, "codex.tool_result");
  assert.equal(event.eventKind, "codex.tool_result");
  assert.equal(event.category, "tool");
  assert.equal(event.model, "gpt-5.6-sol");
  assert.equal(event.reasoningEffort, "xhigh");
  assert.equal(event.toolName, "exec_command");
  assert.equal(event.toolNamespace, "functions");
  assert.equal(event.toolExecutionState, "succeeded");
  assert.equal(event.cachedInputTokens, 11);
  assert.equal(event.cacheWriteTokens, 3);
  assert.equal(event.reasoningTokens, 7);
  assert.equal(event.toolTokens, 5);
  assert.equal(event.ttftMs, 42);
  assert.match(event.callIdHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(event), /call-private-correlation-id/);
  assert.equal(event.schemaVersion, 2);
});

test("event identity uses event.kind, preserves genuine unknowns, and recognizes evidence-backed categories", async () => {
  const events = await normalizeOtlpRecords([
    { attributes: { "event.kind": "codex.startup", "startup.phase": "boot" }, resourceAttributes: {} },
    { attributes: { "event.kind": "codex.token_usage", input_token_count: 1 }, resourceAttributes: {} },
    { attributes: { "event.kind": "codex.approval", approval_decision: "approved" }, resourceAttributes: {} },
    { attributes: { "event.kind": "codex.model_response", model: "future-model" }, resourceAttributes: {} },
    { attributes: { "event.kind": "new.safe.event", "conversation.id": "session-does-not-prove-category" }, resourceAttributes: {} },
  ], now);
  assert.deepEqual(events.map((event) => event.category), ["startup", "usage", "approval", "model", "unknown"]);
  assert.equal(events[4].eventName, "new.safe.event");
});

test("replay preserves the explicit decision category", async () => {
  const [event] = await normalizeOtlpRecords([{
    attributes: { "codex.replay.category": "decision", "event.kind": "codex.policy_event" },
    resourceAttributes: {},
  }], now, { replay: true });
  assert.equal(event.category, "decision");
});

test("blank OTLP event-name fields do not mask a safe event.name attribute", async () => {
  const [event] = await normalizeOtlpRecords([{ eventName: "", attributes: { "event.name": "codex.tool_result", tool_name: "exec", success: true }, resourceAttributes: {} }], now);
  assert.equal(event.eventName, "codex.tool_result");
  assert.equal(event.category, "tool");
});

test("token aliases preserve emitted zero and keep absent or invalid values unavailable", async () => {
  const [zero, absent, invalid] = await normalizeOtlpRecords([
    { attributes: { cached_token_count: 0, cache_write_token_count: "0", reasoning_token_count: 0, tool_token_count: 0, ttft_ms: 0 }, resourceAttributes: {} },
    { attributes: {}, resourceAttributes: {} },
    { attributes: { cached_token_count: -1, cache_write_token_count: "not-a-number", reasoning_token_count: -2, tool_token_count: -3, ttft_ms: -4 }, resourceAttributes: {} },
  ], now);
  assert.equal(zero.cachedInputTokens, 0);
  assert.equal(zero.cacheWriteTokens, 0);
  assert.equal(zero.reasoningTokens, 0);
  assert.equal(zero.toolTokens, 0);
  assert.equal(zero.ttftMs, 0);
  for (const event of [absent, invalid]) {
    assert.equal(event.cachedInputTokens, undefined);
    assert.equal(event.cacheWriteTokens, undefined);
    assert.equal(event.reasoningTokens, undefined);
    assert.equal(event.toolTokens, undefined);
    assert.equal(event.ttftMs, undefined);
  }
});

test("reasoning effort prefers reasoning_effort, accepts future identifiers, and rejects content-like values", async () => {
  const events = await normalizeOtlpRecords([
    { attributes: { reasoning_effort: "high", model_reasoning_effort: "low" }, resourceAttributes: {} },
    { attributes: { model_reasoning_effort: "future-tier" }, resourceAttributes: {} },
    { attributes: { reasoning_effort: "private prose value" }, resourceAttributes: {} },
  ], now);
  assert.equal(events[0].reasoningEffort, "high");
  assert.equal(events[1].reasoningEffort, "future-tier");
  assert.equal(events[2].reasoningEffort, undefined);
});

test("tool lifecycle hashes correlate calls without retaining raw ids or double-count hints", async () => {
  const events = await normalizeOtlpRecords([
    { attributes: { "event.kind": "codex.tool_call", tool_name: "exec", call_id: "same-call" }, resourceAttributes: {} },
    { attributes: { "event.kind": "codex.tool_result", tool_name: "exec", call_id: "same-call", success: true }, resourceAttributes: {} },
    { attributes: { "event.kind": "codex.tool_result", tool_name: "exec", call_id: "failed-call", success: false }, resourceAttributes: {} },
  ], now);
  assert.equal(events[0].toolExecutionState, "started");
  assert.equal(events[1].toolExecutionState, "succeeded");
  assert.equal(events[2].toolExecutionState, "failed");
  assert.equal(events[0].callIdHash, events[1].callIdHash);
  assert.notEqual(events[1].callIdHash, events[2].callIdHash);
  assert.doesNotMatch(JSON.stringify(events), /same-call|failed-call/);
});

test("privacy denylist discards identity, reasoning content, auth, command, and output values", async () => {
  const sensitive = {
    "user.email": "private@example.test", "user.account_id": "account-private", reasoning_summary: "private reasoning",
    authorization: "Bearer private", cookie: "session=private", password: "private-password", secret: "private-secret",
    command: "private command", "tool.arguments": "private arguments", "tool.output": "private output", stdout: "private stdout", stderr: "private stderr",
    response_body: "private response", originator: "private@example.test", "host.name": "private-machine", endpoint: "https://private.internal/path",
    "auth.mode": "private-auth-mode", "auth.header_name": "authorization", "auth.connection_reused": true, auth_mode: "private-mode",
  };
  const [event] = await normalizeOtlpRecords([{ attributes: sensitive, resourceAttributes: {} }], now);
  const serialized = JSON.stringify(event);
  for (const value of Object.values(sensitive)) assert.doesNotMatch(serialized, new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.equal(event.originator, undefined);
  assert.ok(event.redactedAttributeCount >= 12);
  assert.ok(!event.unknownAttributeKeys.includes("host.name"));
  assert.ok(!event.safeAttributeKeys.some((key) => key.startsWith("auth")));
});

test("ingestion rejects missing and incorrect keys without touching D1", async () => {
  const database = new FakeD1();
  const missing = await handleTelemetryIngest(requestFor(jsonPayload(), ""), { database, ingestKey, retentionDays: 30 });
  const incorrect = await handleTelemetryIngest(requestFor(jsonPayload(), "wrong"), { database, ingestKey, retentionDays: 30 });
  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
  assert.equal(database.insertedValues.length, 0);
});

test("ingestion validates media type, malformed payloads, and payload bounds", async () => {
  const database = new FakeD1();
  const unsupported = new Request("https://example.test/api/telemetry/ingest", { method: "POST", headers: { "content-type": "text/plain", "x-codex-telemetry-key": ingestKey }, body: "x" });
  const malformed = new Request("https://example.test/api/telemetry/ingest", { method: "POST", headers: { "content-type": "application/json", "x-codex-telemetry-key": ingestKey }, body: "{" });
  const oversized = new Request("https://example.test/api/telemetry/ingest", { method: "POST", headers: { "content-type": "application/json", "content-length": String(MAX_TELEMETRY_PAYLOAD_BYTES + 1), "x-codex-telemetry-key": ingestKey }, body: "{}" });
  assert.equal((await handleTelemetryIngest(unsupported, { database, ingestKey, retentionDays: 30 })).status, 415);
  assert.equal((await handleTelemetryIngest(malformed, { database, ingestKey, retentionDays: 30 })).status, 400);
  assert.equal((await handleTelemetryIngest(oversized, { database, ingestKey, retentionDays: 30 })).status, 413);
});

test("ingestion batches writes, deduplicates retries, and runs retention cleanup", async () => {
  const database = new FakeD1();
  const options = { database, ingestKey, retentionDays: 30, now: () => new Date(now), maintenanceIntervalMs: 0 };
  const first = await handleTelemetryIngest(requestFor(jsonPayload()), options);
  const rollupsAfterFirst = database.rollupInsertCount;
  const second = await handleTelemetryIngest(requestFor(jsonPayload()), options);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-codex-telemetry-accepted"), "1");
  assert.equal(second.headers.get("x-codex-telemetry-accepted"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-duplicates"), "1");
  assert.equal(database.insertedValues.length, 1);
  assert.equal(database.rawDeleteCount, 1, "retention cleanup is time-gated across duplicate requests");
  const rawDelete = database.statements.find((statement) => statement.sql.includes("DELETE FROM codex_telemetry_events"));
  assert.ok(rawDelete);
  assert.match(rawDelete.sql, /INDEXED BY sqlite_autoindex_codex_telemetry_events_1/);
  assert.match(rawDelete.sql, /WHERE id IN\s*\(\s*SELECT id/);
  assert.match(rawDelete.sql, /LIMIT \?/);
  assert.equal(rawDelete.values[1], TELEMETRY_RETENTION_DELETE_BATCH_SIZE);
  assert.ok(database.rollupInsertCount > 0);
  assert.equal(database.rollupInsertCount, rollupsAfterFirst, "duplicate delivery must not increment rollups");
  assert.equal(database.lastDeleteCutoff, "2026-08-12T12:00:00.000Z");
  assert.equal(first.headers.get("x-codex-telemetry-ingest-requests"), "1");
  assert.equal(first.headers.get("x-codex-telemetry-snapshot-rebuilds"), "3");
  assert.equal(second.headers.get("x-codex-telemetry-snapshot-rebuilds"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-rollups"), "skipped-no-new-events");
  assert.equal(second.headers.get("x-codex-telemetry-cleanup-deletes"), "0");
  const stored = JSON.stringify(database.insertedValues);
  assert.doesNotMatch(stored, /must-never-appear|authorization|private prompt|private output/);
});

test("duplicate-only retries skip maintenance even when the maintenance interval is eligible", async () => {
  const database = new MetadataD1();
  const options = { database, ingestKey, retentionDays: 30, now: () => new Date(now), maintenanceIntervalMs: 0 };
  const first = await handleTelemetryIngest(requestFor(jsonPayload()), options);
  const second = await handleTelemetryIngest(requestFor(jsonPayload()), options);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(database.rawDeleteCount, 1);
  assert.equal(second.headers.get("x-codex-telemetry-rollups"), "skipped-no-new-events");
  assert.equal(second.headers.get("x-codex-telemetry-rollup-upserts"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-snapshot-rebuilds"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-cleanup-deletes"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-d1-rows-written"), "1", "only the duplicate-aware insert statement was observed");
});

test("malformed OTLP protobuf is rejected without a D1 write", async () => {
  const database = new FakeD1();
  const request = new Request("https://example.test/api/telemetry/ingest", { method: "POST", headers: { "content-type": "application/x-protobuf", "x-codex-telemetry-key": ingestKey }, body: new Uint8Array([0x0a, 0x7f, 0x01]) });
  const response = await handleTelemetryIngest(request, { database, ingestKey, retentionDays: 30 });
  assert.equal(response.status, 400);
  assert.equal(database.insertedValues.length, 0);
});

function varint(value: bigint | number) {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & BigInt(0x7f));
    remaining >>= BigInt(7);
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return bytes;
}
function bytesField(number: number, value: number[]) { return [...varint(number << 3 | 2), ...varint(value.length), ...value]; }
function stringField(number: number, value: string) { return bytesField(number, [...new TextEncoder().encode(value)]); }
function fixed64Field(number: number, value: bigint) { return [number << 3 | 1, ...Array.from({ length: 8 }, (_, index) => Number(value >> BigInt(index * 8) & BigInt(0xff)))]; }
function anyString(value: string) { return stringField(1, value); }
function anyInt(value: number) { return [...varint(3 << 3), ...varint(value)]; }
function keyValue(key: string, value: number[]) { return [...stringField(1, key), ...bytesField(2, value)]; }

test("binary OTLP protobuf payloads decode without Node-only protobuf dependencies", () => {
  const logRecord = [
    ...fixed64Field(1, BigInt("1789128000000000000")),
    ...bytesField(5, anyString("codex.sse_event")),
    ...bytesField(6, keyValue("model", anyString("gpt-binary"))),
    ...bytesField(6, keyValue("output_token_count", anyInt(9))),
  ];
  const scopeLogs = bytesField(2, logRecord);
  const resourceLogs = bytesField(2, scopeLogs);
  const payload = new Uint8Array(bytesField(1, resourceLogs));
  const records = decodeOtlpProtobuf(payload);
  assert.equal(records.length, 1);
  assert.equal(records[0].body, "codex.sse_event");
  assert.equal(records[0].attributes.model, "gpt-binary");
  assert.equal(records[0].attributes.output_token_count, 9);
});

test("Codex provider returns only typed materialized summaries for normal reads", async () => {
  const database = new FakeD1();
  const payload = { schemaVersion: 1, range: "24h", generatedAt: now, sourceUpdatedAt: now,
    summary: { events: 1, sessions: 1, inputTokens: { availability: "available", value: 12, sampleCount: 1 }, outputTokens: { availability: "available", value: 4, sampleCount: 1 }, cachedTokens: { availability: "available", value: 2, sampleCount: 1 }, cacheWriteTokens: { availability: "no-samples", sampleCount: 0 }, reasoningTokens: { availability: "available", value: 1, sampleCount: 1 }, toolTokens: { availability: "no-samples", sampleCount: 0 }, errors: 0, warnings: 0, completedTools: 0, failedTools: 0, approvals: 0 },
    trend: [{ label: now, events: 1, errors: 0, toolExecutions: 0, inputTokens: 12, outputTokens: 4 }], models: [{ label: "gpt-test", count: 1 }], reasoningEfforts: [],
    sessions: [{ sessionId: "session-1", projectName: "Command Center", models: ["gpt-test"], reasoningEfforts: [], eventCount: 1, errorCount: 0, warningCount: 0, toolExecutions: 0, failedTools: 0, toolRelatedEvents: 0, usageEvents: 1, approvalEvents: 0, inputTokens: 12, outputTokens: 4, cachedTokens: 2, firstSeenAt: now, lastSeenAt: now }] };
  database.snapshotRows = [{ range: "24h", generated_at: now, payload_json: JSON.stringify(payload) }];
  const provider = createCodexTelemetryProvider({ getRuntime: () => ({ database, ingestKey, retentionDays: 30 }), now: () => new Date(now), cacheTtlMs: 0 });
  const snapshot = await provider.getSnapshot({ requestedAt: now });
  assert.equal(snapshot.health.status, "connected");
  assert.equal(snapshot.activity.status, "unavailable");
  assert.equal(snapshot.usage.status === "connected" ? snapshot.usage.data[0].inputTokens.value : null, 12);
  assert.equal(snapshot.usage.status === "connected" ? snapshot.usage.data[0].cacheWriteTokens.availability : null, "no-samples");
  assert.equal(snapshot.sessions.status === "connected" ? snapshot.sessions.data[0].sessionId : null, "session-1");
  assert.equal(snapshot.timings.status, "unavailable");
  assert.equal(snapshot.trends.twentyFourHour.status === "connected" ? snapshot.trends.twentyFourHour.data[0].events : null, 1);
  assert.equal(snapshot.todayEventCount, 1);
  assert.equal(snapshot.lastReceivedAt, now);
});

test("Codex provider reports missing snapshots without an expensive raw fallback", async () => {
  const database = new FakeD1();
  const provider = createCodexTelemetryProvider({ getRuntime: () => ({ database, ingestKey, retentionDays: 30 }), now: () => new Date(now), cacheTtlMs: 0 });
  const snapshot = await provider.getSnapshot({ requestedAt: now });
  assert.equal(snapshot.health.status, "unavailable");
  assert.match(snapshot.health.message, /migration 0003|backfill/i);
  assert.equal(snapshot.activity.status, "unavailable");
  assert.equal(snapshot.lastReceivedAt, undefined);
});

test("forensics refuses a raw window above the bounded read budget", async () => {
  await assert.rejects(
    () => readTelemetryForensics(new ForensicsGuardD1(), new Date(now)),
    /50,000 raw events/,
  );
});

test("ingestion exposes bounded write-amplification diagnostics without creating diagnostic rows", async () => {
  const database = new MetadataD1();
  const response = await handleTelemetryIngest(requestFor(jsonPayload()), { database, ingestKey, retentionDays: 30, now: () => new Date(now) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-codex-telemetry-accepted"), "1");
  assert.equal(response.headers.get("x-codex-telemetry-d1-rows-written"), "12", "controlled metadata fixture measures one raw insert, three grouped rollups, four cleanup statements, three snapshots, and one raw cleanup");
  assert.ok(Number(response.headers.get("x-codex-telemetry-rollup-upserts")) > 0);
  assert.equal(response.headers.get("x-codex-telemetry-ingest-requests"), "1");
  assert.equal(database.insertedValues.length, 1);
});

test("missing migration 0003 does not break ingest or trigger a raw analytics fallback", async () => {
  const database = new FakeD1();
  database.missingRollupSchema = true;
  const response = await handleTelemetryIngest(requestFor(jsonPayload()), { database, ingestKey, retentionDays: 30, now: () => new Date(now) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-codex-telemetry-accepted"), "1");
  assert.equal(response.headers.get("x-codex-telemetry-rollups"), "schema-unavailable");
  assert.equal(database.rawDeleteCount, 1);
});

test("D1 migration preserves deduplication, query indexes, and bounded raw-event schema", async () => {
  const migration = await readFile(new URL("../migrations/0001_codex_telemetry.sql", import.meta.url), "utf8");
  assert.match(migration, /event_fingerprint TEXT NOT NULL UNIQUE/);
  for (const dimension of ["occurred_at", "category_occurred_at", "session_occurred_at", "project_occurred_at", "model_occurred_at", "tool_occurred_at", "mcp_server_occurred_at", "success_occurred_at", "network_decision_occurred_at"]) {
    assert.match(migration, new RegExp(`idx_codex_telemetry_events_${dimension}`));
  }
  assert.doesNotMatch(migration, /prompt|authorization|cookie|credential|secret|tool_output/i);
  assert.match(migration, /PRAGMA optimize/);
  assert.match(migration, /source TEXT NOT NULL DEFAULT 'openai-codex-otel'/);
  assert.match(migration, /schema_version INTEGER NOT NULL DEFAULT 1/);
});

test("analytics v2 migration is additive, indexed, privacy-safe, and historically conservative", async () => {
  const migration = await readFile(new URL("../migrations/0002_codex_analytics_v2.sql", import.meta.url), "utf8");
  for (const column of ["event_kind", "reasoning_effort", "cache_write_tokens", "reasoning_tokens", "tool_tokens", "ttft_ms", "tool_namespace", "call_id_hash", "tool_execution_state", "approval_policy", "sandbox_policy", "agent_name", "provider_name", "originator", "mcp_server_origin", "app_version", "service_name", "service_version", "startup_phase", "startup_status", "terminal_type"]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} `));
  }
  for (const index of ["reasoning_occurred_at", "call_occurred_at", "tool_state_occurred_at", "ttft_occurred_at"]) assert.match(migration, new RegExp(`idx_codex_telemetry_events_${index}`));
  assert.match(migration, /WHERE event_category = 'unknown'/);
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|reasoning_summary|user_email|account_id|authorization|cookie|password|tool_output/i);
});

test("database analytics deduplicate terminal tool events by call hash and bound raw hydration", async () => {
  const source = await readFile(new URL("../src/lib/telemetry/database.ts", import.meta.url), "utf8");
  assert.match(source, /COUNT\(DISTINCT CASE WHEN[^`]+COALESCE\(call_id_hash,id\)/s);
  assert.match(source, /ORDER BY occurred_at DESC LIMIT 100/);
  assert.match(source, /ROW_NUMBER\(\) OVER/);
  assert.match(source, /MAX\(n\) >= 20/);
});
