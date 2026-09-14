export type FreshnessState = "unavailable" | "live" | "recent" | "idle" | "stale";

export interface Freshness {
  state: FreshnessState;
  label: string;
  ageSeconds?: number;
}

export function telemetryFreshness(value: string | undefined, now = Date.now(), dataPathHealthy = true): Freshness {
  if (!dataPathHealthy) return { state: "stale", label: "Stale" };
  if (!value) return { state: "unavailable", label: "No telemetry" };
  const occurredAt = Date.parse(value);
  if (!Number.isFinite(occurredAt)) return { state: "unavailable", label: "Unknown age" };
  const ageSeconds = Math.max(0, Math.floor((now - occurredAt) / 1_000));
  if (ageSeconds <= 15) return { state: "live", label: "Live", ageSeconds };
  if (ageSeconds < 60) return { state: "recent", label: `${ageSeconds}s ago`, ageSeconds };
  if (ageSeconds < 300) return { state: "recent", label: `${Math.floor(ageSeconds / 60)}m ago`, ageSeconds };
  if (ageSeconds < 3_600) return { state: "idle", label: `Idle · ${Math.floor(ageSeconds / 60)}m`, ageSeconds };
  return { state: "idle", label: `Idle · ${Math.floor(ageSeconds / 3_600)}h`, ageSeconds };
}
