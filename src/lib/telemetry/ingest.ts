import type { D1DatabaseLike } from "@/lib/telemetry/database";
import { deleteExpiredTelemetry, prepareTelemetryInsert, selectNewTelemetryEvents } from "@/lib/telemetry/database";
import { normalizeOtlpRecords, type NormalizedTelemetryEvent } from "@/lib/telemetry/normalize";
import { decodeOtlpJson, decodeOtlpProtobuf } from "@/lib/telemetry/otlp";
import {
  deleteExpiredRollups,
  isMissingRollupSchemaError,
  prepareTelemetryRollups,
  refreshStaleMaterializedSnapshots,
  SNAPSHOT_TTL_MS,
} from "@/lib/telemetry/rollups";

export const MAX_TELEMETRY_PAYLOAD_BYTES = 1_048_576;
export const TELEMETRY_MAINTENANCE_INTERVAL_MS = 60_000;
const INGEST_HEADER = "x-codex-telemetry-key";
const MAX_ATOMIC_EVENTS = 200;
const MAX_ATOMIC_STATEMENTS = 500;
const BUSY_DAY_EVENT_RATE = 35_000;
const BUSY_RETENTION_ROWS_PER_TABLE = 100;
const DAY_MS = 86_400_000;

interface MaintenanceResult {
  schemaUnavailable: boolean;
  snapshotRebuilds: number;
  cleanupDeletes: number;
  rowsWritten?: number;
}

