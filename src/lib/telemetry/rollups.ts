import type {
  CodexMeasuredValue,
  CodexTelemetryBreakdown,
  CodexTelemetrySessionSummary,
  CodexTelemetryTrendPoint,
} from "@/lib/providers/types";
import type { D1DatabaseLike, D1MutationResult, D1PreparedStatementLike, D1ResultLike } from "@/lib/telemetry/database";
import type { NormalizedTelemetryEvent } from "@/lib/telemetry/normalize";

export type TelemetryRange = "24h" | "7d" | "30d";
export const TELEMETRY_RANGES: readonly TelemetryRange[] = ["24h", "7d", "30d"];
export const SNAPSHOT_TTL_MS: Record<TelemetryRange, number> = {
  "24h": 60_000,
  "7d": 15 * 60_000,
  "30d": 15 * 60_000,
};

interface ScalarAggregate {
  eventCount: number;
  inputTokens: number;
  inputSamples: number;
  outputTokens: number;
  outputSamples: number;
  cachedTokens: number;
  cachedSamples: number;
  cacheWriteTokens: number;
  cacheWriteSamples: number;
  reasoningTokens: number;
  reasoningSamples: number;
  toolTokens: number;
  toolTokenSamples: number;
  errorCount: number;
  warningCount: number;
  completedTools: number;
  failedTools: number;
  approvals: number;
  ttftSumMs: number;
  ttftSampleCount: number;
  durationSumMs: number;
  durationSampleCount: number;
  lastReceivedAt?: string;
}

interface DimensionAggregate {
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  toolTokens: number;
  ttftSumMs: number;
  ttftSampleCount: number;
}

interface SessionAggregate extends ScalarAggregate {
  sessionId: string;
  projectName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  latestModel?: string;
  latestReasoningEffort?: string;
}

export interface CodexMaterializedSnapshot {
  schemaVersion: 1;
  range: TelemetryRange;
  generatedAt: string;
  sourceUpdatedAt?: string;
  summary: {
    events: number;
    sessions: number;
    inputTokens: CodexMeasuredValue;
    outputTokens: CodexMeasuredValue;
    cachedTokens: CodexMeasuredValue;
    cacheWriteTokens: CodexMeasuredValue;
    reasoningTokens: CodexMeasuredValue;
    toolTokens: CodexMeasuredValue;
    errors: number;
    warnings: number;
    completedTools: number;
    failedTools: number;
    approvals: number;
    averageTtftMs?: number;
    averageDurationMs?: number;
  };
  trend: CodexTelemetryTrendPoint[];
  models: CodexTelemetryBreakdown[];
  reasoningEfforts: CodexTelemetryBreakdown[];
  sessions: CodexTelemetrySessionSummary[];
}

export interface RollupWriteResult {
  hourlyGroups: number;
  modelGroups: number;
  reasoningGroups: number;
  sessionGroups: number;
  rowsWritten?: number;
}

const zeroScalar = (): ScalarAggregate => ({
  eventCount: 0,
  inputTokens: 0,
  inputSamples: 0,
  outputTokens: 0,
  outputSamples: 0,
  cachedTokens: 0,
  cachedSamples: 0,
  cacheWriteTokens: 0,
  cacheWriteSamples: 0,
  reasoningTokens: 0,
  reasoningSamples: 0,
  toolTokens: 0,
  toolTokenSamples: 0,
  errorCount: 0,
  warningCount: 0,
  completedTools: 0,
  failedTools: 0,
  approvals: 0,
  ttftSumMs: 0,
  ttftSampleCount: 0,
  durationSumMs: 0,
  durationSampleCount: 0,
});

const zeroDimension = (): DimensionAggregate => ({
  eventCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  toolTokens: 0,
  ttftSumMs: 0,
  ttftSampleCount: 0,
});

function hourStart(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Telemetry event time is invalid.");
  parsed.setUTCMinutes(0, 0, 0);
  return parsed.toISOString();
}

function addOptional(target: ScalarAggregate, total: keyof ScalarAggregate, samples: keyof ScalarAggregate, value?: number) {
  if (value === undefined) return;
  (target[total] as number) += value;
  (target[samples] as number) += 1;
}

