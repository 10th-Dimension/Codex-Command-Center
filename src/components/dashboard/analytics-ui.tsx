"use client";
import React, { useId, useState } from "react";
import { useBrowserTimeZone } from "@/components/dashboard/browser-time";
import { compactNumber, dashboardRanges, measuredValue, type DashboardRange } from "@/lib/dashboard/analytics";
import type { CodexTelemetryBreakdown, CodexTelemetryTrendPoint, CodexUsageSnapshot, DataResult } from "@/lib/providers/types";
import { tokenVisualSeries } from "@/lib/telemetry/token-visuals";
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
const TOKEN_CHART_ACCENT = "#67d9ef";
const MAX_DISPLAY_POINTS = 48;
const MAX_COMPACT_POINTS = 24;

export function TokenTrend({ result, compact = false, interactive = !compact }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]>; compact?: boolean; interactive?: boolean }>) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const [selectedField, setSelectedField] = useState<(typeof tokenFields)[number]>("inputTokens");
  const gradientId = useId().replace(/:/g, "");
  const timeZone = useBrowserTimeZone();
  if (result.status === "unavailable") return <div className="chart-empty"><BarChartPlaceholder /><strong>Waiting for token activity</strong><span>{result.reason}</span></div>;
  if (!result.data.length) return <div className="chart-empty"><BarChartPlaceholder /><strong>No samples in this window</strong><span>New observations will appear after the next snapshot.</span></div>;

  const points = bucketTrendPoints(result.data, compact ? MAX_COMPACT_POINTS : MAX_DISPLAY_POINTS);
  const field = trendSeries.find((item) => item.key === selectedField)!;
  const values = points.map((point) => validTokenValue(point[field.key]));
  const maximum = Math.max(...values.map((value) => value ?? 0), 1);
  const width = 720;
  const height = compact ? 140 : 238;
  const padding = { top: 18, right: 16, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const times = points.map((point) => {
    const bounds = point.label.split(" – ").map((label) => Date.parse(label));
    return bounds.every(Number.isFinite) ? bounds.reduce((a, b) => a + b, 0) / bounds.length : undefined;
  });
  const chronological = times.every((time, index) => time !== undefined && (index === 0 || time > times[index - 1]!));
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  const position = (index: number) => points.length === 1 ? .5 : chronological ? (times[index]! - first) / (last - first) : index / (points.length - 1);
  const x = (index: number) => padding.left + 10 + position(index) * (plotWidth - 20);
  const minimumSpacing = points.length > 1 ? Math.min(...points.slice(1).map((_, index) => x(index + 1) - x(index))) : 24;
  const barWidth = Math.max(1, Math.min(26, minimumSpacing * .62));
  const y = (value: number) => padding.top + plotHeight - value / maximum * plotHeight;
  const activePoint = activeIndex === undefined ? undefined : points[activeIndex];
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return <div className={`token-chart field-token-chart ${compact ? "token-chart-compact" : ""}`}>
    <div className="token-field-selector" role="group" aria-label="Token field">{trendSeries.map((series) => <button type="button" aria-pressed={series.key === field.key} key={series.key} onClick={() => { setSelectedField(series.key); setActiveIndex(undefined); }}>{series.label}</button>)}</div>
    <div className="token-chart-frame">
      <svg aria-label={`${field.label} tokens by observed time bucket; missing measurements are gaps`} role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={TOKEN_CHART_ACCENT} stopOpacity=".85" /><stop offset="100%" stopColor={TOKEN_CHART_ACCENT} stopOpacity=".22" /></linearGradient></defs>
        {[0, .5, 1].map((part) => <g key={part}><line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * part} y2={padding.top + plotHeight * part} /><text className="chart-axis-label" dominantBaseline="middle" textAnchor="end" x={padding.left - 10} y={padding.top + plotHeight * part}>{compactNumber(maximum * (1 - part))}</text></g>)}
        {points.map((point, index) => {
          const value = values[index];
          if (value === undefined) return null;
          return <g key={`${point.label}-${index}`}>
            <rect aria-label={`${formatTrendLabel(point.label, timeZone)} · ${value.toLocaleString()} ${field.label.toLowerCase()} tokens`} className="token-observation" x={x(index) - barWidth / 2} y={value === 0 ? y(0) - 1 : y(value)} width={barWidth} height={value === 0 ? 2 : y(0) - y(value)} rx={2} fill={`url(#${gradientId})`} stroke={activeIndex === index ? TOKEN_CHART_ACCENT : "none"} tabIndex={interactive ? 0 : undefined} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(undefined)} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(undefined)}><title>{`${formatTrendLabel(point.label, timeZone)} · ${value.toLocaleString()} ${field.label.toLowerCase()} tokens`}</title></rect>
          </g>;
        })}
        {labelIndexes.map((index) => <text className="chart-x-label" key={index} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} x={x(index)} y={height - 8}>{formatTrendAxisLabel(points[index].label, timeZone)}</text>)}
      </svg>
      {!values.some((value) => value !== undefined) ? <div className="field-chart-empty">No {field.label.toLowerCase()} measurements in this window</div> : null}
    </div>
    <div className="token-readout" aria-live="polite">{activePoint && activeIndex !== undefined ? <><span>{formatTrendLabel(activePoint.label, timeZone)}</span><b>{values[activeIndex]?.toLocaleString()} {field.label.toLowerCase()} tokens</b></> : <><span>{field.label} field · {points.length < result.data.length ? `${result.data.length} observations grouped into ${points.length} bars` : "one bar per returned bucket"}</span><span>Hover or focus a bar for details</span></>}</div>
    <p className="measurement-note">Fields are shown separately; they may overlap. Gaps are missing observations, not measured zeroes.</p>
  </div>;
}

