import type {
  CodexTelemetryForensics,
  CodexTelemetryProvider,
  CodexTelemetrySnapshot,
  CodexTelemetryToolSummary,
  CodexUsageSnapshot,
  DataResult,
  ProviderContext,
  ProviderHealth,
} from "@/lib/providers/types";
import type { D1DatabaseLike } from "@/lib/telemetry/database";
import { readTelemetryForensics, TelemetryForensicsLimitError } from "@/lib/telemetry/database";
import {
  readMaterializedSnapshots,
  type CodexMaterializedSnapshot,
  type TelemetryRange,
} from "@/lib/telemetry/rollups";

const descriptor = {
  id: "codex" as const,
  name: "Codex telemetry",
  description: "Privacy-filtered Codex operational summaries received through the authenticated local relay.",
  capabilities: ["codex-activity", "codex-usage", "telemetry-ingest"] as const,
};

interface CodexProviderDependencies {
  getRuntime(): Promise<{ database?: D1DatabaseLike; ingestKey?: string; retentionDays: number }> | { database?: D1DatabaseLike; ingestKey?: string; retentionDays: number };
  now?: () => Date;
  cacheTtlMs?: number;
}

function unavailable<T>(reason: string, errorCode: "not-configured" | "api" = "not-configured"): DataResult<T> {
  return { status: "unavailable", source: "codex", reason, errorCode };
}

function unavailableSnapshot(checkedAt: string, retentionDays: number, message: string, ingestConfigured = false): CodexTelemetrySnapshot {
  const result = unavailable<never>(message);
  return {
    activity: result,
    trends: { twentyFourHour: result, sevenDay: result, thirtyDay: result },
    usage: result,
    pricing: result,
    categories: result,
    models: result,
    modelAnalytics: result,
    reasoningEfforts: result,
    reasoningAnalytics: result,
    correlations: result,
    tools: result,
    timings: result,
    approvals: result,
    approvalPolicies: result,
    sandboxPolicies: result,
    mcpServers: result,
    mcpTools: result,
    mcpOrigins: result,
    toolNamespaces: result,
    agents: result,
    providers: result,
    originators: result,
    appVersions: result,
    serviceVersions: result,
    startupStatuses: result,
    terminalTypes: result,
    ttft: result,
    networkDecisions: result,
    networkHosts: result,
    sessions: result,
    projects: result,
    recentErrors: result,
    retentionDays,
    health: {
      status: "unavailable",
      checkedAt,
      configuredResource: "CODEX_TELEMETRY_DB",
      authentication: ingestConfigured ? "authenticated" : "not-configured",
      message,
      errorCode: "not-configured",
    },
  };
}

function connected<T>(value: T, asOf: string, bounds?: { description: string; limit: number; truncated: boolean }): DataResult<T> {
  return { status: "connected", source: "codex", data: value, asOf, meta: bounds ? { bounds } : undefined };
}

function usage(snapshot: CodexMaterializedSnapshot): CodexUsageSnapshot {
  return {
    window: snapshot.range,
    inputTokens: snapshot.summary.inputTokens,
    outputTokens: snapshot.summary.outputTokens,
    cachedInputTokens: snapshot.summary.cachedTokens,
    cacheWriteTokens: snapshot.summary.cacheWriteTokens,
    reasoningTokens: snapshot.summary.reasoningTokens,
    toolTokens: snapshot.summary.toolTokens,
    eventsWithUsage: snapshot.summary.events,
    sessionsWithUsage: snapshot.summary.sessions,
    modelsWithUsage: snapshot.models.length,
    capturedAt: snapshot.generatedAt,
  };
}