function addDimension(target: DimensionAggregate, event: NormalizedTelemetryEvent) {
  target.eventCount += 1;
  target.inputTokens += event.inputTokens ?? 0;
  target.outputTokens += event.outputTokens ?? 0;
  target.cachedTokens += event.cachedInputTokens ?? 0;
  target.reasoningTokens += event.reasoningTokens ?? 0;
  target.toolTokens += event.toolTokens ?? 0;
  if (event.ttftMs !== undefined) {
    target.ttftSumMs += event.ttftMs;
    target.ttftSampleCount += 1;
  }
}

function addScalar(target: ScalarAggregate, event: NormalizedTelemetryEvent) {
  target.eventCount += 1;
  addOptional(target, "inputTokens", "inputSamples", event.inputTokens);
  addOptional(target, "outputTokens", "outputSamples", event.outputTokens);
  addOptional(target, "cachedTokens", "cachedSamples", event.cachedInputTokens);
  addOptional(target, "cacheWriteTokens", "cacheWriteSamples", event.cacheWriteTokens);
  addOptional(target, "reasoningTokens", "reasoningSamples", event.reasoningTokens);
  addOptional(target, "toolTokens", "toolTokenSamples", event.toolTokens);
  target.errorCount += event.category === "error" ? 1 : 0;
  target.warningCount += event.category === "warning" ? 1 : 0;
  target.completedTools += event.toolExecutionState === "succeeded" || event.toolExecutionState === "failed" ? 1 : 0;
  target.failedTools += event.toolExecutionState === "failed" ? 1 : 0;
  target.approvals += event.category === "approval" || event.category === "decision" ? 1 : 0;
  if (event.ttftMs !== undefined) {
    target.ttftSumMs += event.ttftMs;
    target.ttftSampleCount += 1;
  }
  if (event.durationMs !== undefined) {
    target.durationSumMs += event.durationMs;
    target.durationSampleCount += 1;
  }
  if (!target.lastReceivedAt || event.receivedAt > target.lastReceivedAt) target.lastReceivedAt = event.receivedAt;
}

export function groupTelemetryRollups(events: NormalizedTelemetryEvent[]) {
  const hourly = new Map<string, ScalarAggregate>();
  const models = new Map<string, DimensionAggregate>();
  const reasoning = new Map<string, DimensionAggregate>();
  const sessions = new Map<string, SessionAggregate>();

  for (const event of events) {
    const hour = hourStart(event.occurredAt);
    const hourGroup = hourly.get(hour) ?? zeroScalar();
    addScalar(hourGroup, event);
    hourly.set(hour, hourGroup);

    if (event.model) {
      const key = `${hour}\u0000${event.model}`;
      const group = models.get(key) ?? zeroDimension();
      addDimension(group, event);
      models.set(key, group);
    }
    if (event.reasoningEffort) {
      const key = `${hour}\u0000${event.reasoningEffort}`;
      const group = reasoning.get(key) ?? zeroDimension();
      addDimension(group, event);
      reasoning.set(key, group);
    }

    const sessionId = event.sessionId ?? event.threadId;
    if (sessionId) {
      const existing = sessions.get(sessionId);
      const group = existing ?? {
        ...zeroScalar(),
        sessionId,
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
      };
      addScalar(group, event);
      if (event.occurredAt < group.firstSeenAt) group.firstSeenAt = event.occurredAt;
      if (event.occurredAt >= group.lastSeenAt) {
        group.lastSeenAt = event.occurredAt;
        group.latestModel = event.model ?? group.latestModel;
        group.latestReasoningEffort = event.reasoningEffort ?? group.latestReasoningEffort;
        group.projectName = event.projectName ?? group.projectName;
      }
      sessions.set(sessionId, group);
    }
  }
  return { hourly, models, reasoning, sessions };
}

