import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TELEMETRY_RELAY_HOST = "127.0.0.1";
export const TELEMETRY_RELAY_PORT = 14318;
export const TELEMETRY_RELAY_PATH = "/v1/logs";
export const TELEMETRY_RELAY_MAX_BYTES = 1_048_576;
export const OVERLAY_RELAY_PATH = "/v1/overlay";
export const OVERLAY_UPSTREAM_PATH = "/api/overlay";
export const OVERLAY_MAX_BYTES = 262_144;
export const OVERLAY_TIMEOUT_MS = 8_000;
export const OVERLAY_REFRESH_DEFAULT_MS = 30_000;
export const OVERLAY_REFRESH_MINIMUM_MS = 15_000;
export const OVERLAY_RANGES = ["24h", "7d", "30d"] as const;
export type OverlayRange = typeof OVERLAY_RANGES[number];

const environmentNames = [
  "TELEMETRY_COLLECTOR_URL",
  "TELEMETRY_INGEST_KEY",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
] as const;
type RelayEnvironmentName = typeof environmentNames[number];
export type RelayConfiguration = Record<RelayEnvironmentName, string>;

function parseDotEnv(source: string) {
  const values: Partial<RelayConfiguration> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const name = match[1] as RelayEnvironmentName;
    if (!environmentNames.includes(name)) continue;
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
  return Object.fromEntries(environmentNames.map((name) => [name, process.env[name] || local[name] || ""])) as RelayConfiguration;
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

const forbiddenOverlayKey = /(?:authorization|cookie|credential|secret|token_value|access_token|refresh_token|password|private_key|prompt|reasoning_text|reasoning_summary|command|arguments|stdout|stderr|tool_output|response_body|request_body|user\.email|user\.account_id|hostname|host\.name|username)/i;

export function isSafeOverlayPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (typeof root.generatedAt !== "string" || !OVERLAY_RANGES.includes(root.range as OverlayRange)) return false;
  if (!root.health || typeof root.health !== "object" || !root.windowSummary || typeof root.windowSummary !== "object") return false;
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
} = {}) {
  const collector = validateRelayConfiguration(configuration);
  const fetchImpl = options.fetchImpl ?? fetch;
  const overlayTimeoutMs = options.overlayTimeoutMs ?? OVERLAY_TIMEOUT_MS;
  const overlayRefreshMs = Math.max(OVERLAY_REFRESH_MINIMUM_MS, options.overlayRefreshMs ?? OVERLAY_REFRESH_DEFAULT_MS);
  const now = options.now ?? Date.now;
  const overlayCache = new Map<OverlayRange, { body: Uint8Array; fetchedAt: number }>();
  const overlayInFlight = new Map<OverlayRange, Promise<Uint8Array>>();

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
      overlayCache.set(range, { body, fetchedAt: now() });
      return body;
    })();
    overlayInFlight.set(range, pending);
    try {
      return await pending;
    } finally {
      overlayInFlight.delete(range);
    }
  }

  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");

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
        response.end(cached.body);
        return;
      }
      try {
        const body = await fetchOverlay(range);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-codex-overlay-cache": "upstream" });
        response.end(body);
      } catch {
        if (cached) {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-codex-overlay-cache": "stale" });
          response.end(cached.body);
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
      const body = await readRequestBody(request);
      const upstream = await fetchImpl(collector, {
        method: "POST",
        headers: {
          "content-type": contentType,
          "cf-access-client-id": configuration.CF_ACCESS_CLIENT_ID,
          "cf-access-client-secret": configuration.CF_ACCESS_CLIENT_SECRET,
          "x-codex-telemetry-key": configuration.TELEMETRY_INGEST_KEY,
        },
        body: Uint8Array.from(body),
        signal: AbortSignal.timeout(15_000),
      });
      const upstreamBody = new Uint8Array(await upstream.arrayBuffer());
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/x-protobuf" });
      response.end(upstreamBody);
    } catch (error) {
      const status = error instanceof Error && "statusCode" in error && error.statusCode === 413 ? 413 : 502;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: status === 413 ? "payload_too_large" : "collector_unavailable" }));
    }
  });
}

async function main() {
  const configuration = await loadRelayEnvironment();
  const server = createTelemetryRelay(configuration);
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
