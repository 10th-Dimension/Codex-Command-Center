import type { OverlayRange, OverlayTrendPoint } from "../../../../src/lib/overlay/contracts";

const TEN_MINUTES_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface DisplayTrendPoint extends OverlayTrendPoint {
  observed: boolean;
}

export interface DisplayTrend {
  points: DisplayTrendPoint[];
  observedBuckets: number;
  intervalLabel: string;
}

/** Put sparse materialized rollup rows on their actual time axis without querying raw events. */
export function prepareOverlayTrend(source: readonly OverlayTrendPoint[], range: OverlayRange, asOf: string): DisplayTrend {
  const now = Date.parse(asOf);
  const interval = range === "24h" ? TEN_MINUTES_MS : DAY_MS;
  const intervalLabel = range === "24h" ? "10-minute buckets · local time" : "UTC-day buckets";
  if (!Number.isFinite(now)) return { points: [], observedBuckets: 0, intervalLabel };

  const end = Math.floor(now / interval) * interval;
  const count = range === "24h" ? 144 : range === "7d" ? 8 : 31;
  const start = end - (count - 1) * interval;
  const byBucket = new Map<number, OverlayTrendPoint>();
  for (const point of source) {
    const timestamp = range === "24h" ? Date.parse(point.label) : Date.parse(`${point.label}T00:00:00.000Z`);
    if (Number.isFinite(timestamp) && timestamp >= start && timestamp <= end && timestamp % interval === 0) {
      byBucket.set(timestamp, point);
    }
  }

  const points = Array.from({ length: count }, (_, index) => {
    const timestamp = start + index * interval;
    const observed = byBucket.get(timestamp);
    return observed
      ? { ...observed, observed: true }
      : { label: range === "24h" ? new Date(timestamp).toISOString() : new Date(timestamp).toISOString().slice(0, 10), observed: false };
  });
  return { points, observedBuckets: byBucket.size, intervalLabel };
}
