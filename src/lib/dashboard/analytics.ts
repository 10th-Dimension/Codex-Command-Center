import type { CodexMeasuredValue, CodexTelemetryBreakdown, CodexTelemetrySessionSummary, CodexTelemetrySnapshot, CodexTelemetryTrendPoint, CodexUsageSnapshot, DataResult } from "@/lib/providers/types";

export type DashboardRange = "24h" | "7d" | "30d";
export const dashboardRanges: readonly DashboardRange[] = ["24h", "7d", "30d"];

export function parseDashboardRange(value: unknown): DashboardRange { return dashboardRanges.includes(value as DashboardRange) ? value as DashboardRange : "24h"; }
export function selectUsage(snapshot: CodexTelemetrySnapshot, range: DashboardRange): DataResult<CodexUsageSnapshot> {
  if (snapshot.usage.status === "unavailable") return snapshot.usage;
  const match = snapshot.usage.data.find((item) => item.window === range);
  return match ? { ...snapshot.usage, data: match } : { status: "unavailable", source: "codex", reason: `No ${range} usage window was returned.` };
}
export function selectTrend(snapshot: CodexTelemetrySnapshot, range: DashboardRange): DataResult<CodexTelemetryTrendPoint[]> {
  return range === "24h" ? snapshot.trends.twentyFourHour : range === "7d" ? snapshot.trends.sevenDay : snapshot.trends.thirtyDay;
}
export function measuredValue(metric: CodexMeasuredValue | undefined) { return metric?.availability === "available" ? metric.value ?? 0 : undefined; }
export function measuredLabel(metric: CodexMeasuredValue | undefined) {
  if (!metric || metric.availability === "unavailable") return "Unavailable";
  if (metric.availability === "no-samples") return "No samples";
  return (metric.value ?? 0).toLocaleString();
}
export function trendTotal(result: DataResult<CodexTelemetryTrendPoint[]>, field: keyof CodexTelemetryTrendPoint) {
  if (result.status === "unavailable") return undefined;
  return result.data.reduce((total, point) => total + (typeof point[field] === "number" ? point[field] as number : 0), 0);
}
export function averageTtft(snapshot: CodexTelemetrySnapshot) {
  if (snapshot.ttft.status === "unavailable") return undefined;
  const samples = snapshot.ttft.data.reduce((sum, item) => sum + item.sampleCount, 0);
  return samples ? snapshot.ttft.data.reduce((sum, item) => sum + item.averageMs * item.sampleCount, 0) / samples : undefined;
}
export function latestSession(snapshot: CodexTelemetrySnapshot): CodexTelemetrySessionSummary | undefined {
  return snapshot.sessions.status === "connected" ? [...snapshot.sessions.data].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] : undefined;
}
export function completedTools(snapshot: CodexTelemetrySnapshot) { return snapshot.tools.status === "connected" ? snapshot.tools.data.reduce((total, tool) => total + tool.completedExecutionCount, 0) : undefined; }
export function toolFailures(snapshot: CodexTelemetrySnapshot) { return snapshot.tools.status === "connected" ? snapshot.tools.data.reduce((total, tool) => total + tool.failureCount, 0) : undefined; }
export function approvalCount(snapshot: CodexTelemetrySnapshot) { return snapshot.approvals.status === "connected" ? snapshot.approvals.data.reduce((total, item) => total + item.count, 0) : undefined; }
export function compactNumber(value: number | undefined) { return value === undefined ? "—" : new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
export function formatDuration(value: number | undefined) { return value === undefined ? "—" : value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`; }
export function percent(part: number | undefined, total: number | undefined) { return part === undefined || total === undefined || total <= 0 ? undefined : Math.round(part / total * 100); }
export function distributionShares(items: CodexTelemetryBreakdown[]) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items.map((item) => ({ ...item, share: total > 0 ? Math.round(item.count / total * 100) : 0 }));
}
