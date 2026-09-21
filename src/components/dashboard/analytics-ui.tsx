"use client";
import { useState, type CSSProperties } from "react";
import { useBrowserTimeZone } from "@/components/dashboard/browser-time";
import { compactNumber, dashboardRanges, distributionShares, measuredValue, type DashboardRange } from "@/lib/dashboard/analytics";
import type { CodexTelemetryBreakdown, CodexTelemetryTrendPoint, CodexUsageSnapshot, DataResult } from "@/lib/providers/types";
import { stackTokenSeries } from "@/lib/telemetry/stacked-token-series";
import { tokenCompositionSegments, tokenVisualSeries } from "@/lib/telemetry/token-visuals";
export function RangeSelector({ value, onChange, label = "Time range" }: Readonly<{ value: DashboardRange; onChange: (value: DashboardRange) => void; label?: string }>) { return <div className="range-selector" role="group" aria-label={label}>{dashboardRanges.map((range) => <button aria-pressed={range === value} className={range === value ? "active" : ""} key={range} onClick={() => onChange(range)} type="button">{range.toUpperCase()}</button>)}</div>; }
const tokenFields = ["inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "reasoningTokens", "toolTokens"] as const;
const trendSeries = [
  { key: "inputTokens" as const, ...tokenVisualSeries[0] },
  { key: "outputTokens" as const, ...tokenVisualSeries[1] },
  { key: "cachedTokens" as const, ...tokenVisualSeries[2] },
  { key: "cacheWriteTokens" as const, ...tokenVisualSeries[3] },
  { key: "reasoningTokens" as const, ...tokenVisualSeries[4] },
  { key: "toolTokens" as const, ...tokenVisualSeries[5] },
];
const MAX_DISPLAY_POINTS = 48;

export function TokenTrend({ result, compact = false }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]>; compact?: boolean }>) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const timeZone = useBrowserTimeZone();
  if (result.status === "unavailable") return <div className="chart-empty">Token trend unavailable</div>;
  if (!result.data.length) return <div className="chart-empty">No samples in this range</div>;

  const points = bucketTrendPoints(result.data, compact ? 24 : MAX_DISPLAY_POINTS);
  const totals = points.map(tokenTotal);
  if (!totals.some(Boolean)) return <div className="chart-empty">No token samples in this range</div>;

  const width = 720;
  const height = compact ? 104 : 218;
  const padding = { top: 12, right: 14, bottom: compact ? 12 : 34, left: compact ? 6 : 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(...totals, 1);
  const x = (index: number) => padding.left + (points.length === 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth);
  const y = (value: number) => padding.top + plotHeight - value / maximum * plotHeight;
  const activePoint = activeIndex === undefined ? undefined : points[activeIndex];
  const activeTotal = activeIndex === undefined ? undefined : totals[activeIndex];
  const labelIndexes = points.length === 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const stacked = stackTokenSeries(points, trendSeries, (point, key) => point[key]);

  return <div className={`token-chart ${compact ? "token-chart-compact" : ""}`}>
    <div className="token-chart-frame">
      <svg aria-label="Measured token activity by time bucket" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, .5, 1].map((part) => <g key={part}><line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * part} y2={padding.top + plotHeight * part} />{!compact ? <text className="chart-axis-label" dominantBaseline="middle" textAnchor="end" x={padding.left - 8} y={padding.top + plotHeight * part}>{compactNumber(maximum * (1 - part))}</text> : null}</g>)}
        {stacked.map(({ definition, base, topValues }) => <path className="token-series-area" d={stackedAreaPath(topValues, base, x, y)} fill={definition.color} fillOpacity={0.3} key={definition.id} stroke={definition.color} strokeOpacity={0.84} strokeWidth="0.9" vectorEffect="non-scaling-stroke" />)}
        <polyline aria-label="Total measured tokens" className="token-total-line" fill="none" points={totals.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
        {activeIndex !== undefined ? <line className="chart-hover-line" x1={x(activeIndex)} x2={x(activeIndex)} y1={padding.top} y2={padding.top + plotHeight} /> : null}
        {points.map((point, index) => <circle aria-label={activityTooltipText(point, totals[index], timeZone)} className={`chart-point ${activeIndex === index ? "active" : ""}`} cx={x(index)} cy={y(totals[index])} fill="#10161c" key={`${point.label}-${index}`} onBlur={() => setActiveIndex(undefined)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(undefined)} r={compact ? 3 : 4.5} stroke="#effcff" strokeWidth="1.5" tabIndex={0} />)}
        {!compact ? labelIndexes.map((index) => <text className="chart-x-label" key={`${points[index].label}-${index}`} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} x={x(index)} y={height - 10}>{formatTrendAxisLabel(points[index].label, timeZone)}</text>) : null}
      </svg>
      {!compact ? <div aria-live="polite" className={`token-chart-tooltip ${activePoint ? "visible" : ""}`}>{activePoint && activeTotal !== undefined ? <TokenTooltip point={activePoint} timeZone={timeZone} total={activeTotal} /> : "Hover or focus a point for the exact bucket"}</div> : null}
    </div>
    {!compact ? <div className="chart-legend">{trendSeries.map((series) => <span key={series.id}><i style={{ "--legend-color": series.color } as CSSProperties} />{series.label}</span>)}<small>Band thickness = actual tokens · {points.length < result.data.length ? `grouped into ${points.length} display buckets from ${result.data.length} samples` : "each point is an exact returned time bucket"}</small></div> : null}
  </div>;
}

