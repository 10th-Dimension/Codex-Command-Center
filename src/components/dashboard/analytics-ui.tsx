"use client";
import { useState, type CSSProperties } from "react";
import { compactNumber, dashboardRanges, distributionShares, measuredValue, type DashboardRange } from "@/lib/dashboard/analytics";
import type { CodexTelemetryBreakdown, CodexTelemetryTrendPoint, CodexUsageSnapshot, DataResult } from "@/lib/providers/types";
export function RangeSelector({ value, onChange, label = "Time range" }: Readonly<{ value: DashboardRange; onChange: (value: DashboardRange) => void; label?: string }>) { return <div className="range-selector" role="group" aria-label={label}>{dashboardRanges.map((range) => <button aria-pressed={range === value} className={range === value ? "active" : ""} key={range} onClick={() => onChange(range)} type="button">{range.toUpperCase()}</button>)}</div>; }
const tokenFields = ["inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "reasoningTokens", "toolTokens"] as const;
const displaySeries = { label: "Measured tokens", color: "#d197f1" };
const MAX_DISPLAY_POINTS = 48;

export function TokenTrend({ result, compact = false }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]>; compact?: boolean }>) {
  const [activeIndex, setActiveIndex] = useState<number>();
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

  return <div className={`token-chart ${compact ? "token-chart-compact" : ""}`}>
    <div className="token-chart-frame">
      <svg aria-label="Measured token activity by time bucket" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, .5, 1].map((part) => <g key={part}><line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * part} y2={padding.top + plotHeight * part} />{!compact ? <text className="chart-axis-label" dominantBaseline="middle" textAnchor="end" x={padding.left - 8} y={padding.top + plotHeight * part}>{compactNumber(maximum * (1 - part))}</text> : null}</g>)}
        <polyline className="measured-token-line" fill="none" points={points.map((point, index) => `${x(index)},${y(totals[index])}`).join(" ")} stroke={displaySeries.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={compact ? 2.2 : 2.8} vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => <circle aria-label={activityTooltip(point, totals[index])} className={`chart-point ${activeIndex === index ? "active" : ""}`} cx={x(index)} cy={y(totals[index])} fill="#10161c" key={`${point.label}-${index}`} onBlur={() => setActiveIndex(undefined)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(undefined)} r={compact ? 3 : 4.5} stroke="#effcff" strokeWidth="1.5" tabIndex={0}><title>{activityTooltip(point, totals[index])}</title></circle>)}
        {!compact ? labelIndexes.map((index) => <text className="chart-x-label" key={`${points[index].label}-${index}`} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} x={x(index)} y={height - 10}>{points[index].label}</text>) : null}
      </svg>
      {!compact ? <div aria-live="polite" className={`token-chart-tooltip ${activePoint ? "visible" : ""}`}>{activePoint && activeTotal !== undefined ? activityTooltip(activePoint, activeTotal) : "Hover or focus a point for the exact bucket"}</div> : null}
    </div>
    {!compact ? <div className="chart-legend"><span><i style={{ "--legend-color": displaySeries.color } as CSSProperties} />{displaySeries.label}</span><small>{points.length < result.data.length ? `Grouped into ${points.length} display buckets from ${result.data.length} samples` : "Each point is an exact returned time bucket"}</small></div> : null}
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
export function Distribution({ result, empty = "No observations" }: Readonly<{ result: DataResult<CodexTelemetryBreakdown[]>; empty?: string }>) {
  if (result.status === "unavailable") return <div className="distribution-empty">Unavailable</div>; if (!result.data.length) return <div className="distribution-empty">{empty}</div>;
  return <div className="distribution-list">{distributionShares(result.data).slice(0, 5).map((item, index) => { const tooltip = `${item.label} · ${item.count.toLocaleString()} observed events · ${item.share}% of returned events`; return <div className="distribution-row" data-tooltip={tooltip} key={item.label} title={tooltip}><div><span>{item.label}</span><b>{item.share}%</b></div><div className="distribution-track"><i style={{ width: `${item.share}%`, opacity: 1 - index * .11 }} /></div></div>; })}</div>;
}

export function ActivityHeatmap({ result }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]> }>) {
  if (result.status === "unavailable") return <div className="activity-heatmap-empty">Activity map unavailable</div>;
  if (!result.data.length) return <div className="activity-heatmap-empty">No activity buckets in this range</div>;
  const maximum = Math.max(...result.data.map((point) => point.events), 1);
  return <div className="activity-heatmap" aria-label="Observed Codex activity by time bucket" role="img">
    {result.data.map((point, index) => {
      const level = point.events === 0 ? 0 : Math.min(4, Math.ceil(point.events / maximum * 4));
      const tooltip = activityTooltip(point);
      return <span aria-label={tooltip} className={`activity-cell activity-cell-${level}`} data-tooltip={tooltip} key={`${point.label}-${index}`} tabIndex={0} title={tooltip} />;
    })}
  </div>;
}

const compositionSeries = [
  { key: "inputTokens" as const, label: "Input", color: "#68d8e8" },
  { key: "outputTokens" as const, label: "Output", color: "#a78bfa" },
  { key: "cachedInputTokens" as const, label: "Cached", color: "#55d6a9" },
  { key: "cacheWriteTokens" as const, label: "Cache write", color: "#7dd3fc" },
  { key: "reasoningTokens" as const, label: "Reasoning", color: "#f4b860" },
  { key: "toolTokens" as const, label: "Tool", color: "#f472b6" },
];

export function TokenComposition({ result }: Readonly<{ result: DataResult<CodexUsageSnapshot> }>) {
  if (result.status === "unavailable") return <div className="composition-empty">Token composition unavailable</div>;
  const items = compositionSeries.map((item) => ({ ...item, value: measuredValue(result.data[item.key]) })).filter((item): item is typeof item & { value: number } => item.value !== undefined);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!items.length || total <= 0) return <div className="composition-empty">No token samples in this range</div>;
  return <div className="token-composition">
    <div className="composition-bar" aria-label="Measured token composition" role="img">{items.map((item) => <i key={item.key} style={{ background: item.color, width: `${item.value / total * 100}%` }} title={`${item.label}: ${item.value.toLocaleString()}`} />)}</div>
    <div className="composition-list">{items.map((item) => <div className="composition-row" key={item.key}><span><i style={{ background: item.color }} />{item.label}</span><b>{item.value.toLocaleString()}</b><small>{Math.round(item.value / total * 100)}%</small></div>)}</div>
  </div>;
}

function activityTooltip(point: CodexTelemetryTrendPoint, total?: number) {
  const measuredTokens = [point.inputTokens, point.outputTokens, point.cachedTokens, point.cacheWriteTokens, point.reasoningTokens, point.toolTokens].map((value) => value ?? 0).reduce<number>((sum, value) => sum + value, 0);
  const observedTokens = total ?? measuredTokens;
  const parts = [`${point.label}`, `${point.events.toLocaleString()} events`, `${observedTokens.toLocaleString()} measured tokens`, `${point.toolExecutions.toLocaleString()} completed tools`];
  if (point.errors) parts.push(`${point.errors.toLocaleString()} errors`);
  return parts.join(" · ");
}
