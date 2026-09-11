import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TELEMETRY_RELAY_HOST = "127.0.0.1";
export const TELEMETRY_RELAY_PORT = 14318;
export const TELEMETRY_RELAY_PATH = "/v1/logs";
export const TELEMETRY_RELAY_MAX_BYTES = 1_048_576;

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

export function createTelemetryRelay(configuration: RelayConfiguration, options: { fetchImpl?: typeof fetch } = {}) {
  const collector = validateRelayConfiguration(configuration);
  const fetchImpl = options.fetchImpl ?? fetch;

  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
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
    console.log(`Codex telemetry relay listening on http://${TELEMETRY_RELAY_HOST}:${TELEMETRY_RELAY_PORT}${TELEMETRY_RELAY_PATH}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unable to start telemetry relay.");
    process.exitCode = 1;
  });
}