export function bucketTrendPoints(points: CodexTelemetryTrendPoint[], maximumPoints = MAX_DISPLAY_POINTS): CodexTelemetryTrendPoint[] {
  if (points.length <= maximumPoints) return points;
  const bucketSize = Math.ceil(points.length / maximumPoints);
  const buckets: CodexTelemetryTrendPoint[] = [];
  for (let start = 0; start < points.length; start += bucketSize) {
    const group = points.slice(start, start + bucketSize);
    buckets.push({
      label: group.length === 1 ? group[0].label : `${group[0].label} – ${group[group.length - 1].label}`,
      events: group.reduce((sum, point) => sum + point.events, 0),
      errors: group.reduce((sum, point) => sum + point.errors, 0),
      toolExecutions: group.reduce((sum, point) => sum + point.toolExecutions, 0),
      ...Object.fromEntries(tokenFields.map((field) => {
        const values = group.map((point) => point[field]).filter((value): value is number => typeof value === "number");
        return [field, values.length ? values.reduce((sum, value) => sum + value, 0) : undefined];
      })),
    });
  }
  return buckets;
}

function tokenTotal(point: CodexTelemetryTrendPoint) {
  return tokenFields.reduce((sum, field) => sum + (point[field] ?? 0), 0);
}

function stackedAreaPath(topValues: number[], baseValues: number[], x: (index: number) => number, y: (value: number) => number) {
  const topPath = topValues.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
  const basePath = baseValues.map((value, index) => `${x(index)},${y(value)}`).reverse().join(" L");
  return `${topPath} L${basePath} Z`;
}
export function Distribution({ result, empty = "No observations" }: Readonly<{ result: DataResult<CodexTelemetryBreakdown[]>; empty?: string }>) {
  if (result.status === "unavailable") return <div className="distribution-empty">Unavailable</div>; if (!result.data.length) return <div className="distribution-empty">{empty}</div>;
  return <div className="distribution-list">{distributionShares(result.data).slice(0, 5).map((item, index) => { const tooltip = `${item.label} · ${item.count.toLocaleString()} observed events · ${item.share}% of returned events`; return <div className="distribution-row" data-tooltip={tooltip} key={item.label} title={tooltip}><div><span>{item.label}</span><b>{item.share}%</b></div><div className="distribution-track"><i style={{ width: `${item.share}%`, opacity: 1 - index * .11 }} /></div></div>; })}</div>;
}

export function ActivityHeatmap({ result }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]> }>) {
  const timeZone = useBrowserTimeZone();
  if (result.status === "unavailable") return <div className="activity-heatmap-empty">Activity map unavailable</div>;
  if (!result.data.length) return <div className="activity-heatmap-empty">No activity buckets in this range</div>;
  const maximum = Math.max(...result.data.map((point) => point.events), 1);
  return <div className="activity-heatmap" aria-label="Observed Codex activity by time bucket" role="img">
    {result.data.map((point, index) => {
      const level = point.events === 0 ? 0 : Math.min(4, Math.ceil(point.events / maximum * 4));
      const tooltip = activityTooltipText(point, undefined, timeZone);
      const edge = index === 0 ? "edge-start" : index === result.data.length - 1 ? "edge-end" : "";
      return <span aria-label={tooltip} className={`activity-cell activity-cell-${level} ${edge}`} data-tooltip={tooltip} key={`${point.label}-${index}`} tabIndex={0} />;
    })}
  </div>;
}

