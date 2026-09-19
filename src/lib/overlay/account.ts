import type { CodexAccountSnapshot, CodexQuotaWindow } from "./contracts";

export interface CodexUsagePace {
  elapsedPercent: number;
  deltaPercent: number;
  projectedExhaustionAt?: number;
}

export function isCodexAccountSnapshot(value: unknown): value is CodexAccountSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!["connected", "stale", "unavailable", "error"].includes(String(root.status))) return false;
  if (!["live", "recent", "stale", "unavailable"].includes(String(root.freshness))) return false;
  if (!Array.isArray(root.limits) || root.limits.length > 16) return false;
  if (root.activity !== undefined && !isCodexAccountActivity(root.activity)) return false;
  return root.limits.every((limit) => {
    if (!limit || typeof limit !== "object" || Array.isArray(limit)) return false;
    const windows = (limit as Record<string, unknown>).windows;
    return Array.isArray(windows) && windows.length <= 2 && windows.every((window) => {
      if (!window || typeof window !== "object" || Array.isArray(window)) return false;
      const item = window as Record<string, unknown>;
      return ["primary", "secondary"].includes(String(item.slot))
        && ["5h", "7d", "other"].includes(String(item.kind))
        && typeof item.label === "string"
        && typeof item.usedPercent === "number"
        && Number.isFinite(item.usedPercent)
        && typeof item.remainingPercent === "number"
        && Number.isFinite(item.remainingPercent);
    });
  });
}

function isCodexAccountActivity(value: unknown): value is CodexAccountSnapshot["activity"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const activity = value as Record<string, unknown>;
  for (const key of ["lifetimeTokens", "currentStreakDays", "longestStreakDays", "peakDailyTokens", "longestRunningTurnSec"]) {
    if (activity[key] !== undefined && (typeof activity[key] !== "number" || !Number.isFinite(activity[key]) || activity[key] < 0)) return false;
  }
  if (activity.dailyUsageBuckets === undefined) return true;
  if (!Array.isArray(activity.dailyUsageBuckets) || activity.dailyUsageBuckets.length > 90) return false;
  return activity.dailyUsageBuckets.every((bucket) => {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return false;
    const item = bucket as Record<string, unknown>;
    return typeof item.startDate === "string" && item.startDate.length > 0 && item.startDate.length <= 40
      && typeof item.tokens === "number" && Number.isFinite(item.tokens) && item.tokens >= 0;
  });
}

export function quotaFreshness(snapshot: CodexAccountSnapshot | undefined, now = Date.now()) {
  if (!snapshot || snapshot.status === "unavailable") return { state: "unavailable" as const, label: "Unavailable" };
  const observedAt = Date.parse(snapshot.rateLimitsObservedAt ?? snapshot.observedAt ?? "");
  if (!Number.isFinite(observedAt)) return { state: "unavailable" as const, label: "Unavailable" };
  const age = Math.max(0, now - observedAt);
  if (snapshot.status === "error" || snapshot.status === "stale" || age > 5 * 60_000) return { state: "stale" as const, label: "Stale" };
  if (age <= 75_000) return { state: "live" as const, label: "Live" };
  return { state: "recent" as const, label: "Recent" };
}

export function resetCountdown(resetsAt: number | undefined, now = Date.now()) {
  if (!resetsAt) return undefined;
  const seconds = Math.max(0, Math.floor(resetsAt - now / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return seconds ? "<1m" : "now";
}

export function absoluteResetTime(resetsAt: number | undefined) {
  if (!resetsAt) return undefined;
  const date = new Date(resetsAt * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function estimateUsagePace(window: CodexQuotaWindow, now = Date.now()): CodexUsagePace | undefined {
  if (!window.durationMins || !window.resetsAt || window.durationMins <= 0) return undefined;
  const durationMs = window.durationMins * 60_000;
  const startMs = window.resetsAt * 1_000 - durationMs;
  const elapsedMs = now - startMs;
  if (elapsedMs < Math.min(15 * 60_000, durationMs * 0.02) || elapsedMs >= durationMs) return undefined;
  const elapsedPercent = Math.min(100, Math.max(0, elapsedMs / durationMs * 100));
  const used = Math.min(100, Math.max(0, window.usedPercent));
  if (used < 1) return undefined;
  const projectedDurationMs = elapsedMs / (used / 100);
  const projectedExhaustionAt = projectedDurationMs > elapsedMs && projectedDurationMs < durationMs
    ? startMs + projectedDurationMs
    : undefined;
  return {
    elapsedPercent,
    deltaPercent: used - elapsedPercent,
    projectedExhaustionAt,
  };
}
