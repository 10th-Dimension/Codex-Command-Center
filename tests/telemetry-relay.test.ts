import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ACCOUNT_MAX_BYTES, ACCOUNT_RELAY_PATH, createTelemetryRelay, isSafeCodexAccountPayload, isSafeOverlayPayload, OVERLAY_UPSTREAM_PATH, TELEMETRY_RELAY_HEALTH_PATH, TELEMETRY_RELAY_HOST } from "../scripts/telemetry-relay";

const relayConfiguration = {
  TELEMETRY_COLLECTOR_URL: "https://command-center.example/api/telemetry/ingest",
  TELEMETRY_INGEST_KEY: "test-ingest-key",
  CF_ACCESS_CLIENT_ID: "test-access-id",
  CF_ACCESS_CLIENT_SECRET: "test-access-secret",
};

const overlaySnapshot = {
  generatedAt: "2026-09-12T12:00:00.000Z",
  range: "24h",
  health: { telemetry: "connected", d1: "connected", github: "connected", ci: "connected" },
  windowSummary: { inputTokens: 10, outputTokens: 0 },
  tokenTrend: [],
  modelDistribution: [],
  reasoningDistribution: [],
};

const accountSnapshot = {
  status: "connected" as const,
  freshness: "live" as const,
  observedAt: "2026-09-14T12:00:00.000Z",
  rateLimitsObservedAt: "2026-09-14T12:00:00.000Z",
  planType: "pro",
  ordinaryUsageAllowed: true,
  limits: [{ limitId: "codex", windows: [{ slot: "primary" as const, kind: "5h" as const, label: "5-hour", durationMins: 300, usedPercent: 33, remainingPercent: 67, resetsAt: 2_000_000_000 }] }],
};

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

test("relay health check is local, bounded, and does not contact the upstream", async () => {
  let calls = 0;
  const relay = createTelemetryRelay(relayConfiguration, {
    fetchImpl: async () => { calls += 1; return new Response(); },
  });
  const relayPort = await listen(relay);
  try {
    const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${TELEMETRY_RELAY_HEALTH_PATH}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "codex-telemetry-relay" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls, 0);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/health/extra`)).status, 404);
  } finally {
    await close(relay);
  }
});

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

test("overlay read endpoint uses only the fixed upstream path and Access headers", async () => {
  let requestUrl = "";
  let requestHeaders = new Headers();
  const relay = createTelemetryRelay(relayConfiguration, { fetchImpl: async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return Response.json(overlaySnapshot);
  } });
  const relayPort = await listen(relay);
  try {
    const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=7d`);
    assert.equal(response.status, 200);
    assert.equal(new URL(requestUrl).pathname, OVERLAY_UPSTREAM_PATH);
    assert.equal(new URL(requestUrl).search, "?range=7d");
    assert.equal(requestHeaders.get("cf-access-client-id"), "test-access-id");
    assert.equal(requestHeaders.get("cf-access-client-secret"), "test-access-secret");
    assert.equal(requestHeaders.has("x-codex-telemetry-key"), false);
  } finally {
    await close(relay);
  }
});

test("overlay relay serves local cache and enforces the minimum upstream refresh interval", async () => {
  let calls = 0;
  let clock = 1_000;
  const relay = createTelemetryRelay(relayConfiguration, {
    now: () => clock,
    overlayRefreshMs: 1,
    fetchImpl: async () => { calls += 1; return Response.json({ ...overlaySnapshot, generatedAt: new Date(clock).toISOString() }); },
  });
  const relayPort = await listen(relay);
  try {
    const first = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`);
    assert.equal(first.headers.get("x-codex-overlay-cache"), "upstream");
    clock += 14_999;
    const cached = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`);
    assert.equal(cached.headers.get("x-codex-overlay-cache"), "fresh");
    assert.equal(calls, 1);
    clock += 1;
    const refreshed = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`);
    assert.equal(refreshed.headers.get("x-codex-overlay-cache"), "upstream");
    assert.equal(calls, 2);
  } finally {
    await close(relay);
  }
});

test("overlay relay serves the last safe snapshot when a stale refresh is offline", async () => {
  let clock = 1_000;
  let online = true;
  const relay = createTelemetryRelay(relayConfiguration, {
    now: () => clock,
    overlayRefreshMs: 15_000,
    fetchImpl: async () => {
      if (!online) throw new Error("offline");
      return Response.json(overlaySnapshot);
    },
  });
  const relayPort = await listen(relay);
  try {
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=7d`)).status, 200);
    online = false;
    clock += 15_001;
    const stale = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=7d`);
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-codex-overlay-cache"), "stale");
    assert.deepEqual(await stale.json(), { ...overlaySnapshot, codexAccount: { status: "unavailable", freshness: "unavailable", limits: [] } });
  } finally {
    await close(relay);
  }
});

test("overlay endpoint validates range, method, and rejects arbitrary proxy paths", async () => {
  let calls = 0;
  const relay = createTelemetryRelay(relayConfiguration, { fetchImpl: async () => { calls += 1; return Response.json(overlaySnapshot); } });
  const relayPort = await listen(relay);
  try {
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=weekly`)).status, 400);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h&url=https://example.com`)).status, 400);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay/admin?range=24h`)).status, 400);
    assert.equal(calls, 0);
  } finally {
    await close(relay);
  }
});

