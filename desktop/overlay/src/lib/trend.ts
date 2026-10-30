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

export function measuredInputTokens(point: DisplayTrendPoint): number | undefined {
  const value = point.inputTokens;
  return point.observed && typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

interface IndexedValue {
  index: number;
  value: number;
}

function trendSegments(values: readonly (number | undefined)[]) {
  const segments: IndexedValue[][] = [];
  let segment: IndexedValue[] = [];
  values.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      segment.push({ index, value });
      return;
    }
    if (segment.length) segments.push(segment);
    segment = [];
  });
  if (segment.length) segments.push(segment);
  return segments;
}

function segmentLinePath(segment: readonly IndexedValue[], x: (index: number) => number, y: (value: number) => number) {
  return segment.map((point, index) => index
    ? `C${x(segment[index - 1].index) + (x(point.index) - x(segment[index - 1].index)) / 3},${y(segment[index - 1].value)} ${x(point.index) - (x(point.index) - x(segment[index - 1].index)) / 3},${y(point.value)} ${x(point.index)},${y(point.value)}`
    : `M${x(point.index)},${y(point.value)}`).join(" ");
}

/** Draw separate paths around missing buckets instead of treating them as measured zeroes. */
export function tokenTrendLinePath(values: readonly (number | undefined)[], x: (index: number) => number, y: (value: number) => number) {
  return trendSegments(values).map((segment) => segmentLinePath(segment, x, y)).join(" ");
}

/** Fill only observed segments; close each segment independently at the chart baseline. */
export function tokenTrendAreaPath(values: readonly (number | undefined)[], x: (index: number) => number, y: (value: number) => number, baseline: number) {
  return trendSegments(values).map((segment) => {
    const first = segment[0];
    const last = segment[segment.length - 1];
    return `${segmentLinePath(segment, x, y)} L${x(last.index)},${baseline} L${x(first.index)},${baseline} Z`;
  }).join(" ");
}

/** Put sparse materialized rollup rows on their actual time axis without querying raw events. */
export function prepareOverlayTrend(source: readonly OverlayTrendPoint[], range: OverlayRange, asOf: string): DisplayTrend {
  const now = Date.parse(asOf);
  const interval = range === "24h" ? TEN_MINUTES_MS : DAY_MS;
  const intervalLabel = range === "24h" ? "10-minute buckets · local time" : "UTC-day buckets";
  if (!Number.isFinite(now)) return { points: [], observedBuckets: 0, intervalLabel };

  const end = Math.floor(now / interval) * interval;
  const count = range === "24h" ? 144 : range === "7d" ? 7 : 31;
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
