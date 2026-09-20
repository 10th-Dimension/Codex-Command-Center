import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodexAccountService, discoverCodexExecutable, unavailableCodexAccount, type CodexAccountProvider } from "./codex-app-server-client";
import { defaultTelemetrySpoolDirectory, TelemetrySpool, type TelemetryBufferHealth, type TelemetrySpoolContentType, type TelemetrySpoolReplayResult } from "./telemetry-spool";
import { sanitizeTelemetryPayload } from "./telemetry-spool-payload";
import type { CodexAccountSnapshot, OverlayCacheState } from "../src/lib/overlay/contracts";

export const TELEMETRY_RELAY_HOST = "127.0.0.1";
export const TELEMETRY_RELAY_PORT = 14318;
export const TELEMETRY_RELAY_PATH = "/v1/logs";
export const TELEMETRY_RELAY_HEALTH_PATH = "/health";
export const TELEMETRY_RELAY_MAX_BYTES = 1_048_576;
export const OVERLAY_RELAY_PATH = "/v1/overlay";
export const OVERLAY_UPSTREAM_PATH = "/api/overlay";
export const OVERLAY_MAX_BYTES = 262_144;
export const OVERLAY_TIMEOUT_MS = 8_000;
export const OVERLAY_REFRESH_DEFAULT_MS = 30_000;
export const OVERLAY_REFRESH_MINIMUM_MS = 15_000;
export const ACCOUNT_RELAY_PATH = "/v1/account";
export const ACCOUNT_MAX_BYTES = 65_536;
export const TELEMETRY_REPLAY_BACKOFF_DEFAULT_MS = 5_000;
export const OVERLAY_RANGES = ["24h", "7d", "30d"] as const;
const OVERLAY_CACHE_STATES = ["fresh", "upstream", "stale"] as const;
export type OverlayRange = typeof OVERLAY_RANGES[number];

const environmentNames = [
  "TELEMETRY_COLLECTOR_URL",
  "TELEMETRY_INGEST_KEY",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
] as const;
const optionalEnvironmentNames = ["CODEX_CLI_PATH"] as const;
type RelayEnvironmentName = typeof environmentNames[number];
type OptionalRelayEnvironmentName = typeof optionalEnvironmentNames[number];
export type RelayConfiguration = Record<RelayEnvironmentName, string> & Partial<Record<OptionalRelayEnvironmentName, string>>;