test("overlay endpoint handles unavailable, timed-out, and invalid upstream responses", async () => {
  const cases: Array<Parameters<typeof createTelemetryRelay>[1]> = [
    { fetchImpl: async () => { throw new Error("offline"); } },
    { fetchImpl: async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true })), overlayTimeoutMs: 5 },
    { fetchImpl: async () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }) },
    { fetchImpl: async () => Response.json({ ...overlaySnapshot, prompt: "must not pass" }) },
  ];
  for (const options of cases) {
    const relay = createTelemetryRelay(relayConfiguration, options);
    const relayPort = await listen(relay);
    try {
      const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "overlay_upstream_unavailable" });
    } finally {
      await close(relay);
    }
  }
});

test("safe overlay validator rejects credential and private-content fields", () => {
  assert.equal(isSafeOverlayPayload(overlaySnapshot), true);
  for (const key of ["prompt", "command", "stdout", "authorization", "user.email", "hostname", "secret"]) {
    assert.equal(isSafeOverlayPayload({ ...overlaySnapshot, nested: { [key]: "private" } }), false);
  }
});

test("account endpoint returns only the bounded local snapshot and rejects unsupported methods", async () => {
  const relay = createTelemetryRelay(relayConfiguration, { accountProvider: { getSnapshot: () => accountSnapshot } });
  const relayPort = await listen(relay);
  try {
    const response = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), accountSnapshot);
    assert.equal(Number(response.headers.get("content-length") ?? 0) <= ACCOUNT_MAX_BYTES, true);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}/extra`)).status, 405);
  } finally {
    await close(relay);
  }
});

test("account endpoint CORS allows only the configured Command Center origin", async () => {
  const relay = createTelemetryRelay(relayConfiguration, { accountProvider: { getSnapshot: () => accountSnapshot } });
  const relayPort = await listen(relay);
  try {
    const allowed = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}`, { headers: { origin: "https://command-center.example" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://command-center.example");
    assert.notEqual(allowed.headers.get("access-control-allow-origin"), "*");

    const preflight = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}`, { method: "OPTIONS", headers: { origin: "https://command-center.example", "access-control-request-method": "GET", "access-control-request-private-network": "true" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET");
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

    const rejected = await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}${ACCOUNT_RELAY_PATH}`, { headers: { origin: "https://evil.example" } });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.has("access-control-allow-origin"), false);
  } finally {
    await close(relay);
  }
});

test("local account data is attached after upstream validation without changing overlay caching", async () => {
  let remainingPercent = 67;
  let calls = 0;
  const relay = createTelemetryRelay(relayConfiguration, {
    accountProvider: { getSnapshot: () => ({ ...accountSnapshot, limits: [{ ...accountSnapshot.limits[0], windows: [{ ...accountSnapshot.limits[0].windows[0], remainingPercent }] }] }) },
    fetchImpl: async () => { calls += 1; return Response.json(overlaySnapshot); },
  });
  const relayPort = await listen(relay);
  try {
    const first = await (await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`)).json() as typeof overlaySnapshot & { codexAccount: typeof accountSnapshot };
    assert.equal(first.codexAccount.limits[0].windows[0].remainingPercent, 67);
    remainingPercent = 66;
    const second = await (await fetch(`http://${TELEMETRY_RELAY_HOST}:${relayPort}/v1/overlay?range=24h`)).json() as typeof first;
    assert.equal(second.codexAccount.limits[0].windows[0].remainingPercent, 66);
    assert.equal(calls, 1);
    assert.equal(Buffer.byteLength(JSON.stringify(second), "utf8") < 262_144, true);
  } finally {
    await close(relay);
  }
});

test("account validator rejects identity and secret-shaped keys", () => {
  assert.equal(isSafeCodexAccountPayload(accountSnapshot), true);
  for (const key of ["email", "accountId", "authorization", "prompt", "stdout"]) {
    assert.equal(isSafeCodexAccountPayload({ ...accountSnapshot, [key]: "private" }), false);
  }
});
