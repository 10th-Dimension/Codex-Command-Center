import { averageTtft, completedTools, latestSession, measuredValue, selectTrend, selectUsage, toolFailures, trendTotal, type DashboardRange } from "@/lib/dashboard/analytics";
import type { DashboardSnapshot } from "@/lib/dashboard/view-model";
import type { OverlaySnapshot } from "@/lib/overlay/contracts";
import type { ProviderStatus } from "@/lib/providers/types";
export type { OverlaySnapshot } from "@/lib/overlay/contracts";
function ciStatus(snapshot: DashboardSnapshot): ProviderStatus {
  if (snapshot.builds.status === "unavailable" || !snapshot.builds.data.length) return "unavailable";
  return snapshot.builds.data[0].status === "failure" ? "degraded" : "connected";
}
export function composeOverlaySnapshot(snapshot: DashboardSnapshot, range: DashboardRange, generatedAt = new Date().toISOString()): OverlaySnapshot {
  const usage = selectUsage(snapshot.codex, range); const trend = selectTrend(snapshot.codex, range); const session = latestSession(snapshot.codex); const data = usage.status === "connected" ? usage.data : undefined;
  const rollup = snapshot.codex.rollupSummaries?.[range];
  const latestBuild = snapshot.builds.status === "connected" ? snapshot.builds.data[0] : undefined;
  const repository = snapshot.repositories?.status === "connected" ? snapshot.repositories.data[0] : undefined;
  return {
    generatedAt, range, lastTelemetryAt: snapshot.codex.lastReceivedAt,
    health: { telemetry: snapshot.codex.health.status === "connected" && !snapshot.codex.lastReceivedAt ? "degraded" : snapshot.codex.health.status, d1: snapshot.codex.health.status, github: snapshot.githubHealth.status, ci: ciStatus(snapshot) },
    latestSession: session ? { model: session.models[0], reasoningEffort: session.reasoningEfforts[0], startedAt: session.firstSeenAt, lastSeenAt: session.lastSeenAt, inputTokens: session.inputTokens, outputTokens: session.outputTokens, cachedTokens: session.cachedTokens, reasoningTokens: session.reasoningTokens, toolTokens: session.toolTokens, averageTtftMs: session.averageTtftMs, completedTools: session.toolExecutions, approvals: session.approvalEvents, errors: session.errorCount } : undefined,
    windowSummary: { events: rollup?.events, sessions: data?.sessionsWithUsage, inputTokens: measuredValue(data?.inputTokens), outputTokens: measuredValue(data?.outputTokens), cachedTokens: measuredValue(data?.cachedInputTokens), reasoningTokens: measuredValue(data?.reasoningTokens), toolTokens: measuredValue(data?.toolTokens), approvals: rollup?.approvals, averageTtftMs: averageTtft(snapshot.codex), completedTools: trendTotal(trend, "toolExecutions") ?? completedTools(snapshot.codex), failures: trendTotal(trend, "errors") ?? toolFailures(snapshot.codex) },
    tokenTrend: trend.status === "connected" ? trend.data.map(({ label, inputTokens, outputTokens, cachedTokens, reasoningTokens, toolTokens }) => ({ label, inputTokens, outputTokens, cachedTokens, reasoningTokens, toolTokens })) : [],
    modelDistribution: snapshot.codex.models?.status === "connected" ? snapshot.codex.models.data.slice(0, 8) : [],
    reasoningDistribution: snapshot.codex.reasoningEfforts?.status === "connected" ? snapshot.codex.reasoningEfforts.data.slice(0, 8) : [],
    delivery: repository || latestBuild ? { repository: repository?.fullName, latestBuild: latestBuild ? { name: latestBuild.name, status: latestBuild.status, completedAt: latestBuild.completedAt } : undefined } : undefined,
  };
}