interface MaintenanceState {
  lastCompletedAt?: number;
  lastAttemptAt?: number;
  lastCleanupAt?: number;
  inFlight?: Promise<MaintenanceResult>;
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

async function commitTelemetry(database: D1DatabaseLike, events: NormalizedTelemetryEvent[]) {
  const unique = [...new Map(events.map((event) => [`${event.occurredAt}:${event.id}`, event])).values()];
  const pending = unique.length ? await selectNewTelemetryEvents(database, unique) : [];
  let inserted = 0;
  let rollupUpserts = 0;
  let sessionSummaryUpserts = 0;
  let rowsWritten: number | undefined;

  // Every committed prefix contains both raw rows and matching aggregates.
  for (let offset = 0; offset < pending.length;) {
    let count = Math.min(MAX_ATOMIC_EVENTS, pending.length - offset);
    let group = pending.slice(offset, offset + count);
    let rollups = prepareTelemetryRollups(database, group);
    while (count + rollups.statements.length > MAX_ATOMIC_STATEMENTS) {
      count = Math.floor(count / 2);
      group = pending.slice(offset, offset + count);
      rollups = prepareTelemetryRollups(database, group);
    }
    const results = await database.batch([
      ...group.map((event) => prepareTelemetryInsert(database, event)),
      ...rollups.statements,
    ]);
    if (results.some((result) => !result.success)) throw new Error("Telemetry transaction failed.");
    inserted += results.slice(0, count).reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
    for (const result of results) rowsWritten = addRowsWritten(rowsWritten, result.meta?.rows_written);
    rollupUpserts += rollups.hourlyGroups + rollups.modelGroups + rollups.reasoningGroups;
    sessionSummaryUpserts += rollups.sessionGroups;
    offset += count;
  }
  return { inserted, rollupUpserts, sessionSummaryUpserts, rowsWritten };
}

async function retentionLimitForLoad(database: D1DatabaseLike, now: Date) {
  const dayStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const result = await database.prepare(`SELECT COALESCE(SUM(event_count), 0) AS events
    FROM codex_rollup_hourly WHERE hour_start>=? AND hour_start<=?`)
    .bind(new Date(dayStart).toISOString(), now.toISOString()).all<{ events: number }>();
  if (!result.success) throw new Error("Could not measure telemetry intake for retention.");
  const elapsed = Math.max(now.getTime() - dayStart, 3_600_000);
  const projectedEvents = (result.results?.[0]?.events ?? 0) * DAY_MS / elapsed;
  return projectedEvents >= BUSY_DAY_EVENT_RATE ? BUSY_RETENTION_ROWS_PER_TABLE : undefined;
}

async function runMaintenance(database: D1DatabaseLike, retentionDays: number, now: Date, intervalMs: number): Promise<MaintenanceResult> {
  const existing = maintenanceStates.get(database);
  const state = existing ?? {};
  maintenanceStates.set(database, state);
  if (state.inFlight) return state.inFlight;
  if (state.lastCompletedAt !== undefined && now.getTime() - state.lastCompletedAt < intervalMs) return emptyMaintenance();
  if (state.lastAttemptAt !== undefined && now.getTime() - state.lastAttemptAt < intervalMs) return emptyMaintenance();
  state.lastAttemptAt = now.getTime();

  const pending = (async () => {
    let schemaUnavailable = false;
    let cleanupDeletes = 0;
    let snapshotRebuilds = 0;
    let rowsWritten: number | undefined;
    let cleanupDue = false;
    const retentionCleanupIntervalElapsed = state.lastCleanupAt === undefined ||
      now.getTime() - state.lastCleanupAt >= SNAPSHOT_TTL_MS["30d"];
    try {
      const snapshots = await refreshStaleMaterializedSnapshots(database, now);
      snapshotRebuilds = snapshots.refreshed.length;
      rowsWritten = addRowsWritten(rowsWritten, snapshots.rowsWritten);
      // Only the isolate that wins a persisted 30-day snapshot refresh runs
      // normal cleanup. Full batches resume on that shared 15-minute cadence
      // instead of draining more batches on every minute-level ingest pass.
      cleanupDue = snapshots.refreshed.includes("30d");
      if (cleanupDue) {
        const rollupCleanup = await deleteExpiredRollups(database, now);
        cleanupDeletes += rollupCleanup.changes;
        rowsWritten = addRowsWritten(rowsWritten, rollupCleanup.rowsWritten);
      }
    } catch (error) {
      if (!isMissingRollupSchemaError(error)) throw error;
      schemaUnavailable = true;
      // Preserve raw-event retention when rollup tables have not been applied.
      cleanupDue = retentionCleanupIntervalElapsed;
    }
    if (cleanupDue) {
      state.lastCleanupAt = now.getTime();
      // Keep the retention cutoff and cadence, but leave write headroom for
      // incoming telemetry on busy days. Later cleanup can reclaim the rest.
      const retentionLimit = schemaUnavailable ? undefined : await retentionLimitForLoad(database, now)
        .catch(() => BUSY_RETENTION_ROWS_PER_TABLE);
      const rawCleanup = await deleteExpiredTelemetry(database, retentionDays, now, retentionLimit);
      cleanupDeletes += rawCleanup.changes;
      rowsWritten = addRowsWritten(rowsWritten, rawCleanup.rowsWritten);
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
    const insertion = await commitTelemetry(options.database, normalized);
    let d1RowsWritten = insertion.rowsWritten;

    // A retry still needs the duplicate lookup above, but it must not
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

    // A snapshot or cleanup failure cannot invalidate committed telemetry.
    const maintenance = await runMaintenance(options.database, options.retentionDays, now, Math.max(0, Math.floor(options.maintenanceIntervalMs ?? TELEMETRY_MAINTENANCE_INTERVAL_MS)))
      .catch(() => emptyMaintenance());
    d1RowsWritten = addRowsWritten(d1RowsWritten, maintenance.rowsWritten);
    return successResponse(contentType, {
      accepted: insertion.inserted,
      duplicateCount: normalized.length - insertion.inserted,
      rollups: maintenance.schemaUnavailable ? "schema-unavailable" : "updated",
      rollupUpserts: insertion.rollupUpserts,
      sessionSummaryUpserts: insertion.sessionSummaryUpserts,
      snapshotRebuilds: maintenance.snapshotRebuilds,
      cleanupDeletes: maintenance.cleanupDeletes,
      ...(d1RowsWritten === undefined ? {} : { d1RowsWritten }),
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError || error instanceof Error && /protobuf|OTLP|record limit/i.test(error.message)) {
      return safeJsonError(400, "invalid_otlp_payload");
    }
    return safeJsonError(503, "telemetry_storage_failure");
  }
}
