import type {
  CodexTelemetryProvider,
  CodexTelemetrySnapshot,
  DataResult,
  ProviderContext,
  ProviderHealth,
} from "@/lib/providers/types";
import type { D1DatabaseLike } from "@/lib/telemetry/database";
import { readTelemetrySnapshot } from "@/lib/telemetry/database";

const descriptor = {
  id: "codex" as const,
  name: "Codex telemetry",
  description: "Privacy-filtered Codex operational events received through the authenticated local relay.",
  capabilities: ["codex-activity", "codex-usage", "telemetry-ingest"] as const,
};

interface CodexProviderDependencies {
  getRuntime(): Promise<{ database?: D1DatabaseLike; ingestKey?: string; retentionDays: number }> | { database?: D1DatabaseLike; ingestKey?: string; retentionDays: number };
  now?: () => Date;
  cacheTtlMs?: number;
}

function unavailable<T>(reason: string): DataResult<T> {
  return { status: "unavailable", source: "codex", reason, errorCode: "not-configured" };
}

function unavailableSnapshot(checkedAt: string, retentionDays: number, message: string): CodexTelemetrySnapshot {
  const result = unavailable<never>(message);
  return {
    activity: result,
    trends: { twentyFourHour: result, sevenDay: result, thirtyDay: result },
    usage: result,
    categories: result,
    models: result,
    tools: result,
    timings: result,
    approvals: result,
    mcpServers: result,
    mcpTools: result,
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
      authentication: "not-configured",
      message,
      errorCode: "not-configured",
    },
  };
}

export function createCodexTelemetryProvider(dependencies: CodexProviderDependencies): CodexTelemetryProvider {
  let cached: { expiresAt: number; snapshot: CodexTelemetrySnapshot } | undefined;
  let inFlight: Promise<CodexTelemetrySnapshot> | undefined;
  const now = dependencies.now ?? (() => new Date());
  const cacheTtlMs = dependencies.cacheTtlMs ?? 15_000;

  async function load(context: ProviderContext) {
    const current = now();
    if (cached && cached.expiresAt > current.getTime()) return cached.snapshot;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const runtime = await dependencies.getRuntime();
      const retentionDays = runtime.retentionDays;
      const database = runtime.database;
      if (!database) return unavailableSnapshot(context.requestedAt, retentionDays, "Codex telemetry storage is not available in this runtime.");

      try {
        const data = await readTelemetrySnapshot(database, current);
        const asOf = current.toISOString();
        const connected = <T>(value: T, bounds?: { description: string; limit: number; truncated: boolean }): DataResult<T> => ({
          status: "connected",
          source: "codex",
          data: value,
          asOf,
          meta: bounds ? { bounds } : undefined,
        });
        const ingestConfigured = Boolean(runtime.ingestKey);
        const health: ProviderHealth = {
          status: ingestConfigured ? "connected" : "degraded",
          checkedAt: asOf,
          configuredResource: "CODEX_TELEMETRY_DB",
          lastSuccessfulFetch: asOf,
          authentication: ingestConfigured ? "authenticated" : "not-configured",
          message: ingestConfigured
            ? "D1 telemetry storage and authenticated ingestion are configured."
            : "D1 telemetry storage is readable, but the dedicated ingestion key is not configured.",
          errorCode: ingestConfigured ? undefined : "not-configured",
        };
        const snapshot: CodexTelemetrySnapshot = {
          activity: connected(data.activity, { description: "Most recent telemetry events in the 30-day window", limit: 100, truncated: data.activity.length === 100 }),
          trends: {
            twentyFourHour: connected(data.twentyFourHourTrend),
            sevenDay: connected(data.sevenDayTrend),
            thirtyDay: connected(data.thirtyDayTrend),
          },
          usage: connected(data.usage),
          categories: connected(data.categories),
          models: connected(data.models),
          tools: connected(data.tools),
          timings: connected(data.timings),
          approvals: connected(data.approvals),
          mcpServers: connected(data.mcpServers),
          mcpTools: connected(data.mcpTools),
          networkDecisions: connected(data.networkDecisions),
          networkHosts: connected(data.networkHosts),
          sessions: connected(data.sessions),
          projects: connected(data.projects),
          recentErrors: connected(data.recentErrors),
          health,
          lastReceivedAt: data.lastReceivedAt,
          oldestEventAt: data.oldestEventAt,
          newestEventAt: data.newestEventAt,
          eventCount: data.eventCount,
          todayEventCount: data.todayEventCount,
          observedSessionCount24h: data.observedSessionCount24h,
          failedToolCount30d: data.failedToolCount30d,
          retentionDays,
        };
        cached = { expiresAt: current.getTime() + cacheTtlMs, snapshot };
        return snapshot;
      } catch {
        const message = "Codex telemetry storage could not be queried safely.";
        const snapshot = unavailableSnapshot(current.toISOString(), retentionDays, message);
        snapshot.health.errorCode = "api";
        snapshot.health.authentication = runtime.ingestKey ? "authenticated" : "not-configured";
        return snapshot;
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  return {
    ...descriptor,
    getSnapshot: load,
    async getHealth(context) {
      return (await load(context)).health;
    },
    async listCodexActivity(context) {
      return (await load(context)).activity;
    },
    async getCodexUsage(context) {
      return (await load(context)).usage;
    },
  };
}