const hourlyUpsert = `INSERT INTO codex_rollup_hourly (
  hour_start,event_count,input_tokens,input_samples,output_tokens,output_samples,cached_tokens,cached_samples,
  cache_write_tokens,cache_write_samples,reasoning_tokens,reasoning_samples,tool_tokens,tool_token_samples,
  error_count,warning_count,completed_tools,failed_tools,approvals,ttft_sum_ms,ttft_sample_count,
  duration_sum_ms,duration_sample_count,last_received_at
) VALUES (${Array.from({ length: 24 }, () => "?").join(",")})
ON CONFLICT(hour_start) DO UPDATE SET
  event_count=event_count+excluded.event_count,input_tokens=input_tokens+excluded.input_tokens,input_samples=input_samples+excluded.input_samples,
  output_tokens=output_tokens+excluded.output_tokens,output_samples=output_samples+excluded.output_samples,
  cached_tokens=cached_tokens+excluded.cached_tokens,cached_samples=cached_samples+excluded.cached_samples,
  cache_write_tokens=cache_write_tokens+excluded.cache_write_tokens,cache_write_samples=cache_write_samples+excluded.cache_write_samples,
  reasoning_tokens=reasoning_tokens+excluded.reasoning_tokens,reasoning_samples=reasoning_samples+excluded.reasoning_samples,
  tool_tokens=tool_tokens+excluded.tool_tokens,tool_token_samples=tool_token_samples+excluded.tool_token_samples,
  error_count=error_count+excluded.error_count,warning_count=warning_count+excluded.warning_count,
  completed_tools=completed_tools+excluded.completed_tools,failed_tools=failed_tools+excluded.failed_tools,approvals=approvals+excluded.approvals,
  ttft_sum_ms=ttft_sum_ms+excluded.ttft_sum_ms,ttft_sample_count=ttft_sample_count+excluded.ttft_sample_count,
  duration_sum_ms=duration_sum_ms+excluded.duration_sum_ms,duration_sample_count=duration_sample_count+excluded.duration_sample_count,
  last_received_at=MAX(COALESCE(last_received_at,''),COALESCE(excluded.last_received_at,''))`;

const dimensionUpsert = (table: string, dimension: string) => `INSERT INTO ${table} (
  hour_start,${dimension},event_count,input_tokens,output_tokens,cached_tokens,reasoning_tokens,tool_tokens,ttft_sum_ms,ttft_sample_count
) VALUES (${Array.from({ length: 10 }, () => "?").join(",")})
ON CONFLICT(hour_start,${dimension}) DO UPDATE SET
  event_count=event_count+excluded.event_count,input_tokens=input_tokens+excluded.input_tokens,
  output_tokens=output_tokens+excluded.output_tokens,cached_tokens=cached_tokens+excluded.cached_tokens,
  reasoning_tokens=reasoning_tokens+excluded.reasoning_tokens,tool_tokens=tool_tokens+excluded.tool_tokens,
  ttft_sum_ms=ttft_sum_ms+excluded.ttft_sum_ms,ttft_sample_count=ttft_sample_count+excluded.ttft_sample_count`;

const sessionUpsert = `INSERT INTO codex_session_summary (
  session_id,project_name,first_seen_at,last_seen_at,latest_model,latest_reasoning_effort,event_count,
  input_tokens,output_tokens,cached_tokens,cache_write_tokens,reasoning_tokens,tool_tokens,completed_tools,
  failed_tools,error_count,warning_count,approvals,ttft_sum_ms,ttft_sample_count
) VALUES (${Array.from({ length: 20 }, () => "?").join(",")})
ON CONFLICT(session_id) DO UPDATE SET
  project_name=CASE WHEN excluded.last_seen_at>=last_seen_at THEN COALESCE(excluded.project_name,project_name) ELSE project_name END,
  first_seen_at=MIN(first_seen_at,excluded.first_seen_at),
  latest_model=CASE WHEN excluded.last_seen_at>=last_seen_at THEN COALESCE(excluded.latest_model,latest_model) ELSE latest_model END,
  latest_reasoning_effort=CASE WHEN excluded.last_seen_at>=last_seen_at THEN COALESCE(excluded.latest_reasoning_effort,latest_reasoning_effort) ELSE latest_reasoning_effort END,
  last_seen_at=MAX(last_seen_at,excluded.last_seen_at),event_count=event_count+excluded.event_count,
  input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,
  cached_tokens=cached_tokens+excluded.cached_tokens,cache_write_tokens=cache_write_tokens+excluded.cache_write_tokens,
  reasoning_tokens=reasoning_tokens+excluded.reasoning_tokens,tool_tokens=tool_tokens+excluded.tool_tokens,
  completed_tools=completed_tools+excluded.completed_tools,failed_tools=failed_tools+excluded.failed_tools,
  error_count=error_count+excluded.error_count,warning_count=warning_count+excluded.warning_count,
  approvals=approvals+excluded.approvals,ttft_sum_ms=ttft_sum_ms+excluded.ttft_sum_ms,
  ttft_sample_count=ttft_sample_count+excluded.ttft_sample_count`;