function parseDotEnv(source: string) {
  const values: Partial<RelayConfiguration> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const name = match[1] as RelayEnvironmentName | OptionalRelayEnvironmentName;
    if (![...environmentNames, ...optionalEnvironmentNames].includes(name)) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

export async function loadRelayEnvironment(path = resolve(".env.local")): Promise<RelayConfiguration> {
  let local: Partial<RelayConfiguration> = {};
  try {
    local = parseDotEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const required = Object.fromEntries(environmentNames.map((name) => [name, process.env[name] || local[name] || ""]));
  const optional = Object.fromEntries(optionalEnvironmentNames.flatMap((name) => {
    const value = process.env[name] || local[name];
    return value ? [[name, value]] : [];
  }));
  return { ...required, ...optional } as RelayConfiguration;
}

export function validateRelayConfiguration(configuration: RelayConfiguration) {
  for (const name of environmentNames) {
    if (!configuration[name]) throw new Error(`Missing required relay variable: ${name}.`);
  }
  const collector = new URL(configuration.TELEMETRY_COLLECTOR_URL);
  if (collector.username || collector.password || collector.hash) throw new Error("Collector URL must not contain credentials or a fragment.");
  const localHttp = collector.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(collector.hostname);
  if (collector.protocol !== "https:" && !localHttp) throw new Error("Collector URL must use HTTPS except for local loopback testing.");
  return collector;
}

export function overlayUpstreamUrl(collector: URL, range: OverlayRange) {
  const upstream = new URL(OVERLAY_UPSTREAM_PATH, collector.origin);
  upstream.searchParams.set("range", range);
  return upstream;
}

export function parseOverlayRequestUrl(value: string | undefined): OverlayRange | undefined {
  if (!value) return undefined;
  const url = new URL(value, `http://${TELEMETRY_RELAY_HOST}`);
  if (url.pathname !== OVERLAY_RELAY_PATH) return undefined;
  if ([...url.searchParams.keys()].some((key) => key !== "range")) return undefined;
  const values = url.searchParams.getAll("range");
  if (values.length > 1) return undefined;
  const range = values[0] || "24h";
  return OVERLAY_RANGES.includes(range as OverlayRange) ? range as OverlayRange : undefined;
}

const forbiddenOverlayKey = /(?:authorization|cookie|credential|secret|token_value|access_token|refresh_token|password|private_key|prompt|reasoning_text|reasoning_summary|command|arguments|stdout|stderr|tool_output|response_body|request_body|email|account[_-]?id|user\.email|user\.account_id|hostname|host\.name|username)/i;

export function isSafeOverlayPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (typeof root.generatedAt !== "string" || !OVERLAY_RANGES.includes(root.range as OverlayRange)) return false;
  if (!root.health || typeof root.health !== "object" || !root.windowSummary || typeof root.windowSummary !== "object") return false;
  if (root.overlayCache !== undefined && !OVERLAY_CACHE_STATES.includes(root.overlayCache as OverlayCacheState)) return false;
  if (root.telemetryBuffer !== undefined && !isSafeTelemetryBufferPayload(root.telemetryBuffer)) return false;
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (++visited > 2_000) return false;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenOverlayKey.test(key)) return false;
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return true;
}

export function isSafeTelemetryBufferPayload(value: unknown): value is TelemetryBufferHealth {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const buffer = value as Record<string, unknown>;
  if (!Number.isSafeInteger(buffer.queuedBatches) || Number(buffer.queuedBatches) < 0) return false;
  if (!Number.isSafeInteger(buffer.queuedBytes) || Number(buffer.queuedBytes) < 0) return false;
  if (!Number.isSafeInteger(buffer.droppedBatches) || Number(buffer.droppedBatches) < 0) return false;
  if (!["idle", "buffering", "replaying", "degraded"].includes(String(buffer.replayState))) return false;
  if (buffer.oldestQueuedAgeSeconds !== undefined && (!Number.isSafeInteger(buffer.oldestQueuedAgeSeconds) || Number(buffer.oldestQueuedAgeSeconds) < 0)) return false;
  for (const key of ["lastSuccessfulReplayAt", "lastUpstreamFailureAt"]) {
    if (buffer[key] !== undefined && typeof buffer[key] !== "string") return false;
  }
  return true;
}

/**
 * A response can be structurally safe while still being an outage envelope
 * (`health: unavailable`, empty summaries, and no telemetry timestamp). Do
 * not let that envelope replace a previously usable snapshot in the local
 * cache. The dashboard and overlay read this bounded snapshot, never raw D1.
 */
export function isUsableOverlayPayload(value: Record<string, unknown>): boolean {
  const health = value.health;
  if (!health || typeof health !== "object" || Array.isArray(health)) return false;
  const healthRecord = health as Record<string, unknown>;
  return healthRecord.telemetry === "connected" && healthRecord.d1 === "connected";
}

