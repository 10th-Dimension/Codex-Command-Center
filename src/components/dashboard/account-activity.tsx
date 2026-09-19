"use client";

import { Activity, CalendarDays, Clock3, Flame, Info, Layers3, TrendingUp, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { compactNumber } from "@/lib/dashboard/analytics";
import { accountActivityBuckets, accountActivitySummary, formatAccountSeconds, formatBackendDate, type AccountActivityRange } from "@/lib/dashboard/account-activity";
import type { CodexAccountActivity } from "@/lib/overlay/contracts";

const ranges: readonly AccountActivityRange[] = [7, 30];

export function AccountActivityPanel({ activity, observedAt }: Readonly<{ activity?: CodexAccountActivity; observedAt?: string }>) {
  const [range, setRange] = useRange();
  const buckets = accountActivityBuckets(activity, range);
  const summary = accountActivitySummary(buckets);
  const maximum = Math.max(...buckets.map((bucket) => bucket.tokens), 1);
  const observedLabel = observedAt ? `Updated ${formatRelativeTime(observedAt)}` : "Update time unavailable";

  if (!activity) return <section className="account-activity-panel panel">
    <header className="account-section-header"><div><span><Activity size={14} /> Daily usage history</span><small>Account Activity</small></div><b className="account-source-badge unavailable">Unavailable</b></header>
    <div className="account-activity-empty"><Activity size={16} /><div><strong>No supported daily history returned</strong><p>The local Codex app-server did not provide account activity for this refresh. The dashboard does not substitute OTel totals or fabricate credits.</p></div></div>
  </section>;

  return <section className="account-activity-panel panel">
    <header className="account-section-header"><div><span><Activity size={14} /> Daily usage history</span><small>Account Activity · backend-reported tokens</small></div><div className="account-header-meta"><span>{observedLabel}</span><b className="account-source-badge">Local Codex</b></div></header>
    <div className="account-activity-toolbar"><div><strong>Daily token movement</strong><p>Exact daily buckets returned by the supported local Codex app-server. Hover or focus a bar for the value.</p></div><div className="account-range-selector" role="group" aria-label="Account activity range">{ranges.map((option) => <button aria-pressed={option === range} className={option === range ? "active" : ""} key={option} onClick={() => setRange(option)} type="button">{option}D</button>)}</div></div>
    <div className="account-activity-stat-grid">
      <AccountActivityStat icon={Layers3} label="Tokens in range" value={compactNumber(summary.totalTokens)} detail={summary.totalTokens.toLocaleString()} />
      <AccountActivityStat icon={CalendarDays} label="Active days" value={summary.activeDays.toLocaleString()} detail={`${buckets.length.toLocaleString()} returned days`} />
      <AccountActivityStat icon={TrendingUp} label="Peak day" value={summary.peak ? compactNumber(summary.peak.tokens) : "—"} detail={summary.peak ? `${formatBackendDate(summary.peak.startDate)} · ${summary.peak.tokens.toLocaleString()}` : "No token samples"} />
      <AccountActivityStat icon={Flame} label="Current streak" value={activity.currentStreakDays === undefined ? "—" : `${activity.currentStreakDays}d`} detail="Backend summary" />
    </div>
    {buckets.length ? <>
      <div className="account-bar-chart" aria-label={`Daily account token history for the last ${range} days`} role="img">
        <div className="account-bar-grid" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="account-bars" style={{ "--bar-count": buckets.length } as CSSProperties}>{buckets.map((bucket) => {
          const height = bucket.tokens > 0 ? Math.max(5, bucket.tokens / maximum * 100) : 0;
          const label = `${bucket.startDate} · ${bucket.tokens.toLocaleString()} tokens${bucket.tokens === 0 ? " · no reported usage" : ""}`;
          return <button aria-label={label} className={`account-bar ${bucket.tokens ? "has-value" : "empty"}`} data-tooltip={label} key={bucket.startDate} style={{ "--bar-height": `${height}%` } as CSSProperties} title={label} type="button"><i /><span>{formatBackendDate(bucket.startDate)}</span></button>;
        })}</div>
      </div>
      <details className="account-daily-ledger" open>
        <summary><span>Exact daily ledger</span><small>Returned buckets · newest first</small></summary>
        <div className="account-daily-table-wrap"><table><thead><tr><th scope="col">Day</th><th scope="col">Tokens</th><th scope="col">State</th></tr></thead><tbody>{[...buckets].reverse().map((bucket) => <tr key={`row-${bucket.startDate}`}><th scope="row" title={bucket.startDate}>{formatBackendDate(bucket.startDate)}</th><td>{bucket.tokens.toLocaleString()}</td><td>{bucket.tokens > 0 ? "Observed usage" : "No reported usage"}</td></tr>)}</tbody></table></div>
      </details>
    </> : <div className="account-activity-empty"><CalendarDays size={16} /><div><strong>No daily buckets in the selected range</strong><p>The source returned account activity, but no daily token buckets for this range. This is an honest empty state.</p></div></div>}
    <div className="account-activity-facts"><AccountFact icon={Activity} label="Lifetime tokens" value={activity.lifetimeTokens?.toLocaleString() ?? "Unavailable"} /><AccountFact icon={TrendingUp} label="Reported peak day" value={activity.peakDailyTokens?.toLocaleString() ?? "Unavailable"} /><AccountFact icon={CalendarDays} label="Longest streak" value={activity.longestStreakDays === undefined ? "Unavailable" : `${activity.longestStreakDays} days`} /><AccountFact icon={Clock3} label="Longest running turn" value={formatAccountSeconds(activity.longestRunningTurnSec)} /></div>
    <p className="account-activity-note"><Info size={13} /> These buckets use the backend’s accounting and timezone semantics. They are kept separate from OTel/D1 telemetry totals, so the website never double-counts or presents them as official credit billing.</p>
  </section>;
}

function useRange() {
  // Keep the control local to the website card. It does not change the relay
  // request, create a D1 read, or add a polling loop.
  const [range, setRange] = useState<AccountActivityRange>(30);
  return [range, setRange] as const;
}

function AccountActivityStat({ icon: Icon, label, value, detail }: Readonly<{ icon: LucideIcon; label: string; value: string; detail: string }>) {
  return <div className="account-activity-stat"><Icon size={13} /><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function AccountFact({ icon: Icon, label, value }: Readonly<{ icon: LucideIcon; label: string; value: string }>) {
  return <div><Icon size={12} /><span>{label}</span><strong>{value}</strong></div>;
}

function formatRelativeTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Updated time unavailable";
  const age = Math.max(0, Date.now() - time);
  if (age < 60_000) return "Updated just now";
  if (age < 3_600_000) return `Updated ${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `Updated ${Math.floor(age / 3_600_000)}h ago`;
  return `Updated ${new Date(time).toLocaleDateString()}`;
}
