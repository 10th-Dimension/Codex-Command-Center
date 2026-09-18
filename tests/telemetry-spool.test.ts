import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodeOtlpJson, decodeOtlpProtobuf } from "../src/lib/telemetry/otlp";
import { normalizeOtlpRecords } from "../src/lib/telemetry/normalize";
import {
  TELEMETRY_SPOOL_MAX_ENTRY_BODY_BYTES,
  TelemetrySpool,
  type TelemetrySpoolItem,
} from "../scripts/telemetry-spool";
import { sanitizeTelemetryPayload } from "../scripts/telemetry-spool-payload";

async function withDirectory<T>(callback: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "codex-telemetry-spool-test-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function varint(value: number) {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const next = remaining & 0x7f;
    remaining >>>= 7;
    bytes.push(remaining ? next | 0x80 : next);
  } while (remaining);
  return bytes;
}

function bytesField(number: number, value: number[]) {
  return [...varint(number << 3 | 2), ...varint(value.length), ...value];
}

function stringField(number: number, value: string) {
  return bytesField(number, [...new TextEncoder().encode(value)]);
}

test("spool survives relay restart and replays individual bodies oldest-first", async () => {
  await withDirectory(async (directory) => {
    let clock = Date.parse("2026-09-17T12:00:00.000Z");
    const first = new TelemetrySpool({ directory, now: () => clock, retryMinimumMs: 0, retryMaximumMs: 0 });
    await first.enqueue("application/json", new TextEncoder().encode('{"first":true}'));
    clock += 1_000;
    await first.enqueue("application/x-protobuf", Uint8Array.from([1, 2, 3]));

    const restarted = new TelemetrySpool({ directory, now: () => clock, retryMinimumMs: 0, retryMaximumMs: 0 });
    const before = await restarted.health();
    assert.equal(before.queuedBatches, 2);
    assert.equal(before.oldestQueuedAgeSeconds, 1);

    const delivered: Array<{ contentType: string; body: Uint8Array }> = [];
    const replayed = await restarted.replay(async (item: TelemetrySpoolItem) => {
      delivered.push({ contentType: item.contentType, body: item.body });
      return "delivered";
    }, true);
    assert.equal(replayed, 2);
    assert.deepEqual(delivered.map((item) => item.contentType), ["application/json", "application/x-protobuf"]);
    assert.deepEqual([...delivered[0].body], [...new TextEncoder().encode('{"first":true}')]);
    assert.deepEqual([...delivered[1].body], [1, 2, 3]);
    assert.equal((await restarted.health()).queuedBatches, 0);
    assert.equal((await restarted.health()).replayState, "idle");
  });
});

test("spool enforces both file and byte bounds with visible dropped accounting", async () => {
  await withDirectory(async (directory) => {
    const spool = new TelemetrySpool({ directory, maxFiles: 2, maxBytes: 1_000, retryMinimumMs: 0, retryMaximumMs: 0 });
    for (let index = 0; index < 20; index += 1) await spool.enqueue("application/json", new TextEncoder().encode(`{"batch":${index}}`));
    const health = await spool.health();
    assert.ok(health.queuedBatches <= 2);
    assert.ok(health.queuedBytes <= 1_000);
    assert.ok(health.droppedBatches > 0);
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".json") && name !== ".state.json").length, health.queuedBatches);
  });
});

test("corrupt entries are discarded without crashing startup", async () => {
  await withDirectory(async (directory) => {
    await writeFile(join(directory, "entry-0000000000000001-000000000000.json"), "not-json", "utf8");
    const spool = new TelemetrySpool({ directory });
    const health = await spool.health();
    assert.equal(health.queuedBatches, 0);
    assert.equal(health.droppedBatches, 1);
  });
});