function BarChartPlaceholder() {
  return <svg aria-hidden="true" width="64" height="40" viewBox="0 0 64 40"><path d="M3 38H61" stroke="currentColor" opacity=".3" />{[14, 26, 19, 33, 24].map((height, index) => <rect key={index} x={6 + index * 11} y={36 - height} width="6" height={height} rx="2" fill="currentColor" opacity={.18 + index * .1} />)}</svg>;
}

export function validTokenValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
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

export function Distribution({ result, empty = "No observations" }: Readonly<{ result: DataResult<CodexTelemetryBreakdown[]>; empty?: string }>) {
  if (result.status === "unavailable") return <div className="distribution-empty">Unavailable</div>;
  if (!result.data.length) return <div className="distribution-empty">{empty}</div>;
  const total = result.data.reduce((sum, item) => sum + item.count, 0);
  const items = result.data.slice(0, 5);
  return <div className="distribution-list">{items.map((item, index) => {
    const share = total > 0 ? item.count / total * 100 : 0;
    const label = share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
    const tooltip = `${item.label} · ${item.count.toLocaleString()} observed events · ${label} of returned events`;
    return <div className="distribution-row" data-tooltip={tooltip} key={item.label} title={tooltip}><div><span>{item.label}</span><b>{label}</b></div><div className="distribution-track"><i style={{ width: `${share}%`, opacity: 1 - index * .1 }} /></div></div>;
  })}<p className="measurement-note">{result.data.length > 5 ? `Top 5 of ${result.data.length} returned labels` : `${items.length} returned labels`} · share of observed events</p></div>;
}