export function isSafeCodexAccountPayload(value: unknown): value is CodexAccountSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!["connected", "stale", "unavailable", "error"].includes(String(root.status))) return false;
  if (!["live", "recent", "stale", "unavailable"].includes(String(root.freshness))) return false;
  if (!Array.isArray(root.limits) || root.limits.length > 16) return false;
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > ACCOUNT_MAX_BYTES) return false;
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (++visited > 1_000) return false;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenOverlayKey.test(key)) return false;
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return true;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > TELEMETRY_RELAY_MAX_BYTES) {
        reject(Object.assign(new Error("payload_too_large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export function createTelemetryRelay(configuration: RelayConfiguration, options: {
  fetchImpl?: typeof fetch;
  overlayTimeoutMs?: number;
  overlayRefreshMs?: number;
  now?: () => number;
  accountProvider?: Pick<CodexAccountProvider, "getSnapshot">;
  spool?: TelemetrySpool;
  spoolDirectory?: string;
  spoolReplayBackoffMs?: number;
} = {}) {
  const collector = validateRelayConfiguration(configuration);
  const fetchImpl = options.fetchImpl ?? fetch;
  const overlayTimeoutMs = options.overlayTimeoutMs ?? OVERLAY_TIMEOUT_MS;
  const overlayRefreshMs = Math.max(OVERLAY_REFRESH_MINIMUM_MS, options.overlayRefreshMs ?? OVERLAY_REFRESH_DEFAULT_MS);
  const now = options.now ?? Date.now;
  const accountProvider = options.accountProvider ?? { getSnapshot: () => unavailableCodexAccount() };
  const spool = options.spool ?? new TelemetrySpool({
    directory: options.spoolDirectory ?? defaultTelemetrySpoolDirectory(),
    now,
    retryMinimumMs: options.spoolReplayBackoffMs ?? TELEMETRY_REPLAY_BACKOFF_DEFAULT_MS,
  });
  const allowedBrowserOrigin = collector.origin;
  const overlayCache = new Map<OverlayRange, { payload: Record<string, unknown>; fetchedAt: number }>();
  const overlayInFlight = new Map<OverlayRange, Promise<Record<string, unknown>>>();
  const relayCounters = {
    ingestRequests: 0,
    forwardedRequests: 0,
    bufferedRequests: 0,
    rawEventsAccepted: 0,
    duplicateEventsIgnored: 0,
    rollupUpserts: 0,
    sessionSummaryUpserts: 0,
    snapshotRebuilds: 0,
    cleanupDeletes: 0,
    d1RowsWritten: 0,
    d1RowsWrittenObserved: false,
  };
  let directForwardInFlight = false;
  let replayInFlight: Promise<void> | undefined;
  let replayTimer: ReturnType<typeof setTimeout> | undefined;

  function numberHeader(headers: Headers, name: string) {
    const value = Number(headers.get(name));
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  function observeIngestHeaders(headers: Headers) {
    const accepted = numberHeader(headers, "x-codex-telemetry-accepted");
    const duplicates = numberHeader(headers, "x-codex-telemetry-duplicates");
    const rollups = numberHeader(headers, "x-codex-telemetry-rollup-upserts");
    const sessions = numberHeader(headers, "x-codex-telemetry-session-upserts");
    const snapshots = numberHeader(headers, "x-codex-telemetry-snapshot-rebuilds");
    const cleanup = numberHeader(headers, "x-codex-telemetry-cleanup-deletes");
    const rows = numberHeader(headers, "x-codex-telemetry-d1-rows-written");
    if (accepted !== undefined) relayCounters.rawEventsAccepted += accepted;
    if (duplicates !== undefined) relayCounters.duplicateEventsIgnored += duplicates;
    if (rollups !== undefined) relayCounters.rollupUpserts += rollups;
    if (sessions !== undefined) relayCounters.sessionSummaryUpserts += sessions;
    if (snapshots !== undefined) relayCounters.snapshotRebuilds += snapshots;
    if (cleanup !== undefined) relayCounters.cleanupDeletes += cleanup;
    if (rows !== undefined) {
      relayCounters.d1RowsWrittenObserved = true;
      relayCounters.d1RowsWritten += rows;
    }
  }

  async function sendToCollector(contentType: TelemetrySpoolContentType, body: Uint8Array, replay = false) {
    const upstream = await fetchImpl(collector, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "cf-access-client-id": configuration.CF_ACCESS_CLIENT_ID,
        "cf-access-client-secret": configuration.CF_ACCESS_CLIENT_SECRET,
        "x-codex-telemetry-key": configuration.TELEMETRY_INGEST_KEY,
        ...(replay ? { "x-codex-telemetry-replay": "1" } : {}),
      },
      body: Uint8Array.from(body),
      signal: AbortSignal.timeout(15_000),
    });
    const upstreamBody = new Uint8Array(await upstream.arrayBuffer());
    return { upstream, upstreamBody };
  }

  function retryableStatus(status: number) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  async function sendQueued(item: { contentType: TelemetrySpoolContentType; body: Uint8Array }): Promise<TelemetrySpoolReplayResult> {
    try {
      const { upstream } = await sendToCollector(item.contentType, item.body, true);
      if (upstream.ok) {
        relayCounters.forwardedRequests += 1;
        observeIngestHeaders(upstream.headers);
        return "delivered";
      }
      return retryableStatus(upstream.status) ? "retry" : "drop";
    } catch {
      return "retry";
    }
  }

  function scheduleReplay(delayMs = 0) {
    if (replayTimer) return;
    replayTimer = setTimeout(() => {
      replayTimer = undefined;
      void replayBuffered().catch(() => undefined);
    }, Math.max(0, delayMs));
    replayTimer.unref?.();
  }

  async function replayBuffered(force = false) {
    if (replayInFlight) return replayInFlight;
    replayInFlight = (async () => {
      try {
        await spool.replay(sendQueued, force);
        const health = await spool.health();
        if (health.queuedBatches > 0) scheduleReplay(Math.max(0, spool.nextRetryAt() - now()));
      } catch {
        // A local spool filesystem failure must not terminate the relay process.
      }
    })().finally(() => {
      replayInFlight = undefined;
    });
    return replayInFlight;
  }

  async function bufferBody(contentType: TelemetrySpoolContentType, body: Uint8Array) {
    try {
      const sanitized = await sanitizeTelemetryPayload(contentType, body, new Date(now()).toISOString());
      if (!sanitized) return spool.drop();
      await spool.recordUpstreamFailure();
      const health = await spool.enqueue(sanitized.contentType, sanitized.body);
      relayCounters.bufferedRequests += 1;
      scheduleReplay(Math.max(0, spool.nextRetryAt() - now()));
      return health;
    } catch {
      return undefined;
    }
  }

  async function bufferedResponse(response: ServerResponse, contentType: TelemetrySpoolContentType, health: TelemetryBufferHealth) {
    const headers: Record<string, string> = {
      "cache-control": "no-store",
      "content-type": contentType === "application/json" ? "application/json" : "application/x-protobuf",
      "x-codex-telemetry-buffered": health.queuedBatches > 0 ? "true" : "false",
      "x-codex-telemetry-queued": String(health.queuedBatches),
      "x-codex-telemetry-dropped": String(health.droppedBatches),
    };
    response.writeHead(202, headers);
    response.end(contentType === "application/json" ? JSON.stringify({ partialSuccess: {} }) : new Uint8Array());
  }

  async function fetchOverlay(range: OverlayRange) {
    const existing = overlayInFlight.get(range);
    if (existing) return existing;
    const pending = (async () => {
      const upstream = await fetchImpl(overlayUpstreamUrl(collector, range), {
        method: "GET",
        headers: {
          accept: "application/json",
          "cf-access-client-id": configuration.CF_ACCESS_CLIENT_ID,
          "cf-access-client-secret": configuration.CF_ACCESS_CLIENT_SECRET,
        },
        redirect: "error",
        signal: AbortSignal.timeout(overlayTimeoutMs),
      });
      const contentLength = Number(upstream.headers.get("content-length"));
      const contentType = upstream.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
      if (!upstream.ok || contentType !== "application/json" || (Number.isFinite(contentLength) && contentLength > OVERLAY_MAX_BYTES)) throw new Error("invalid_overlay_upstream");
      const body = new Uint8Array(await upstream.arrayBuffer());
      if (body.byteLength > OVERLAY_MAX_BYTES) throw new Error("overlay_response_too_large");
      const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (!isSafeOverlayPayload(parsed)) throw new Error("unsafe_overlay_payload");
      const cached = overlayCache.get(range);
      if (cached && isUsableOverlayPayload(cached.payload) && !isUsableOverlayPayload(parsed)) {
        throw new Error("degraded_overlay_upstream");
      }
      overlayCache.set(range, { payload: parsed, fetchedAt: now() });
      return parsed;
    })();
    overlayInFlight.set(range, pending);
    try {
      return await pending;
    } finally {
      overlayInFlight.delete(range);
    }
  }

  function accountSnapshot() {
    const snapshot = accountProvider.getSnapshot();
    return isSafeCodexAccountPayload(snapshot) ? snapshot : unavailableCodexAccount("error");
  }

  async function overlayBody(payload: Record<string, unknown>, overlayCache: OverlayCacheState) {
    const finalPayload = { ...payload, overlayCache, codexAccount: accountSnapshot(), telemetryBuffer: await spool.health() };
    if (!isSafeOverlayPayload(finalPayload)) throw new Error("unsafe_overlay_payload");
    const body = new TextEncoder().encode(JSON.stringify(finalPayload));
    if (body.byteLength > OVERLAY_MAX_BYTES) throw new Error("overlay_response_too_large");
    return body;
  }

  function setAccountCors(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin;
    if (origin !== allowedBrowserOrigin) return false;
    response.setHeader("access-control-allow-origin", allowedBrowserOrigin);
    response.setHeader("vary", "Origin");
    return true;
  }

  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");

    if (request.method === "GET" && request.url === TELEMETRY_RELAY_HEALTH_PATH) {
      const buffer = await spool.health();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        status: "ok",
        service: "codex-telemetry-relay",
        telemetryBuffer: buffer,
        diagnostics: {
          ingestRequests: relayCounters.ingestRequests,
          forwardedRequests: relayCounters.forwardedRequests,
          bufferedRequests: relayCounters.bufferedRequests,
          rawEventsAccepted: relayCounters.rawEventsAccepted,
          duplicateEventsIgnored: relayCounters.duplicateEventsIgnored,
          rollupUpserts: relayCounters.rollupUpserts,
          sessionSummaryUpserts: relayCounters.sessionSummaryUpserts,
          snapshotRebuilds: relayCounters.snapshotRebuilds,
          cleanupDeletes: relayCounters.cleanupDeletes,
          ...(relayCounters.d1RowsWrittenObserved ? { d1RowsWritten: relayCounters.d1RowsWritten } : {}),
        },
      }));
      return;
    }

    if (request.url?.startsWith(TELEMETRY_RELAY_HEALTH_PATH)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (request.url === ACCOUNT_RELAY_PATH && request.method === "OPTIONS") {
      if (!setAccountCors(request, response) || request.headers["access-control-request-method"] !== "GET") {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "origin_not_allowed" }));
        return;
      }
      response.writeHead(204, {
        "access-control-allow-methods": "GET",
        ...(request.headers["access-control-request-private-network"] === "true" ? { "access-control-allow-private-network": "true" } : {}),
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    if (request.url === ACCOUNT_RELAY_PATH && request.method === "GET") {
      const origin = request.headers.origin;
      if (origin && !setAccountCors(request, response)) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "origin_not_allowed" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(accountSnapshot()));
      return;
    }

    if (request.url?.startsWith(ACCOUNT_RELAY_PATH)) {
      response.writeHead(405, { "content-type": "application/json", allow: "GET, OPTIONS" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith(OVERLAY_RELAY_PATH)) {
      const range = parseOverlayRequestUrl(request.url);
      if (!range) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_overlay_request" }));
        return;
      }
      const cached = overlayCache.get(range);
      if (cached && now() - cached.fetchedAt < overlayRefreshMs) {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-codex-overlay-cache": "fresh" });
        response.end(await overlayBody(cached.payload, "fresh"));
        return;
      }
      try {
        const body = await overlayBody(await fetchOverlay(range), "upstream");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-codex-overlay-cache": "upstream" });
        response.end(body);
      } catch {
        if (cached) {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-codex-overlay-cache": "stale" });
          response.end(await overlayBody(cached.payload, "stale"));
          return;
        }
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "overlay_upstream_unavailable" }));
      }
      return;
    }

    if (request.url?.startsWith(OVERLAY_RELAY_PATH)) {
      response.writeHead(405, { "content-type": "application/json", allow: "GET" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (request.method !== "POST" || request.url !== TELEMETRY_RELAY_PATH) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_RELAY_MAX_BYTES) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
    if (!["application/json", "application/x-protobuf", "application/protobuf"].includes(contentType)) {
      response.writeHead(415, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unsupported_media_type" }));
      return;
    }

    try {
      relayCounters.ingestRequests += 1;
      const body = await readRequestBody(request);
      const spoolPending = await spool.hasPending().catch(() => false);
      if (spoolPending || directForwardInFlight) {
        const health = await bufferBody(contentType as TelemetrySpoolContentType, body);
        if (health) await bufferedResponse(response, contentType as TelemetrySpoolContentType, health);
        else {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "collector_unavailable" }));
        }
        return;
      }

      directForwardInFlight = true;
      try {
        const { upstream, upstreamBody } = await sendToCollector(contentType as TelemetrySpoolContentType, body);
        if (retryableStatus(upstream.status)) {
          const health = await bufferBody(contentType as TelemetrySpoolContentType, body);
          if (health) await bufferedResponse(response, contentType as TelemetrySpoolContentType, health);
          else {
            response.writeHead(502, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "collector_unavailable" }));
          }
          return;
        }
        relayCounters.forwardedRequests += 1;
        observeIngestHeaders(upstream.headers);
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/x-protobuf" });
        response.end(upstreamBody);
      } catch {
        const health = await bufferBody(contentType as TelemetrySpoolContentType, body);
        if (health) await bufferedResponse(response, contentType as TelemetrySpoolContentType, health);
        else {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "collector_unavailable" }));
        }
      } finally {
        directForwardInFlight = false;
        if (await spool.hasPending().catch(() => false)) scheduleReplay();
      }
    } catch (error) {
      const status = error instanceof Error && "statusCode" in error && error.statusCode === 413 ? 413 : 502;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: status === 413 ? "payload_too_large" : "collector_unavailable" }));
    }
  });
  server.on("close", () => {
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = undefined;
  });
  void spool.ready().then(async () => {
    if (await spool.hasPending()) scheduleReplay(Math.max(0, spool.nextRetryAt() - now()));
  }).catch(() => undefined);
  return server;
}

function stopWithParent(server: ReturnType<typeof createServer>, closeOwned: () => Promise<void>) {
  const parentPid = Number(process.env.CODEX_LIVE_PARENT_PID ?? "");
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || parentPid === process.pid) return;
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(timer);
      server.close(() => void closeOwned().finally(() => process.exit(0)));
    }
  }, 2_000);
  timer.unref();
}

async function main() {
  const configuration = await loadRelayEnvironment();
  const accountService = createCodexAccountService({
    discoverExecutable: () => discoverCodexExecutable({ ...process.env, CODEX_CLI_PATH: configuration.CODEX_CLI_PATH }),
  });
  accountService.start();
  const server = createTelemetryRelay(configuration, {
    accountProvider: accountService,
    spool: new TelemetrySpool({ directory: defaultTelemetrySpoolDirectory() }),
  });
  stopWithParent(server, () => accountService.close());
  server.listen(TELEMETRY_RELAY_PORT, TELEMETRY_RELAY_HOST, () => {
    console.log(`Codex telemetry relay listening on loopback port ${TELEMETRY_RELAY_PORT}.`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unable to start telemetry relay.");
    process.exitCode = 1;
  });
}