function normalSnapshot(
  materialized: CodexMaterializedSnapshot[],
  selectedRange: TelemetryRange,
  retentionDays: number,
  ingestConfigured: boolean,
  checkedAt: string,
): CodexTelemetrySnapshot {
  const byRange = new Map(materialized.map((snapshot) => [snapshot.range, snapshot]));
  const selected = byRange.get(selectedRange) ?? byRange.get("24h");
  if (!selected) {
    return unavailableSnapshot(
      checkedAt,
      retentionDays,
      "Codex rollup snapshots are not available yet. Apply migration 0003 and run the explicit rollup backfill.",
      ingestConfigured,
    );
  }
  const unavailableForensics = unavailable<never>("Load Forensics explicitly to query retained raw telemetry.");
  const unavailableDetailed = unavailable<never>("This detailed dimension is available only through explicit Forensics loading.");
  const asOf = selected.generatedAt;
  const tool: CodexTelemetryToolSummary = {
    label: "All tools",
    relatedEventCount: selected.summary.completedTools,
    completedExecutionCount: selected.summary.completedTools,
    successCount: Math.max(0, selected.summary.completedTools - selected.summary.failedTools),
    failureCount: selected.summary.failedTools,
    failureRate: selected.summary.completedTools ? selected.summary.failedTools / selected.summary.completedTools : undefined,
    averageDurationMs: selected.summary.averageDurationMs,
    toolTokens: selected.summary.toolTokens.availability === "available" ? selected.summary.toolTokens.value : undefined,
    lastSeenAt: selected.sourceUpdatedAt ?? selected.generatedAt,
  };
  const health: ProviderHealth = {
    status: ingestConfigured ? "connected" : "degraded",
    checkedAt,
    configuredResource: "CODEX_TELEMETRY_DB / codex_dashboard_snapshot",
    lastSuccessfulFetch: checkedAt,
    authentication: ingestConfigured ? "authenticated" : "not-configured",
    message: ingestConfigured
      ? "D1 incremental rollups and materialized dashboard snapshots are available."
      : "Rollup snapshots are readable, but the dedicated ingestion key is not configured.",
    errorCode: ingestConfigured ? undefined : "not-configured",
  };
  const trendResult = (range: TelemetryRange) => {
    const value = byRange.get(range);
    return value ? connected(value.trend, value.generatedAt) : unavailable<never>(`${range} rollup snapshot is not available.`);
  };
  const newest = [...materialized].sort((a, b) => Date.parse(b.sourceUpdatedAt ?? "") - Date.parse(a.sourceUpdatedAt ?? ""))[0];
  const thirtyDay = byRange.get("30d") ?? selected;
  const twentyFourHour = byRange.get("24h") ?? selected;
  return {
    activity: unavailableForensics,
    trends: { twentyFourHour: trendResult("24h"), sevenDay: trendResult("7d"), thirtyDay: trendResult("30d") },
    usage: connected(materialized.map(usage), asOf),
    pricing: selected.pricing ? connected(selected.pricing, selected.generatedAt) : unavailable("Pricing is not available in this snapshot yet. The materialized snapshot will populate it on the next maintenance refresh."),
    categories: unavailableDetailed,
    models: connected(selected.models, asOf, { description: `${selected.range} model distribution`, limit: 8, truncated: selected.models.length === 8 }),
    modelAnalytics: unavailableDetailed,
    reasoningEfforts: connected(selected.reasoningEfforts, asOf, { description: `${selected.range} reasoning distribution`, limit: 8, truncated: selected.reasoningEfforts.length === 8 }),
    reasoningAnalytics: unavailableDetailed,
    correlations: unavailableDetailed,
    tools: connected(selected.summary.completedTools ? [tool] : [], asOf),
    timings: unavailableDetailed,
    approvals: connected(selected.summary.approvals ? [{ label: "Approval events", count: selected.summary.approvals }] : [], asOf),
    approvalPolicies: unavailableDetailed,
    sandboxPolicies: unavailableDetailed,
    mcpServers: unavailableDetailed,
    mcpTools: unavailableDetailed,
    mcpOrigins: unavailableDetailed,
    toolNamespaces: unavailableDetailed,
    agents: unavailableDetailed,
    providers: unavailableDetailed,
    originators: unavailableDetailed,
    appVersions: unavailableDetailed,
    serviceVersions: unavailableDetailed,
    startupStatuses: unavailableDetailed,
    terminalTypes: unavailableDetailed,
    ttft: unavailableDetailed,
    networkDecisions: unavailableDetailed,
    networkHosts: unavailableDetailed,
    sessions: connected(selected.sessions, asOf, { description: `${selected.range} recent session summaries`, limit: 20, truncated: selected.sessions.length === 20 }),
    projects: unavailableDetailed,
    recentErrors: unavailableForensics,
    health,
    lastReceivedAt: newest?.sourceUpdatedAt,
    eventCount: thirtyDay.summary.events,
    todayEventCount: twentyFourHour.summary.events,
    observedSessionCount24h: twentyFourHour.summary.sessions,
    failedToolCount30d: thirtyDay.summary.failedTools,
    retentionDays,
    rollupSummaries: Object.fromEntries(materialized.map((item) => [item.range, {
      events: item.summary.events,
      sessions: item.summary.sessions,
      errors: item.summary.errors,
      warnings: item.summary.warnings,
      completedTools: item.summary.completedTools,
      failedTools: item.summary.failedTools,
      approvals: item.summary.approvals,
      averageTtftMs: item.summary.averageTtftMs,
      averageDurationMs: item.summary.averageDurationMs,
      generatedAt: item.generatedAt,
    }])),
  };
}