export function ActivityHeatmap({ result }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]> }>) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const timeZone = useBrowserTimeZone();
  if (result.status === "unavailable") return <div className="activity-heatmap-empty">Activity map unavailable</div>;
  if (!result.data.length) return <div className="activity-heatmap-empty">No activity buckets in this range</div>;
  const points = bucketTrendPoints(result.data, MAX_COMPACT_POINTS);
  const maximum = Math.max(...points.map((point) => point.events), 1);
  const activePoint = activeIndex === undefined ? undefined : points[activeIndex];
  return <div className="activity-heatmap-shell">
    <div className="activity-heatmap" aria-label="Observed Codex activity by numbered time bucket" role="group">
      {points.map((point, index) => {
      const level = point.events === 0 ? 0 : Math.min(4, Math.ceil(point.events / maximum * 4));
      const tooltip = activityTooltipText(point, timeZone);
        const edge = activityCellEdge(index, points.length);
        return <span aria-label={`Bucket ${index + 1} of ${points.length} · ${tooltip}`} className={`activity-cell activity-cell-${level} ${edge} ${activeIndex === index ? "active" : ""}`} data-tooltip={tooltip} key={`${point.label}-${index}`} onBlur={() => setActiveIndex(undefined)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(undefined)} role="button" tabIndex={0}></span>;
      })}
    </div>
    {activePoint && activeIndex !== undefined ? <div aria-live="polite" className="activity-heatmap-tooltip visible"><ActivityTooltip index={activeIndex} point={activePoint} timeZone={timeZone} totalPoints={points.length} /></div> : null}
    <small className="activity-heatmap-key"><span>{points.length} activity intervals · browser-local time</span><span>Fewer events <i /> More events</span></small>
  </div>;
}

export function activityCellEdge(index: number, length: number): "edge-start" | "edge-end" | "" {
  const edgeBand = Math.max(2, Math.ceil(length * 0.12));
  if (index < edgeBand) return "edge-start";
  if (index >= length - edgeBand) return "edge-end";
  return "";
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
  if (result.status === "unavailable") return <div className="composition-empty"><strong>Measurements unavailable</strong><span>No usage snapshot was returned for this window.</span></div>;
  const items = compositionSeries.map((item) => ({ ...item, metric: result.data[item.key], value: validTokenValue(measuredValue(result.data[item.key])) }));
  const maximum = Math.max(...items.map((item) => item.value ?? 0), 1);
  return <div className="token-measurements">
    <p className="measurement-intro">Reported fields, shown independently.</p>
    <dl className="measurement-list">{items.map((item) => <div className="measurement-row" key={item.key}>
      <dt>{item.label}</dt>
      <dd><b>{item.value !== undefined ? item.value.toLocaleString() : item.metric.availability === "no-samples" ? "No samples" : "Unavailable"}</b><small>{item.value !== undefined ? `${item.metric.sampleCount.toLocaleString()} samples` : "No measurement"}</small></dd>
      <div aria-hidden="true" className="measurement-track"><i style={{ background: TOKEN_CHART_ACCENT, width: `${(item.value ?? 0) / maximum * 100}%` }} /></div>
    </div>)}</dl>
    <p className="measurement-note">Bars compare field magnitudes, not shares of a total. Fields may overlap and have different sample coverage.</p>
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

export function formatTrendAxisLabel(label: string, timeZone = "UTC"): string {
  // Grouped bars use the bucket start on the axis; focus reveals both bounds.
  if (label.includes(" – ")) return formatTrendAxisLabel(label.split(" – ")[0], timeZone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }
  const date = new Date(label);
  return Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

export function activityTooltipText(point: CodexTelemetryTrendPoint, timeZone = "UTC") {
  const parts = [formatTrendLabel(point.label, timeZone), `${point.events.toLocaleString()} events`, `${point.toolExecutions.toLocaleString()} completed tools`];
  const fields = trendSeries.filter((series) => (point[series.key] ?? 0) > 0).map((series) => `${series.label} ${(point[series.key] ?? 0).toLocaleString()}`);
  if (fields.length) parts.push(fields.join(", "));
  if (point.errors) parts.push(`${point.errors.toLocaleString()} errors`);
  return parts.join(" · ");
}

function ActivityTooltip({ index, point, timeZone, totalPoints }: Readonly<{ index: number; point: CodexTelemetryTrendPoint; timeZone: string; totalPoints: number }>) {
  return <div className="activity-tooltip-content">
    <strong>Bucket {index + 1} of {totalPoints}</strong>
    <span>{formatTrendLabel(point.label, timeZone)} <em>local time</em></span>
    <p>{activityTooltipText(point, timeZone).replace(`${formatTrendLabel(point.label, timeZone)} · `, "")}</p>
  </div>;
}