function dimensionValues(key: string, value: DimensionAggregate) {
  const [hour, dimension] = key.split("\u0000");
  return [hour, dimension, value.eventCount, value.inputTokens, value.outputTokens, value.cachedTokens,
    value.reasoningTokens, value.toolTokens, value.ttftSumMs, value.ttftSampleCount];
}

export async function applyTelemetryRollups(database: D1DatabaseLike, events: NormalizedTelemetryEvent[]): Promise<RollupWriteResult> {
  if (!events.length) return { hourlyGroups: 0, modelGroups: 0, reasoningGroups: 0, sessionGroups: 0 };
  const grouped = groupTelemetryRollups(events);
  const statements: D1PreparedStatementLike[] = [];
  let rowsWritten = 0;
  let rowsWrittenObserved = false;
  for (const [hour, value] of grouped.hourly) {
    statements.push(database.prepare(hourlyUpsert).bind(hour, value.eventCount, value.inputTokens, value.inputSamples,
      value.outputTokens, value.outputSamples, value.cachedTokens, value.cachedSamples, value.cacheWriteTokens,
      value.cacheWriteSamples, value.reasoningTokens, value.reasoningSamples, value.toolTokens, value.toolTokenSamples,
      value.errorCount, value.warningCount, value.completedTools, value.failedTools, value.approvals, value.ttftSumMs,
      value.ttftSampleCount, value.durationSumMs, value.durationSampleCount, value.lastReceivedAt ?? null));
  }
  for (const [key, value] of grouped.models) statements.push(database.prepare(dimensionUpsert("codex_rollup_model_hourly", "model")).bind(...dimensionValues(key, value)));
  for (const [key, value] of grouped.reasoning) statements.push(database.prepare(dimensionUpsert("codex_rollup_reasoning_hourly", "reasoning_effort")).bind(...dimensionValues(key, value)));
  for (const value of grouped.sessions.values()) {
    statements.push(database.prepare(sessionUpsert).bind(value.sessionId, value.projectName ?? null, value.firstSeenAt,
      value.lastSeenAt, value.latestModel ?? null, value.latestReasoningEffort ?? null, value.eventCount,
      value.inputTokens, value.outputTokens, value.cachedTokens, value.cacheWriteTokens, value.reasoningTokens,
      value.toolTokens, value.completedTools, value.failedTools, value.errorCount, value.warningCount, value.approvals,
      value.ttftSumMs, value.ttftSampleCount));
  }
  for (let offset = 0; offset < statements.length; offset += 50) {
    const results = await database.batch(statements.slice(offset, offset + 50));
    if (results.some((result) => !result.success)) throw new Error("Telemetry rollup batch failed.");
    if (results.some((result) => typeof result.meta?.rows_written === "number")) {
      rowsWrittenObserved = true;
      rowsWritten += results.reduce((total, result) => total + (result.meta?.rows_written ?? 0), 0);
    }
  }
  return {
    hourlyGroups: grouped.hourly.size,
    modelGroups: grouped.models.size,
    reasoningGroups: grouped.reasoning.size,
    sessionGroups: grouped.sessions.size,
    ...(rowsWrittenObserved ? { rowsWritten } : {}),
  };
}

