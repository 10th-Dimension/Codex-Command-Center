import type { CodexActivityRecord, CodexTelemetryBreakdown, CodexTelemetryProjectSummary, CodexTelemetrySessionSummary, CodexTelemetryTimingBreakdown, CodexTelemetryToolSummary, CodexTelemetryTrendPoint, CodexUsageSnapshot } from "@/lib/providers/types";
import type { NormalizedTelemetryEvent } from "@/lib/telemetry/normalize";

export interface D1ResultLike<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
  error?: string;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO codex_telemetry_events (
    id, event_fingerprint, occurred_at, received_at, event_name, event_category, environment,
    severity_text, severity_number, session_id, thread_id, task_id, project_id, project_name,
    repository_id, workspace_id, model, tool_name, tool_type, tool_status, decision,
    approval_decision, mcp_server, mcp_tool, network_host, network_decision, success,
    status, error_type, duration_ms, input_tokens,
    output_tokens, cached_input_tokens, reasoning_output_tokens,
    safe_attribute_keys_json, unknown_attribute_keys_json, redacted_attribute_count, source, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function nullable(value: string | number | undefined) {
  return value ?? null;
}

export async function insertTelemetryEvents(database: D1DatabaseLike, events: NormalizedTelemetryEvent[]) {
  let inserted = 0;
  for (let offset = 0; offset < events.length; offset += 50) {
    const statements = events.slice(offset, offset + 50).map((event) => database.prepare(INSERT_SQL).bind(
      event.id,
      event.fingerprint,
      event.occurredAt,
      event.receivedAt,
      event.eventName,
      event.category,
      nullable(event.environment),
      nullable(event.severityText),
      nullable(event.severityNumber),
      nullable(event.sessionId),
      nullable(event.threadId),
      nullable(event.taskId),
      nullable(event.projectId),
      nullable(event.projectName),
      nullable(event.repositoryId),
      nullable(event.workspaceId),
      nullable(event.model),
      nullable(event.toolName),
      nullable(event.toolType),
      nullable(event.toolStatus),
      nullable(event.decision),
      nullable(event.approvalDecision),
      nullable(event.mcpServer),
      nullable(event.mcpTool),
      nullable(event.networkHost),
      nullable(event.networkDecision),
      event.success === undefined ? null : event.success ? 1 : 0,
      nullable(event.status),
      nullable(event.errorType),
      nullable(event.durationMs),
      nullable(event.inputTokens),
      nullable(event.outputTokens),
      nullable(event.cachedInputTokens),
      nullable(event.reasoningOutputTokens),
      JSON.stringify(event.safeAttributeKeys),
      JSON.stringify(event.unknownAttributeKeys),
      event.redactedAttributeCount,
      event.source,
      event.schemaVersion,
    ));
    const results = await database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Telemetry storage batch failed.");
    inserted += results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);
  }
  return inserted;
}

export async function deleteExpiredTelemetry(database: D1DatabaseLike, retentionDays: number, now: Date) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result = await database.prepare("DELETE FROM codex_telemetry_events WHERE occurred_at < ?").bind(cutoff).run();
  if (!result.success) throw new Error("Telemetry retention cleanup failed.");
  return result.meta?.changes ?? 0;
}

interface EventRow {
  id: string;
  event_name: string;
  event_category: CodexActivityRecord["category"];
  environment: string | null;
  occurred_at: string;
  received_at: string;
  severity_text: string | null;
  session_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  project_id: string | null;
  project_name: string | null;
  repository_id: string | null;
  workspace_id: string | null;
  model: string | null;
  tool_name: string | null;
  tool_type: string | null;
  tool_status: string | null;
  decision: string | null;
  approval_decision: string | null;
  mcp_server: string | null;
  mcp_tool: string | null;
  network_host: string | null;
  network_decision: string | null;
  success: number | null;
  status: string | null;
  error_type: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_output_tokens: number | null;
  safe_attribute_keys_json: string;
  unknown_attribute_keys_json: string;
  source: "openai-codex-otel";
  schema_version: 1;
}

