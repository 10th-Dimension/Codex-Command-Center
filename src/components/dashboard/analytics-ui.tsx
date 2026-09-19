"use client";
import type { CSSProperties } from "react";
import { dashboardRanges, distributionShares, measuredValue, type DashboardRange } from "@/lib/dashboard/analytics";
import type { CodexTelemetryBreakdown, CodexTelemetryTrendPoint, CodexUsageSnapshot, DataResult } from "@/lib/providers/types";
export function RangeSelector({ value, onChange, label = "Time range" }: Readonly<{ value: DashboardRange; onChange: (value: DashboardRange) => void; label?: string }>) { return <div className="range-selector" role="group" aria-label={label}>{dashboardRanges.map((range) => <button aria-pressed={range === value} className={range === value ? "active" : ""} key={range} onClick={() => onChange(range)} type="button">{range.toUpperCase()}</button>)}</div>; }
const series = [{ key: "inputTokens" as const, label: "Input", color: "#68d8e8" }, { key: "outputTokens" as const, label: "Output", color: "#a78bfa" }, { key: "cachedTokens" as const, label: "Cached", color: "#55d6a9" }, { key: "cacheWriteTokens" as const, label: "Cache write", color: "#7dd3fc" }, { key: "reasoningTokens" as const, label: "Reasoning", color: "#f4b860" }, { key: "toolTokens" as const, label: "Tool", color: "#f472b6" }];
export function TokenTrend({ result, compact = false }: Readonly<{ result: DataResult<CodexTelemetryTrendPoint[]>; compact?: boolean }>) {
  if (result.status === "unavailable") return <div className="chart-empty">Token trend unavailable</div>; if (!result.data.length) return <div className="chart-empty">No samples in this range</div>;
  const width = 600, height = compact ? 94 : 150, top = 8, bottom = 18, chartHeight = height - top - bottom; const totals = result.data.map((point) => series.reduce((sum, item) => sum + (point[item.key] ?? 0), 0)); const maximum = Math.max(...totals, 1);
  if (!totals.some(Boolean)) return <div className="chart-empty">No token samples in this range</div>;
  const x = (index: number) => result.data.length === 1 ? width / 2 : index / (result.data.length - 1) * width; const y = (value: number) => top + chartHeight - value / maximum * chartHeight;
  return <div className="token-chart"><svg aria-label="Token activity trend" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>{[0, .5, 1].map((part) => <line className="chart-grid-line" key={part} x1="0" x2={width} y1={top + chartHeight * part} y2={top + chartHeight * part} />)}{series.map((item) => <polyline fill="none" key={item.key} points={result.data.map((point, index) => `${x(index)},${y(point[item.key] ?? 0)}`).join(" ")} stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={compact ? 2 : 2.4} vectorEffect="non-scaling-stroke" />)}{result.data.map((point, index) => <circle className="chart-point" cx={x(index)} cy={y(totals[index])} fill="#0e1419" key={`${point.label}-${index}`} r={compact ? 3 : 4} stroke="#dffaff" strokeWidth="1.5" tabIndex={0}><title>{activityTooltip(point, totals[index])}</title></circle>)}</svg>{!compact ? <div className="chart-legend">{series.map((item) => <span key={item.key}><i style={{ "--legend-color": item.color } as CSSProperties} />{item.label}</span>)}</div> : null}</div>;
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
