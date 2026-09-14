import type { D1DatabaseLike } from "@/lib/telemetry/database";
import { deleteExpiredTelemetry, insertTelemetryEventsDetailed } from "@/lib/telemetry/database";
import { normalizeOtlpRecords } from "@/lib/telemetry/normalize";
import { decodeOtlpJson, decodeOtlpProtobuf } from "@/lib/telemetry/otlp";
import {
  applyTelemetryRollups,
  deleteExpiredRollups,
  isMissingRollupSchemaError,
  refreshStaleMaterializedSnapshots,
} from "@/lib/telemetry/rollups";

export const MAX_TELEMETRY_PAYLOAD_BYTES = 1_048_576;
const INGEST_HEADER = "x-codex-telemetry-key";

export interface TelemetryIngestOptions {
  database?: D1DatabaseLike;
  ingestKey?: string;
  retentionDays: number;
  now?: () => Date;
}

function secureEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function safeJsonError(status: number, code: string) {
  return Response.json({ error: code }, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function successResponse(contentType: string, accepted: number, duplicateCount: number, rollups: "updated" | "schema-unavailable") {
  const headers = {
    "cache-control": "no-store",
    "x-codex-telemetry-accepted": String(accepted),
    "x-codex-telemetry-duplicates": String(duplicateCount),
    "x-codex-telemetry-rollups": rollups,
    "x-content-type-options": "nosniff",
  };
  if (contentType === "application/json") {
    return Response.json({ partialSuccess: {} }, { status: 200, headers });
  }
  return new Response(new Uint8Array(), { status: 200, headers: { ...headers, "content-type": "application/x-protobuf" } });
}

export async function handleTelemetryIngest(request: Request, options: TelemetryIngestOptions) {
  if (!options.database) return safeJsonError(503, "telemetry_storage_unavailable");
  if (!options.ingestKey) return safeJsonError(503, "telemetry_ingest_not_configured");

  const suppliedKey = request.headers.get(INGEST_HEADER) ?? "";
  if (!suppliedKey || !secureEqual(suppliedKey, options.ingestKey)) return safeJsonError(401, "unauthorized");

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TELEMETRY_PAYLOAD_BYTES) {
    return safeJsonError(413, "payload_too_large");
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!["application/json", "application/x-protobuf", "application/protobuf"].includes(contentType)) {
    return safeJsonError(415, "unsupported_media_type");
  }

  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch {
    return safeJsonError(400, "invalid_request_body");
  }
  if (body.byteLength > MAX_TELEMETRY_PAYLOAD_BYTES) return safeJsonError(413, "payload_too_large");

  try {
    const records = contentType === "application/json"
      ? decodeOtlpJson(JSON.parse(new TextDecoder().decode(body)))
      : decodeOtlpProtobuf(body);
    const now = options.now?.() ?? new Date();
    const normalized = await normalizeOtlpRecords(records, now.toISOString());
    const insertion = await insertTelemetryEventsDetailed(options.database, normalized);
    let rollupState: "updated" | "schema-unavailable" = "updated";
    try {
      await applyTelemetryRollups(options.database, insertion.insertedEvents);
      await deleteExpiredRollups(options.database, now);
      await refreshStaleMaterializedSnapshots(options.database, now);
    } catch (error) {
      if (!isMissingRollupSchemaError(error)) throw error;
      rollupState = "schema-unavailable";
    }
    await deleteExpiredTelemetry(options.database, options.retentionDays, now);
    return successResponse(contentType, insertion.inserted, normalized.length - insertion.inserted, rollupState);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError || error instanceof Error && /protobuf|OTLP|record limit/i.test(error.message)) {
      return safeJsonError(400, "invalid_otlp_payload");
    }
    return safeJsonError(503, "telemetry_storage_failure");
  }
}