interface CountRow { label: string; count: number }
interface TimingRow { label: string; sample_count: number; average_ms: number; maximum_ms: number }
interface ToolRow { label: string; count: number; failure_count: number; average_duration_ms: number | null; last_seen_at: string }
interface DailyRow { day: string; events: number; errors: number; tool_executions: number }
interface UsageRow { window: "7d" | "30d"; input_tokens: number; output_tokens: number; cached_input_tokens: number; reasoning_output_tokens: number; events_with_usage: number }
interface SessionRow { session_id: string; project_name: string | null; model: string | null; event_count: number; error_count: number; tool_executions: number; first_seen_at: string; last_seen_at: string }
interface ProjectRow { project_id: string; project_name: string | null; event_count: number; session_count: number; last_seen_at: string }
interface MetaRow { event_count: number; last_received_at: string | null; oldest_event_at: string | null; newest_event_at: string | null; today_event_count: number; observed_session_count_24h: number; failed_tool_count_30d: number }

function rows<T>(result: D1ResultLike<T>) {
  if (!result.success) throw new Error("Telemetry query failed.");
  return result.results ?? [];
}

function parseKeys(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 64) : [];
  } catch {
    return [];
  }
}

function eventRecord(row: EventRow): CodexActivityRecord {
  return {
    id: row.id,
    eventName: row.event_name,
    category: row.event_category,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    severity: row.severity_text ?? undefined,
    sessionId: row.session_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    taskId: row.task_id ?? undefined,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    repositoryId: row.repository_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    environment: row.environment ?? undefined,
    model: row.model ?? undefined,
    toolName: row.tool_name ?? undefined,
    toolType: row.tool_type ?? undefined,
    toolStatus: row.tool_status ?? undefined,
    decision: row.decision ?? undefined,
    approvalDecision: row.approval_decision ?? undefined,
    mcpServer: row.mcp_server ?? undefined,
    mcpTool: row.mcp_tool ?? undefined,
    networkHost: row.network_host ?? undefined,
    networkDecision: row.network_decision ?? undefined,
    success: row.success === null ? undefined : row.success === 1,
    errorType: row.error_type ?? undefined,
    status: row.status ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    cachedInputTokens: row.cached_input_tokens ?? undefined,
    reasoningOutputTokens: row.reasoning_output_tokens ?? undefined,
    safeAttributeKeys: parseKeys(row.safe_attribute_keys_json),
    unknownAttributeKeys: parseKeys(row.unknown_attribute_keys_json),
    source: row.source,
    schemaVersion: row.schema_version,
  };
}

export interface TelemetryDatabaseSnapshot {
  activity: CodexActivityRecord[];
  sevenDayTrend: CodexTelemetryTrendPoint[];
  thirtyDayTrend: CodexTelemetryTrendPoint[];
  twentyFourHourTrend: CodexTelemetryTrendPoint[];
  usage: CodexUsageSnapshot[];
  categories: CodexTelemetryBreakdown[];
  models: CodexTelemetryBreakdown[];
  tools: CodexTelemetryToolSummary[];
  timings: CodexTelemetryTimingBreakdown[];
  approvals: CodexTelemetryBreakdown[];
  mcpServers: CodexTelemetryBreakdown[];
  mcpTools: CodexTelemetryBreakdown[];
  networkDecisions: CodexTelemetryBreakdown[];
  networkHosts: CodexTelemetryBreakdown[];
  sessions: CodexTelemetrySessionSummary[];
  projects: CodexTelemetryProjectSummary[];
  recentErrors: CodexActivityRecord[];
  eventCount: number;
  lastReceivedAt?: string;
  oldestEventAt?: string;
  newestEventAt?: string;
  todayEventCount: number;
  observedSessionCount24h: number;
  failedToolCount30d: number;
}

