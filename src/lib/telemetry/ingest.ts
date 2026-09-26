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
export const TELEMETRY_MAINTENANCE_INTERVAL_MS = 60_000;
const INGEST_HEADER = "x-codex-telemetry-key";

interface MaintenanceResult {
  schemaUnavailable: boolean;
  snapshotRebuilds: number;
  cleanupDeletes: number;
  rowsWritten?: number;
}

interface MaintenanceState {
  lastCompletedAt?: number;
  inFlight?: Promise<MaintenanceResult>;
  cleanupBacklog?: boolean;
}

const maintenanceStates = new WeakMap<object, MaintenanceState>();

export interface TelemetryIngestOptions {
  database?: D1DatabaseLike;
  ingestKey?: string;
  retentionDays: number;
  now?: () => Date;
  maintenanceIntervalMs?: number;
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

function successResponse(contentType: string, diagnostics: {
  accepted: number;
  duplicateCount: number;
  rollups: "updated" | "schema-unavailable" | "skipped-no-new-events";
  rollupUpserts: number;
  sessionSummaryUpserts: number;
  snapshotRebuilds: number;
  cleanupDeletes: number;
  d1RowsWritten?: number;
}) {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-codex-telemetry-accepted": String(diagnostics.accepted),
    "x-codex-telemetry-duplicates": String(diagnostics.duplicateCount),
    "x-codex-telemetry-rollups": diagnostics.rollups,
    "x-codex-telemetry-rollup-upserts": String(diagnostics.rollupUpserts),
    "x-codex-telemetry-session-upserts": String(diagnostics.sessionSummaryUpserts),
    "x-codex-telemetry-snapshot-rebuilds": String(diagnostics.snapshotRebuilds),
    "x-codex-telemetry-cleanup-deletes": String(diagnostics.cleanupDeletes),
    "x-codex-telemetry-ingest-requests": "1",
    "x-content-type-options": "nosniff",
  };
  if (diagnostics.d1RowsWritten !== undefined) headers["x-codex-telemetry-d1-rows-written"] = String(diagnostics.d1RowsWritten);
  if (contentType === "application/json") {
    return Response.json({ partialSuccess: {} }, { status: 200, headers });
  }
  return new Response(new Uint8Array(), { status: 200, headers: { ...headers, "content-type": "application/x-protobuf" } });
}

function emptyMaintenance(): MaintenanceResult {
  return { schemaUnavailable: false, snapshotRebuilds: 0, cleanupDeletes: 0 };
}

function addRowsWritten(total: number | undefined, next: number | undefined) {
  return total === undefined && next === undefined ? undefined : (total ?? 0) + (next ?? 0);
}