interface HourlyRow {
  label: string;
  event_count: number;
  input_tokens: number;
  input_samples: number;
  output_tokens: number;
  output_samples: number;
  cached_tokens: number;
  cached_samples: number;
  cache_write_tokens: number;
  cache_write_samples: number;
  reasoning_tokens: number;
  reasoning_samples: number;
  tool_tokens: number;
  tool_token_samples: number;
  error_count: number;
  warning_count: number;
  completed_tools: number;
  failed_tools: number;
  approvals: number;
  ttft_sum_ms: number;
  ttft_sample_count: number;
  duration_sum_ms: number;
  duration_sample_count: number;
  last_received_at: string | null;
}

interface CountRow { label: string; count: number }
interface SnapshotRow { range: TelemetryRange; generated_at: string; payload_json: string }
interface SessionRow {
  session_id: string; project_name: string | null; first_seen_at: string; last_seen_at: string;
  latest_model: string | null; latest_reasoning_effort: string | null; event_count: number;
  input_tokens: number; output_tokens: number; cached_tokens: number; cache_write_tokens: number;
  reasoning_tokens: number; tool_tokens: number; completed_tools: number; failed_tools: number;
  error_count: number; warning_count: number; approvals: number; ttft_sum_ms: number; ttft_sample_count: number;
  range_session_count: number;
}

function resultRows<T>(result: D1ResultLike<T>) {
  if (!result.success) throw new Error("Telemetry rollup query failed.");
  return result.results ?? [];
}