export async function readTelemetrySnapshot(database: D1DatabaseLike, now: Date): Promise<TelemetryDatabaseSnapshot> {
  const thirtyDayCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const sevenDayCutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const twentyFourHourCutoff = new Date(now.getTime() - 86_400_000).toISOString();
  const todayCutoff = now.toISOString().slice(0, 10) + "T00:00:00.000Z";
  const statements = [
    database.prepare("SELECT * FROM codex_telemetry_events WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT 100").bind(thirtyDayCutoff),
    database.prepare("SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS events, SUM(CASE WHEN event_category = 'error' THEN 1 ELSE 0 END) AS errors, SUM(CASE WHEN event_category = 'tool' THEN 1 ELSE 0 END) AS tool_executions FROM codex_telemetry_events WHERE occurred_at >= ? GROUP BY day ORDER BY day").bind(thirtyDayCutoff),
    database.prepare("SELECT substr(occurred_at, 1, 13) || ':00:00.000Z' AS day, COUNT(*) AS events, SUM(CASE WHEN event_category = 'error' THEN 1 ELSE 0 END) AS errors, SUM(CASE WHEN event_category = 'tool' THEN 1 ELSE 0 END) AS tool_executions FROM codex_telemetry_events WHERE occurred_at >= ? GROUP BY day ORDER BY day").bind(twentyFourHourCutoff),
    database.prepare("SELECT event_category AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? GROUP BY event_category ORDER BY count DESC").bind(thirtyDayCutoff),
    database.prepare("SELECT model AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND model IS NOT NULL GROUP BY model ORDER BY count DESC LIMIT 20").bind(thirtyDayCutoff),
    database.prepare("SELECT tool_name AS label, COUNT(*) AS count, SUM(CASE WHEN success = 0 OR tool_status IN ('failed', 'failure', 'error') THEN 1 ELSE 0 END) AS failure_count, AVG(duration_ms) AS average_duration_ms, MAX(occurred_at) AS last_seen_at FROM codex_telemetry_events WHERE occurred_at >= ? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC LIMIT 20").bind(thirtyDayCutoff),
    database.prepare("SELECT event_category AS label, COUNT(duration_ms) AS sample_count, AVG(duration_ms) AS average_ms, MAX(duration_ms) AS maximum_ms FROM codex_telemetry_events WHERE occurred_at >= ? AND duration_ms IS NOT NULL GROUP BY event_category ORDER BY sample_count DESC").bind(thirtyDayCutoff),
    database.prepare("SELECT approval_decision AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND approval_decision IS NOT NULL GROUP BY approval_decision ORDER BY count DESC").bind(thirtyDayCutoff),
    database.prepare("SELECT mcp_server AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND mcp_server IS NOT NULL GROUP BY mcp_server ORDER BY count DESC LIMIT 20").bind(thirtyDayCutoff),
    database.prepare("SELECT mcp_tool AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND mcp_tool IS NOT NULL GROUP BY mcp_tool ORDER BY count DESC LIMIT 20").bind(thirtyDayCutoff),
    database.prepare("SELECT network_decision AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND network_decision IS NOT NULL GROUP BY network_decision ORDER BY count DESC").bind(thirtyDayCutoff),
    database.prepare("SELECT network_host AS label, COUNT(*) AS count FROM codex_telemetry_events WHERE occurred_at >= ? AND network_host IS NOT NULL GROUP BY network_host ORDER BY count DESC LIMIT 20").bind(thirtyDayCutoff),
    database.prepare("SELECT COALESCE(session_id, thread_id) AS session_id, MAX(project_name) AS project_name, MAX(model) AS model, COUNT(*) AS event_count, SUM(CASE WHEN event_category = 'error' THEN 1 ELSE 0 END) AS error_count, SUM(CASE WHEN event_category = 'tool' THEN 1 ELSE 0 END) AS tool_executions, MIN(occurred_at) AS first_seen_at, MAX(occurred_at) AS last_seen_at FROM codex_telemetry_events WHERE occurred_at >= ? AND COALESCE(session_id, thread_id) IS NOT NULL GROUP BY COALESCE(session_id, thread_id) ORDER BY last_seen_at DESC LIMIT 50").bind(thirtyDayCutoff),
    database.prepare("SELECT project_id, MAX(project_name) AS project_name, COUNT(*) AS event_count, COUNT(DISTINCT session_id) AS session_count, MAX(occurred_at) AS last_seen_at FROM codex_telemetry_events WHERE occurred_at >= ? AND project_id IS NOT NULL GROUP BY project_id ORDER BY last_seen_at DESC LIMIT 50").bind(thirtyDayCutoff),
    database.prepare("SELECT * FROM codex_telemetry_events WHERE occurred_at >= ? AND event_category IN ('error', 'warning') ORDER BY occurred_at DESC LIMIT 25").bind(thirtyDayCutoff),
    database.prepare("SELECT '7d' AS window, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens, SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS events_with_usage FROM codex_telemetry_events WHERE occurred_at >= ? UNION ALL SELECT '30d' AS window, COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cached_input_tokens), 0), COALESCE(SUM(reasoning_output_tokens), 0), SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL THEN 1 ELSE 0 END) FROM codex_telemetry_events WHERE occurred_at >= ?").bind(sevenDayCutoff, thirtyDayCutoff),
    database.prepare("SELECT COUNT(*) AS event_count, MAX(received_at) AS last_received_at, MIN(occurred_at) AS oldest_event_at, MAX(occurred_at) AS newest_event_at, SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS today_event_count, COUNT(DISTINCT CASE WHEN occurred_at >= ? THEN COALESCE(session_id, thread_id) END) AS observed_session_count_24h, SUM(CASE WHEN occurred_at >= ? AND tool_name IS NOT NULL AND (success = 0 OR tool_status IN ('failed', 'failure', 'error')) THEN 1 ELSE 0 END) AS failed_tool_count_30d FROM codex_telemetry_events").bind(todayCutoff, twentyFourHourCutoff, thirtyDayCutoff),
  ];
  const results = await database.batch(statements);
  if (results.length !== statements.length) throw new Error("Telemetry query batch returned an unexpected result count.");

  const activity = rows(results[0] as unknown as D1ResultLike<EventRow>).map(eventRecord);
  const daily = rows(results[1] as unknown as D1ResultLike<DailyRow>);
  const hourly = rows(results[2] as unknown as D1ResultLike<DailyRow>);
  const usageRows = rows(results[15] as unknown as D1ResultLike<UsageRow>);
  const meta = rows(results[16] as unknown as D1ResultLike<MetaRow>)[0];
  const usage: CodexUsageSnapshot[] = usageRows.map((row) => ({
    window: row.window,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    reasoningOutputTokens: Number(row.reasoning_output_tokens ?? 0),
    eventsWithUsage: Number(row.events_with_usage ?? 0),
    capturedAt: now.toISOString(),
  }));

  return {
    activity,
    twentyFourHourTrend: hourly.map((row) => ({ label: row.day, events: Number(row.events), errors: Number(row.errors), toolExecutions: Number(row.tool_executions) })),
    sevenDayTrend: daily.filter((row) => row.day >= sevenDayCutoff.slice(0, 10)).map((row) => ({ label: row.day, events: Number(row.events), errors: Number(row.errors), toolExecutions: Number(row.tool_executions) })),
    thirtyDayTrend: daily.map((row) => ({ label: row.day, events: Number(row.events), errors: Number(row.errors), toolExecutions: Number(row.tool_executions) })),
    usage,
    categories: rows(results[3] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    models: rows(results[4] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    tools: rows(results[5] as unknown as D1ResultLike<ToolRow>).map((row) => ({ label: row.label, count: Number(row.count), failureCount: Number(row.failure_count), averageDurationMs: row.average_duration_ms === null ? undefined : Number(row.average_duration_ms), lastSeenAt: row.last_seen_at })),
    timings: rows(results[6] as unknown as D1ResultLike<TimingRow>).map((row) => ({ label: row.label, sampleCount: Number(row.sample_count), averageMs: Number(row.average_ms), maximumMs: Number(row.maximum_ms) })),
    approvals: rows(results[7] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    mcpServers: rows(results[8] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    mcpTools: rows(results[9] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    networkDecisions: rows(results[10] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    networkHosts: rows(results[11] as unknown as D1ResultLike<CountRow>).map((row) => ({ label: row.label, count: Number(row.count) })),
    sessions: rows(results[12] as unknown as D1ResultLike<SessionRow>).map((row) => ({ sessionId: row.session_id, projectName: row.project_name ?? undefined, model: row.model ?? undefined, eventCount: Number(row.event_count), errorCount: Number(row.error_count), toolExecutions: Number(row.tool_executions), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at })),
    projects: rows(results[13] as unknown as D1ResultLike<ProjectRow>).map((row) => ({ projectId: row.project_id, projectName: row.project_name ?? undefined, eventCount: Number(row.event_count), sessionCount: Number(row.session_count), lastSeenAt: row.last_seen_at })),
    recentErrors: rows(results[14] as unknown as D1ResultLike<EventRow>).map(eventRecord),
    eventCount: Number(meta?.event_count ?? 0),
    lastReceivedAt: meta?.last_received_at ?? undefined,
    oldestEventAt: meta?.oldest_event_at ?? undefined,
    newestEventAt: meta?.newest_event_at ?? undefined,
    todayEventCount: Number(meta?.today_event_count ?? 0),
    observedSessionCount24h: Number(meta?.observed_session_count_24h ?? 0),
    failedToolCount30d: Number(meta?.failed_tool_count_30d ?? 0),
  };
}
