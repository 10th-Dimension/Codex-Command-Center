import "server-only";

import type { GitHubDataSnapshot, ProviderStatus } from "@/lib/providers/types";
import { providerRegistry } from "@/lib/providers/registry";
import { getTelemetryRuntimeBindings } from "@/lib/telemetry/cloudflare";
import { readMaterializedSnapshot, type CodexMaterializedSnapshot, type TelemetryRange } from "@/lib/telemetry/rollups";
import type { OverlaySnapshot } from "@/lib/overlay/contracts";

function measuredValue(metric: CodexMaterializedSnapshot["summary"]["inputTokens"]) {
  return metric.availability === "available" ? metric.value : undefined;
}

function ciStatus(github: GitHubDataSnapshot): ProviderStatus {
  if (github.builds.status === "unavailable" || !github.builds.data.length) return "unavailable";
  return github.builds.data[0].status === "failure" ? "degraded" : "connected";
}

function unavailableOverlay(range: TelemetryRange, github: GitHubDataSnapshot, generatedAt: string): OverlaySnapshot {
  const latestBuild = github.builds.status === "connected" ? github.builds.data[0] : undefined;
  const repository = github.repositories.status === "connected" ? github.repositories.data[0] : undefined;
  return {
    generatedAt,
    range,
    health: { telemetry: "unavailable", d1: "unavailable", github: github.health.status, ci: ciStatus(github) },
    windowSummary: {},
    tokenTrend: [],
    modelDistribution: [],
    reasoningDistribution: [],
    delivery: repository || latestBuild ? {
      repository: repository?.fullName,
      latestBuild: latestBuild ? { name: latestBuild.name, status: latestBuild.status, completedAt: latestBuild.completedAt } : undefined,
    } : undefined,
  };
}

export async function getOverlaySnapshot(range: TelemetryRange): Promise<OverlaySnapshot> {
  const generatedAt = new Date().toISOString();
  const context = { requestedAt: generatedAt };
  const [runtime, github] = await Promise.all([
    getTelemetryRuntimeBindings(),
    providerRegistry.github.getSnapshot(context),
  ]);
  if (!runtime.database) return unavailableOverlay(range, github, generatedAt);
  let codex: CodexMaterializedSnapshot | undefined;
  try {
    codex = await readMaterializedSnapshot(runtime.database, range);
  } catch {
    return unavailableOverlay(range, github, generatedAt);
  }
  if (!codex) return unavailableOverlay(range, github, generatedAt);
  const latestSession = codex.sessions[0];
  const latestBuild = github.builds.status === "connected" ? github.builds.data[0] : undefined;
  const repository = github.repositories.status === "connected" ? github.repositories.data[0] : undefined;
  return {
    generatedAt,
    range,
    lastTelemetryAt: codex.sourceUpdatedAt,
    health: {
      telemetry: codex.sourceUpdatedAt ? "connected" : "degraded",
      d1: "connected",
      github: github.health.status,
      ci: ciStatus(github),
    },
    latestSession: latestSession ? {
      model: latestSession.models[0],
      reasoningEffort: latestSession.reasoningEfforts[0],
      startedAt: latestSession.firstSeenAt,
      lastSeenAt: latestSession.lastSeenAt,
      inputTokens: latestSession.inputTokens,
      outputTokens: latestSession.outputTokens,
      cachedTokens: latestSession.cachedTokens,
      reasoningTokens: latestSession.reasoningTokens,
      toolTokens: latestSession.toolTokens,
      averageTtftMs: latestSession.averageTtftMs,
      completedTools: latestSession.toolExecutions,
      toolFailures: latestSession.failedTools,
      approvals: latestSession.approvalEvents,
      errors: latestSession.errorCount,
    } : undefined,
    windowSummary: {
      events: codex.summary.events,
      sessions: codex.summary.sessions,
      inputTokens: measuredValue(codex.summary.inputTokens),
      outputTokens: measuredValue(codex.summary.outputTokens),
      cachedTokens: measuredValue(codex.summary.cachedTokens),
      reasoningTokens: measuredValue(codex.summary.reasoningTokens),
      toolTokens: measuredValue(codex.summary.toolTokens),
      approvals: codex.summary.approvals,
      averageTtftMs: codex.summary.averageTtftMs,
      completedTools: codex.summary.completedTools,
      failures: codex.summary.failedTools + codex.summary.errors,
    },
    tokenTrend: codex.trend.map((point) => ({
      label: point.label,
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      cachedTokens: point.cachedTokens,
      reasoningTokens: point.reasoningTokens,
      toolTokens: point.toolTokens,
    })),
    modelDistribution: codex.models,
    reasoningDistribution: codex.reasoningEfforts,
    delivery: repository || latestBuild ? {
      repository: repository?.fullName,
      latestBuild: latestBuild ? { name: latestBuild.name, status: latestBuild.status, completedAt: latestBuild.completedAt } : undefined,
    } : undefined,
  };
}
