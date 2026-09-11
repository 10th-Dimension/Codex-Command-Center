import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCodexTelemetryProvider } from "../src/lib/providers/codex-core";
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../src/lib/telemetry/database";
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
  deleted = 0;
  lastDeleteCutoff?: string;
  queryResults?: D1ResultLike[];
  prepare(sql: string) { return new FakeStatement(this, sql); }
  async batch<T>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
    if (this.queryResults && statements.every((statement) => !((statement as FakeStatement).sql.includes("INSERT")))) return this.queryResults as D1ResultLike<T>[];
    return statements.map((statement) => this.execute(statement as FakeStatement) as D1ResultLike<T>);
  }
  execute(statement: FakeStatement): D1ResultLike {
    if (statement.sql.includes("INSERT OR IGNORE")) {
      const fingerprint = String(statement.values[1]);
      if (this.fingerprints.has(fingerprint)) return { success: true, meta: { changes: 0 } };
      this.fingerprints.add(fingerprint);
      this.insertedValues.push(statement.values);
      return { success: true, meta: { changes: 1 } };
    }
    if (statement.sql.startsWith("DELETE")) { this.deleted += 1; this.lastDeleteCutoff = String(statement.values[0]); return { success: true, meta: { changes: 0 } }; }
    return { success: true, results: [] };
  }
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
  assert.deepEqual(events[0].unknownAttributeKeys, ["custom.safe-key", "service.name"]);
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
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.source, "openai-codex-otel");
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
  const options = { database, ingestKey, retentionDays: 30, now: () => new Date(now) };
  const first = await handleTelemetryIngest(requestFor(jsonPayload()), options);
  const second = await handleTelemetryIngest(requestFor(jsonPayload()), options);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-codex-telemetry-accepted"), "1");
  assert.equal(second.headers.get("x-codex-telemetry-accepted"), "0");
  assert.equal(second.headers.get("x-codex-telemetry-duplicates"), "1");
  assert.equal(database.insertedValues.length, 1);
  assert.equal(database.deleted, 2);
  assert.equal(database.lastDeleteCutoff, "2026-08-12T12:00:00.000Z");
  const stored = JSON.stringify(database.insertedValues);
  assert.doesNotMatch(stored, /must-never-appear|authorization|private prompt|private output/);
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

test("Codex provider returns typed D1-backed activity, usage, and health", async () => {
  const database = new FakeD1();
  const eventRow = {
    id: "event-1", event_name: "codex.api_request", event_category: "api-request", occurred_at: now, received_at: now,
    environment: "test", severity_text: null, session_id: "session-1", thread_id: null, task_id: null, project_id: "project-1", project_name: "Command Center",
    repository_id: null, workspace_id: null, model: "gpt-test", tool_name: null, tool_type: null, tool_status: null, decision: null,
    approval_decision: null, mcp_server: null, mcp_tool: null, network_host: null, network_decision: null, success: 1, error_type: null,
    status: "ok", duration_ms: 25, input_tokens: 12, output_tokens: 4,
    cached_input_tokens: 2, reasoning_output_tokens: 1, safe_attribute_keys_json: "[\"model\"]", unknown_attribute_keys_json: "[]",
    source: "openai-codex-otel", schema_version: 1,
  };
  database.queryResults = [
    { success: true, results: [eventRow] },
    { success: true, results: [{ day: "2026-09-11", events: 1, errors: 0, tool_executions: 0 }] },
    { success: true, results: [{ day: "2026-09-11T12:00:00.000Z", events: 1, errors: 0, tool_executions: 0 }] },
    { success: true, results: [{ label: "api-request", count: 1 }] },
    { success: true, results: [{ label: "gpt-test", count: 1 }] },
    { success: true, results: [] },
    { success: true, results: [{ label: "api-request", sample_count: 1, average_ms: 25, maximum_ms: 25 }] },
    { success: true, results: [] },
    { success: true, results: [] },
    { success: true, results: [] },
    { success: true, results: [] },
    { success: true, results: [] },
    { success: true, results: [{ session_id: "session-1", project_name: "Command Center", model: "gpt-test", event_count: 1, error_count: 0, tool_executions: 0, first_seen_at: now, last_seen_at: now }] },
    { success: true, results: [{ project_id: "project-1", project_name: "Command Center", event_count: 1, session_count: 1, last_seen_at: now }] },
    { success: true, results: [] },
    { success: true, results: [{ window: "7d", input_tokens: 12, output_tokens: 4, cached_input_tokens: 2, reasoning_output_tokens: 1, events_with_usage: 1 }, { window: "30d", input_tokens: 12, output_tokens: 4, cached_input_tokens: 2, reasoning_output_tokens: 1, events_with_usage: 1 }] },
    { success: true, results: [{ event_count: 1, last_received_at: now, oldest_event_at: now, newest_event_at: now, today_event_count: 1, observed_session_count_24h: 1, failed_tool_count_30d: 0 }] },
  ];
  const provider = createCodexTelemetryProvider({ getRuntime: () => ({ database, ingestKey, retentionDays: 30 }), now: () => new Date(now), cacheTtlMs: 0 });
  const snapshot = await provider.getSnapshot({ requestedAt: now });
  assert.equal(snapshot.health.status, "connected");
  assert.equal(snapshot.activity.status === "connected" ? snapshot.activity.data[0].eventName : null, "codex.api_request");
  assert.equal(snapshot.usage.status === "connected" ? snapshot.usage.data[0].inputTokens : null, 12);
  assert.equal(snapshot.sessions.status === "connected" ? snapshot.sessions.data[0].sessionId : null, "session-1");
  assert.equal(snapshot.timings.status === "connected" ? snapshot.timings.data[0].averageMs : null, 25);
  assert.equal(snapshot.trends.twentyFourHour.status === "connected" ? snapshot.trends.twentyFourHour.data[0].events : null, 1);
  assert.equal(snapshot.todayEventCount, 1);
  assert.equal(snapshot.lastReceivedAt, now);
});

test("Codex provider reports a connected empty D1 without inventing metrics", async () => {
  const database = new FakeD1();
  const provider = createCodexTelemetryProvider({ getRuntime: () => ({ database, ingestKey, retentionDays: 30 }), now: () => new Date(now), cacheTtlMs: 0 });
  const snapshot = await provider.getSnapshot({ requestedAt: now });
  assert.equal(snapshot.health.status, "connected");
  assert.deepEqual(snapshot.activity.status === "connected" ? snapshot.activity.data : null, []);
  assert.equal(snapshot.eventCount, 0);
  assert.equal(snapshot.lastReceivedAt, undefined);
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