const compositionSeries = [
  { key: "inputTokens" as const, ...tokenVisualSeries[0] },
  { key: "outputTokens" as const, ...tokenVisualSeries[1] },
  { key: "cachedInputTokens" as const, ...tokenVisualSeries[2] },
  { key: "cacheWriteTokens" as const, ...tokenVisualSeries[3] },
  { key: "reasoningTokens" as const, ...tokenVisualSeries[4] },
  { key: "toolTokens" as const, ...tokenVisualSeries[5] },
];

export function TokenComposition({ result }: Readonly<{ result: DataResult<CodexUsageSnapshot> }>) {
  if (result.status === "unavailable") return <div className="composition-empty">Token composition unavailable</div>;
  const measuredItems = compositionSeries.map((item) => ({ ...item, value: measuredValue(result.data[item.key]) })).filter((item): item is typeof item & { value: number } => item.value !== undefined);
  const { items, total } = tokenCompositionSegments(measuredItems);
  if (!items.length || total <= 0) return <div className="composition-empty">No token samples in this range</div>;
  return <div className="token-composition">
    <div className="composition-bar" aria-label={`Measured token fields, ${total.toLocaleString()} displayed tokens`} role="img" title={`Displayed measured fields total: ${total.toLocaleString()} tokens`}>{items.map((item) => <i aria-label={`${item.label}: ${item.value.toLocaleString()} tokens`} key={item.key} style={{ background: item.color, flex: `0 0 ${item.fraction * 100}%` }} title={`${item.label}: ${item.value.toLocaleString()} tokens`} />)}</div>
    <div className="composition-list">{items.map((item) => <div className="composition-row" key={item.key}><span><i style={{ background: item.color }} />{item.label}</span><b>{item.value.toLocaleString()}</b><small>{Math.round(item.fraction * 100)}%</small></div>)}</div>
  </div>;
}

export function formatTrendLabel(label: string, timeZone = "UTC"): string {
  if (label.includes(" – ")) return label.split(" – ").map((part) => formatTrendLabel(part, timeZone)).join(" – ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" }).format(date);
  }
  const date = new Date(label);
  if (Number.isNaN(date.getTime())) return label;
  const dateLabel = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone, year: "numeric" }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  return `${dateLabel} · ${timeLabel}`;
}

export function formatTrendAxisLabel(label: string, timeZone = "UTC") {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }
  const date = new Date(label);
  return Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

export function activityTooltipText(point: CodexTelemetryTrendPoint, total?: number, timeZone = "UTC") {
  const measuredTokens = [point.inputTokens, point.outputTokens, point.cachedTokens, point.cacheWriteTokens, point.reasoningTokens, point.toolTokens].map((value) => value ?? 0).reduce<number>((sum, value) => sum + value, 0);
  const observedTokens = total ?? measuredTokens;
  const parts = [formatTrendLabel(point.label, timeZone), `${point.events.toLocaleString()} events`, `${observedTokens.toLocaleString()} measured tokens`, `${point.toolExecutions.toLocaleString()} completed tools`];
  const fields = trendSeries.filter((series) => (point[series.key] ?? 0) > 0).map((series) => `${series.label} ${(point[series.key] ?? 0).toLocaleString()}`);
  if (fields.length) parts.push(fields.join(", "));
  if (point.errors) parts.push(`${point.errors.toLocaleString()} errors`);
  return parts.join(" · ");
}

function TokenTooltip({ point, timeZone, total }: Readonly<{ point: CodexTelemetryTrendPoint; timeZone: string; total: number }>) {
  const fields = trendSeries.filter((series) => (point[series.key] ?? 0) > 0);
  return <div className="token-tooltip-content">
    <strong>{formatTrendLabel(point.label, timeZone)}</strong>
    <div className="token-tooltip-stats"><span><b>{point.events.toLocaleString()}</b> events</span><span><b>{total.toLocaleString()}</b> measured tokens</span><span><b>{point.toolExecutions.toLocaleString()}</b> completed tools</span></div>
    {fields.length ? <div className="token-tooltip-fields">{fields.map((series) => <span key={series.id}><i style={{ background: series.color }} />{series.label} {point[series.key]?.toLocaleString()}</span>)}</div> : null}
    {point.errors ? <small>{point.errors.toLocaleString()} errors observed</small> : null}
  </div>;
}