export function createCodexTelemetryProvider(dependencies: CodexProviderDependencies): CodexTelemetryProvider {
  const cache = new Map<TelemetryRange, { expiresAt: number; snapshot: CodexTelemetrySnapshot }>();
  const inFlight = new Map<TelemetryRange, Promise<CodexTelemetrySnapshot>>();
  const now = dependencies.now ?? (() => new Date());
  const cacheTtlMs = dependencies.cacheTtlMs ?? 60_000;

  async function load(context: ProviderContext) {
    const current = now();
    const range = context.telemetryRange ?? "24h";
    const cached = cache.get(range);
    if (cached && cached.expiresAt > current.getTime()) return cached.snapshot;
    const pending = inFlight.get(range);
    if (pending) return pending;
    const promise = (async () => {
      const runtime = await dependencies.getRuntime();
      if (!runtime.database) return unavailableSnapshot(context.requestedAt, runtime.retentionDays, "Codex telemetry storage is not available in this runtime.");
      try {
        const snapshot = normalSnapshot(await readMaterializedSnapshots(runtime.database), range, runtime.retentionDays, Boolean(runtime.ingestKey), current.toISOString());
        cache.set(range, { expiresAt: current.getTime() + cacheTtlMs, snapshot });
        return snapshot;
      } catch {
        return unavailableSnapshot(current.toISOString(), runtime.retentionDays,
          "Codex rollup analytics are temporarily unavailable. Raw telemetry fallback is intentionally disabled.", Boolean(runtime.ingestKey));
      }
    })();
    inFlight.set(range, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(range);
    }
  }

  return {
    ...descriptor,
    getSnapshot: load,
    async getHealth(context) { return (await load(context)).health; },
    async listCodexActivity() { return unavailable("Load Forensics explicitly to query retained raw telemetry."); },
    async getCodexUsage(context) { return (await load(context)).usage; },
    async getForensics(): Promise<DataResult<CodexTelemetryForensics>> {
      const runtime = await dependencies.getRuntime();
      if (!runtime.database) return unavailable("Codex telemetry storage is not available in this runtime.");
      try {
        const data = await readTelemetryForensics(runtime.database, now());
        const loadedAt = now().toISOString();
        return connected({
          activity: data.activity,
          recentErrors: data.recentErrors,
          categories: data.categories,
          approvals: data.approvals,
          sandboxPolicies: data.sandboxPolicies,
          mcpServers: data.mcpServers,
          networkDecisions: data.networkDecisions,
          loadedAt,
        }, loadedAt, { description: "Explicit 30-day forensic read", limit: 100, truncated: data.activity.length === 100 });
      } catch (error) {
        if (error instanceof TelemetryForensicsLimitError) return unavailable(error.message, "api");
        return unavailable("Codex forensics could not be loaded safely.", "api");
      }
    },
  };
}