function cutoffFor(range: TelemetryRange, now: Date) {
  const hours = range === "24h" ? 24 : range === "7d" ? 7 * 24 : 30 * 24;
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

function measured(total: number, samples: number, observed: boolean): CodexMeasuredValue {
  if (!observed) return { availability: "unavailable", sampleCount: 0 };
  if (!samples) return { availability: "no-samples", sampleCount: 0 };
  return { availability: "available", value: total, sampleCount: samples };
}

function sum(rows: HourlyRow[], key: keyof HourlyRow) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function parseSnapshot(row: SnapshotRow): CodexMaterializedSnapshot | undefined {
  try {
    const value = JSON.parse(row.payload_json) as CodexMaterializedSnapshot;
    return value?.schemaVersion === 1 && value.range === row.range ? value : undefined;
  } catch {
    return undefined;
  }
}

const hourlyQuery = (range: TelemetryRange) => `SELECT ${range === "24h" ? "hour_start" : "substr(hour_start,1,10)"} AS label,
  SUM(event_count) AS event_count,SUM(input_tokens) AS input_tokens,SUM(input_samples) AS input_samples,
  SUM(output_tokens) AS output_tokens,SUM(output_samples) AS output_samples,SUM(cached_tokens) AS cached_tokens,
  SUM(cached_samples) AS cached_samples,SUM(cache_write_tokens) AS cache_write_tokens,
  SUM(cache_write_samples) AS cache_write_samples,SUM(reasoning_tokens) AS reasoning_tokens,
  SUM(reasoning_samples) AS reasoning_samples,SUM(tool_tokens) AS tool_tokens,SUM(tool_token_samples) AS tool_token_samples,
  SUM(error_count) AS error_count,SUM(warning_count) AS warning_count,SUM(completed_tools) AS completed_tools,
  SUM(failed_tools) AS failed_tools,SUM(approvals) AS approvals,SUM(ttft_sum_ms) AS ttft_sum_ms,
  SUM(ttft_sample_count) AS ttft_sample_count,SUM(duration_sum_ms) AS duration_sum_ms,
  SUM(duration_sample_count) AS duration_sample_count,MAX(last_received_at) AS last_received_at
  FROM codex_rollup_hourly WHERE hour_start>=? GROUP BY label ORDER BY label LIMIT 744`;

export async function buildMaterializedSnapshot(database: D1DatabaseLike, range: TelemetryRange, now: Date): Promise<CodexMaterializedSnapshot> {
  const cutoff = cutoffFor(range, now);
  const results = await database.batch([
    database.prepare(hourlyQuery(range)).bind(cutoff),
    database.prepare("SELECT model AS label,SUM(event_count) AS count FROM codex_rollup_model_hourly WHERE hour_start>=? GROUP BY model ORDER BY count DESC LIMIT 8").bind(cutoff),
    database.prepare("SELECT reasoning_effort AS label,SUM(event_count) AS count FROM codex_rollup_reasoning_hourly WHERE hour_start>=? GROUP BY reasoning_effort ORDER BY count DESC LIMIT 8").bind(cutoff),
    database.prepare("SELECT *,COUNT(*) OVER() AS range_session_count FROM codex_session_summary WHERE last_seen_at>=? ORDER BY last_seen_at DESC LIMIT 20").bind(cutoff),
  ]);
  if (results.length !== 4) throw new Error("Telemetry snapshot batch returned an unexpected result count.");
  const hourly = resultRows(results[0] as unknown as D1ResultLike<HourlyRow>);
  const modelRows = resultRows(results[1] as unknown as D1ResultLike<CountRow>);
  const reasoningRows = resultRows(results[2] as unknown as D1ResultLike<CountRow>);
  const sessionRows = resultRows(results[3] as unknown as D1ResultLike<SessionRow>);
  const observed = hourly.length > 0;
  const sourceUpdatedAt = hourly.reduce<string | undefined>((latest, row) => !row.last_received_at || latest && latest >= row.last_received_at ? latest : row.last_received_at, undefined);
  const snapshot: CodexMaterializedSnapshot = {
    schemaVersion: 1,
    range,
    generatedAt: now.toISOString(),
    sourceUpdatedAt,
    summary: {
      events: sum(hourly, "event_count"),
      sessions: Number(sessionRows[0]?.range_session_count ?? 0),
      inputTokens: measured(sum(hourly, "input_tokens"), sum(hourly, "input_samples"), observed),
      outputTokens: measured(sum(hourly, "output_tokens"), sum(hourly, "output_samples"), observed),
      cachedTokens: measured(sum(hourly, "cached_tokens"), sum(hourly, "cached_samples"), observed),
      cacheWriteTokens: measured(sum(hourly, "cache_write_tokens"), sum(hourly, "cache_write_samples"), observed),
      reasoningTokens: measured(sum(hourly, "reasoning_tokens"), sum(hourly, "reasoning_samples"), observed),
      toolTokens: measured(sum(hourly, "tool_tokens"), sum(hourly, "tool_token_samples"), observed),
      errors: sum(hourly, "error_count"), warnings: sum(hourly, "warning_count"),
      completedTools: sum(hourly, "completed_tools"), failedTools: sum(hourly, "failed_tools"), approvals: sum(hourly, "approvals"),
      averageTtftMs: sum(hourly, "ttft_sample_count") ? sum(hourly, "ttft_sum_ms") / sum(hourly, "ttft_sample_count") : undefined,
      averageDurationMs: sum(hourly, "duration_sample_count") ? sum(hourly, "duration_sum_ms") / sum(hourly, "duration_sample_count") : undefined,
    },
    trend: hourly.map((row) => ({ label: row.label, events: Number(row.event_count), errors: Number(row.error_count),
      toolExecutions: Number(row.completed_tools), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
      cachedTokens: Number(row.cached_tokens), cacheWriteTokens: Number(row.cache_write_tokens), reasoningTokens: Number(row.reasoning_tokens), toolTokens: Number(row.tool_tokens) })),
    models: modelRows.map((row) => ({ label: row.label, count: Number(row.count) })),
    reasoningEfforts: reasoningRows.map((row) => ({ label: row.label, count: Number(row.count) })),
    sessions: sessionRows.map((row) => ({ sessionId: row.session_id, projectName: row.project_name ?? undefined,
      models: row.latest_model ? [row.latest_model] : [], reasoningEfforts: row.latest_reasoning_effort ? [row.latest_reasoning_effort] : [],
      eventCount: Number(row.event_count), errorCount: Number(row.error_count), warningCount: Number(row.warning_count),
      toolExecutions: Number(row.completed_tools), failedTools: Number(row.failed_tools), toolRelatedEvents: Number(row.completed_tools), usageEvents: Number(row.event_count),
      approvalEvents: Number(row.approvals), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
      cachedTokens: Number(row.cached_tokens), cacheWriteTokens: Number(row.cache_write_tokens), reasoningTokens: Number(row.reasoning_tokens),
      toolTokens: Number(row.tool_tokens), averageTtftMs: Number(row.ttft_sample_count) ? Number(row.ttft_sum_ms) / Number(row.ttft_sample_count) : undefined,
      firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at })),
  };
  return snapshot;
}

export async function writeMaterializedSnapshot(database: D1DatabaseLike, snapshot: CodexMaterializedSnapshot): Promise<D1MutationResult> {
  const payload = JSON.stringify(snapshot);
  if (payload.length > 262_144) throw new Error("Telemetry snapshot exceeded its privacy-safe size bound.");
  const result = await database.prepare(`INSERT INTO codex_dashboard_snapshot (range,generated_at,source_updated_at,payload_json)
    VALUES (?,?,?,?) ON CONFLICT(range) DO UPDATE SET generated_at=excluded.generated_at,
    source_updated_at=excluded.source_updated_at,payload_json=excluded.payload_json`)
    .bind(snapshot.range, snapshot.generatedAt, snapshot.sourceUpdatedAt ?? null, payload).run();
  if (!result.success) throw new Error("Telemetry snapshot write failed.");
  return {
    changes: result.meta?.changes ?? 0,
    ...(typeof result.meta?.rows_written === "number" ? { rowsWritten: result.meta.rows_written } : {}),
  };
}

export async function refreshStaleMaterializedSnapshots(database: D1DatabaseLike, now: Date) {
  const state = await database.prepare("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot WHERE range IN ('24h','7d','30d')").all<SnapshotRow>();
  const existing = new Map(resultRows(state).map((row) => [row.range, row]));
  const refreshed: TelemetryRange[] = [];
  let rowsWritten = 0;
  let rowsWrittenObserved = false;
  for (const range of TELEMETRY_RANGES) {
    const row = existing.get(range);
    const generated = row ? Date.parse(row.generated_at) : Number.NaN;
    if (Number.isFinite(generated) && now.getTime() - generated < SNAPSHOT_TTL_MS[range]) continue;
    const written = await writeMaterializedSnapshot(database, await buildMaterializedSnapshot(database, range, now));
    if (written.rowsWritten !== undefined) {
      rowsWrittenObserved = true;
      rowsWritten += written.rowsWritten;
    }
    refreshed.push(range);
  }
  return { refreshed, ...(rowsWrittenObserved ? { rowsWritten } : {}) };
}

export async function readMaterializedSnapshots(database: D1DatabaseLike) {
  const result = await database.prepare("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot WHERE range IN ('24h','7d','30d')").all<SnapshotRow>();
  return resultRows(result).map(parseSnapshot).filter((value): value is CodexMaterializedSnapshot => Boolean(value));
}

export async function readMaterializedSnapshot(database: D1DatabaseLike, range: TelemetryRange) {
  const result = await database.prepare("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot WHERE range=? LIMIT 1").bind(range).all<SnapshotRow>();
  const row = resultRows(result)[0];
  return row ? parseSnapshot(row) : undefined;
}

export async function deleteExpiredRollups(database: D1DatabaseLike, now: Date): Promise<D1MutationResult> {
  const cutoff = new Date(now.getTime() - 31 * 86_400_000).toISOString();
  const results = await database.batch([
    database.prepare("DELETE FROM codex_rollup_hourly WHERE hour_start<?").bind(cutoff),
    database.prepare("DELETE FROM codex_rollup_model_hourly WHERE hour_start<?").bind(cutoff),
    database.prepare("DELETE FROM codex_rollup_reasoning_hourly WHERE hour_start<?").bind(cutoff),
    database.prepare("DELETE FROM codex_session_summary WHERE last_seen_at<?").bind(cutoff),
  ]);
  if (results.some((result) => !result.success)) throw new Error("Telemetry rollup retention cleanup failed.");
  const rowsWritten = results.some((result) => typeof result.meta?.rows_written === "number")
    ? results.reduce((total, result) => total + (result.meta?.rows_written ?? 0), 0)
    : undefined;
  return {
    changes: results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0),
    ...(rowsWritten === undefined ? {} : { rowsWritten }),
  };
}

export function isMissingRollupSchemaError(error: unknown) {
  return error instanceof Error && /no such table|codex_(?:rollup|dashboard_snapshot|session_summary)/i.test(error.message);
}