test("replay backs off on a transient failure and preserves the entry for recovery", async () => {
  await withDirectory(async (directory) => {
    const spool = new TelemetrySpool({ directory, retryMinimumMs: 10_000, retryMaximumMs: 10_000 });
    await spool.enqueue("application/json", new TextEncoder().encode("payload"));
    assert.equal(await spool.replay(async () => "retry", true), 0);
    const degraded = await spool.health();
    assert.equal(degraded.replayState, "degraded");
    assert.equal(degraded.queuedBatches, 1);
    assert.ok(spool.nextRetryAt() > Date.now());
    assert.equal(await spool.replay(async () => "delivered"), 0, "backoff prevents a hot retry loop");
    assert.equal(await spool.replay(async () => "delivered", true), 1);
  });
});

test("entry body size is bounded before it can reach disk", async () => {
  await withDirectory(async (directory) => {
    const spool = new TelemetrySpool({ directory, maxBytes: 1024 });
    const health = await spool.enqueue("application/json", new Uint8Array(TELEMETRY_SPOOL_MAX_ENTRY_BODY_BYTES + 1));
    assert.equal(health.queuedBatches, 0);
    assert.equal(health.droppedBatches, 1);
    const files = await readdir(directory);
    const state = JSON.parse(await readFile(join(directory, ".state.json"), "utf8")) as { droppedBatches: number };
    assert.equal(state.droppedBatches, 1);
    assert.equal(files.filter((file) => file.startsWith("entry-")).length, 0);
  });
});

test("spooled OTLP is rebuilt from privacy-safe normalized fields", async () => {
  const payload = {
    resourceLogs: [{
      resource: { attributes: [{ key: "user.email", value: { stringValue: "person@example.test" } }] },
      scopeLogs: [{ logRecords: [{
        timeUnixNano: "1789646400000000000",
        eventName: "codex.api_request",
        body: { stringValue: "private prompt must not persist" },
        attributes: [
          { key: "model", value: { stringValue: "gpt-5.6-sol" } },
          { key: "session.id", value: { stringValue: "session-safe" } },
          { key: "call_id", value: { stringValue: "call-safe" } },
          { key: "authorization", value: { stringValue: "Bearer secret-value" } },
          { key: "tool.output", value: { stringValue: "private tool output" } },
          { key: "input_tokens", value: { intValue: "4" } },
        ],
      }] }],
    }],
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sanitized = await sanitizeTelemetryPayload("application/json", body, "2026-09-17T12:00:00.000Z");
  assert.ok(sanitized);
  assert.equal(sanitized.contentType, "application/json");
  const serialized = new TextDecoder().decode(sanitized.body);
  assert.doesNotMatch(serialized, /person@example\.test|private prompt|Bearer secret-value|private tool output/);
  assert.match(serialized, /codex\.api_request/);
  assert.match(serialized, /codex\.replay\.fingerprint/);
  const original = await normalizeOtlpRecords(decodeOtlpJson(payload), "2026-09-17T12:00:00.000Z");
  const replayed = await normalizeOtlpRecords(decodeOtlpJson(JSON.parse(serialized)), "2026-09-17T12:00:00.000Z", { replay: true });
  assert.equal(replayed[0]?.fingerprint, original[0]?.fingerprint);
  assert.equal(replayed[0]?.callIdHash, original[0]?.callIdHash);
});

test("privacy-safe protobuf replay keeps the protobuf content type and event shape", async () => {
  const logRecord = stringField(12, "codex.api_request");
  const scopeLogs = bytesField(2, logRecord);
  const resourceLogs = bytesField(2, scopeLogs);
  const payload = new Uint8Array(bytesField(1, resourceLogs));
  const sanitized = await sanitizeTelemetryPayload("application/x-protobuf", payload, "2026-09-17T12:00:00.000Z");
  assert.ok(sanitized);
  assert.equal(sanitized.contentType, "application/x-protobuf");
  const records = decodeOtlpProtobuf(sanitized.body);
  assert.equal(records.length, 1);
  assert.equal(records[0].eventName, "codex.api_request");
  assert.equal(records[0].body, undefined);
});