async function runMaintenance(database: D1DatabaseLike, retentionDays: number, now: Date, intervalMs: number): Promise<MaintenanceResult> {
  const existing = maintenanceStates.get(database);
  const state = existing ?? {};
  maintenanceStates.set(database, state);
  if (state.inFlight) return state.inFlight;
  if (state.lastCompletedAt !== undefined && now.getTime() - state.lastCompletedAt < intervalMs) return emptyMaintenance();

  const pending = (async () => {
    let schemaUnavailable = false;
    let cleanupDeletes = 0;
    let snapshotRebuilds = 0;
    let rowsWritten: number | undefined;
    let cleanupDue = false;
    try {
      const snapshots = await refreshStaleMaterializedSnapshots(database, now);
      snapshotRebuilds = snapshots.refreshed.length;
      rowsWritten = addRowsWritten(rowsWritten, snapshots.rowsWritten);
      // The persisted 30-day snapshot timestamp gates normal cleanup across
      // Worker instances without slowing the one-minute 24-hour snapshot.
      // If a bounded raw delete fills a batch, keep draining on subsequent
      // maintenance passes in this instance rather than waiting 15 minutes.
      cleanupDue = snapshots.refreshed.includes("30d") || state.cleanupBacklog === true;
      if (cleanupDue) {
        const rollupCleanup = await deleteExpiredRollups(database, now);
        cleanupDeletes += rollupCleanup.changes;
        rowsWritten = addRowsWritten(rowsWritten, rollupCleanup.rowsWritten);
      }
    } catch (error) {
      if (!isMissingRollupSchemaError(error)) throw error;
      schemaUnavailable = true;
      // Preserve raw-event retention when rollup tables have not been applied.
      cleanupDue = true;
    }
    if (cleanupDue) {
      const rawCleanup = await deleteExpiredTelemetry(database, retentionDays, now);
      cleanupDeletes += rawCleanup.changes;
      rowsWritten = addRowsWritten(rowsWritten, rawCleanup.rowsWritten);
      state.cleanupBacklog = rawCleanup.backlogMayRemain;
    }
    const result: MaintenanceResult = { schemaUnavailable, snapshotRebuilds, cleanupDeletes, ...(rowsWritten === undefined ? {} : { rowsWritten }) };
    state.lastCompletedAt = now.getTime();
    return result;
  })();
  state.inFlight = pending;
  try {
    return await pending;
  } finally {
    state.inFlight = undefined;
  }
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
    const normalized = await normalizeOtlpRecords(records, now.toISOString(), { replay: request.headers.get("x-codex-telemetry-replay") === "1" });
    const insertion = await insertTelemetryEventsDetailed(options.database, normalized);
    let d1RowsWritten = insertion.rowsWritten;

    // A retry still needs the duplicate-aware insert above, but it must not
    // reopen the maintenance path. This keeps exporter retries from paying
    // for cleanup queries or snapshot rewrites when no new evidence arrived.
    if (insertion.inserted === 0) {
      return successResponse(contentType, {
        accepted: 0,
        duplicateCount: normalized.length,
        rollups: "skipped-no-new-events",
        rollupUpserts: 0,
        sessionSummaryUpserts: 0,
        snapshotRebuilds: 0,
        cleanupDeletes: 0,
        ...(d1RowsWritten === undefined ? {} : { d1RowsWritten }),
      });
    }

    let rollupState: "updated" | "schema-unavailable" = "updated";
    let rollupUpserts = 0;
    let sessionSummaryUpserts = 0;
    let snapshotRebuilds = 0;
    let cleanupDeletes = 0;
    try {
      const rollups = await applyTelemetryRollups(options.database, insertion.insertedEvents);
      rollupUpserts = rollups.hourlyGroups + rollups.modelGroups + rollups.reasoningGroups;
      sessionSummaryUpserts = rollups.sessionGroups;
      d1RowsWritten = addRowsWritten(d1RowsWritten, rollups.rowsWritten);
    } catch (error) {
      if (!isMissingRollupSchemaError(error)) throw error;
      rollupState = "schema-unavailable";
    }
    const maintenance = await runMaintenance(options.database, options.retentionDays, now, Math.max(0, Math.floor(options.maintenanceIntervalMs ?? TELEMETRY_MAINTENANCE_INTERVAL_MS)));
    if (maintenance.schemaUnavailable) rollupState = "schema-unavailable";
    snapshotRebuilds = maintenance.snapshotRebuilds;
    cleanupDeletes = maintenance.cleanupDeletes;
    d1RowsWritten = addRowsWritten(d1RowsWritten, maintenance.rowsWritten);
    return successResponse(contentType, {
      accepted: insertion.inserted,
      duplicateCount: normalized.length - insertion.inserted,
      rollups: rollupState,
      rollupUpserts,
      sessionSummaryUpserts,
      snapshotRebuilds,
      cleanupDeletes,
      ...(d1RowsWritten === undefined ? {} : { d1RowsWritten }),
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError || error instanceof Error && /protobuf|OTLP|record limit/i.test(error.message)) {
      return safeJsonError(400, "invalid_otlp_payload");
    }
    return safeJsonError(503, "telemetry_storage_failure");
  }
}
