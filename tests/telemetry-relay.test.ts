import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createTelemetryRelay, TELEMETRY_RELAY_HOST } from "../scripts/telemetry-relay";

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, TELEMETRY_RELAY_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Expected TCP listener."));
      else resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("local relay binds to loopback and forwards OTLP with Access and ingestion headers", async () => {
  let captured: { headers: Headers; body: string } | undefined;
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = { headers: new Headers(request.headers as Record<string, string>), body: Buffer.concat(chunks).toString("utf8") };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ partialSuccess: {} }));
  });
  const collectorPort = await listen(collector);
  const relay = createTelemetryRelay({
    TELEMETRY_COLLECTOR_URL: `http://${TELEMETRY_RELAY_HOST}:${collectorPort}/api/telemetry/ingest`,
    TELEMETRY_INGEST_KEY: "test-ingest-key",
    CF_ACCESS_CLIENT_ID: "test-access-id",
    CF_ACCESS_CLIENT_SECRET: "test-access-secret",
  });
  const relayPort = await listen(relay);

  try {
    const payload = JSON.stringify({ resourceLogs: [] });
    const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    assert.equal(response.status, 200);
    assert.equal(captured?.headers.get("cf-access-client-id"), "test-access-id");
    assert.equal(captured?.headers.get("cf-access-client-secret"), "test-access-secret");
    assert.equal(captured?.headers.get("x-codex-telemetry-key"), "test-ingest-key");
    assert.equal(captured?.body, payload);
    const address = relay.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, TELEMETRY_RELAY_HOST);
  } finally {
    await close(relay);
    await close(collector);
  }
});

test("relay rejects unsupported media types before forwarding", async () => {
  let calls = 0;
  const relay = createTelemetryRelay({
    TELEMETRY_COLLECTOR_URL: "http://127.0.0.1:9/api/telemetry/ingest",
    TELEMETRY_INGEST_KEY: "test-ingest-key",
    CF_ACCESS_CLIENT_ID: "test-access-id",
    CF_ACCESS_CLIENT_SECRET: "test-access-secret",
  }, { fetchImpl: async () => { calls += 1; return new Response(); } });
  const relayPort = await listen(relay);
  try {
    const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/logs`, { method: "POST", headers: { "content-type": "text/plain" }, body: "no" });
    assert.equal(response.status, 415);
    assert.equal(calls, 0);
  } finally {
    await close(relay);
  }
});

test("relay logging statements cannot reference secret configuration", async () => {
  const source = await readFile(new URL("../scripts/telemetry-relay.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:TELEMETRY_INGEST_KEY|CF_ACCESS_CLIENT|configuration)/);
});
