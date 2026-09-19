"use client";

import { useEffect, useMemo, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";

import { AccountActivityPanel } from "@/components/dashboard/account-activity";
import { absoluteResetTime, estimateUsagePace, isCodexAccountSnapshot, quotaFreshness, resetCountdown } from "@/lib/overlay/account";
import type { CodexAccountSnapshot, CodexQuotaLimit, CodexQuotaWindow } from "@/lib/overlay/contracts";

const LOCAL_ACCOUNT_URL = "http://127.0.0.1:14318/v1/account";
const LOCAL_REFRESH_MS = 45_000;

export function LocalCodexAccount() {
  const [snapshot, setSnapshot] = useState<CodexAccountSnapshot>();
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const read = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(LOCAL_ACCOUNT_URL, { cache: "no-store", credentials: "omit", mode: "cors", signal: controller.signal });
        const value: unknown = response.ok ? await response.json() : undefined;
        if (!active) return;
        if (isCodexAccountSnapshot(value)) {
          setSnapshot(value);
          setUnavailable(false);
        } else setUnavailable(true);
      } catch {
        if (active) setUnavailable(true);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void read();
    const refresh = window.setInterval(() => void read(), LOCAL_REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { active = false; window.clearInterval(refresh); window.clearInterval(clock); };
  }, []);

  const freshness = quotaFreshness(snapshot, now);
  const windows = useMemo(() => snapshot?.limits.flatMap((limit) => limit.windows.map((window) => ({ limit, window }))) ?? [], [snapshot]);
  const activity = snapshot?.activity;

  return <>
    <section className="local-account panel">
      <header>
        <span><Gauge size={14} /> Account quota</span>
        <small className={`local-account-freshness ${freshness.state}`}>{freshness.label}</small>
      </header>
      {!snapshot || unavailable || snapshot.status === "unavailable" || snapshot.status === "error" ? <div className="local-account-empty">
        <RefreshCw size={15} /><div><b>Quota unavailable</b><p>Codex Live must be running on this PC. Browser localhost policy may also block this local-only card.</p></div>
      </div> : <>
        <div className="local-account-meta">
          <span>{snapshot.planType ? `${snapshot.planType} plan` : "Plan unavailable"}</span>
          <span>{snapshot.ordinaryUsageAllowed === false ? "Included usage blocked" : snapshot.ordinaryUsageAllowed === true ? "Included usage available" : "Availability unknown"}</span>
          {snapshot.resetCredits ? <span>Banked resets: {snapshot.resetCredits.availableCount}</span> : null}
        </div>
        {windows.length ? <div className="quota-window-grid">{windows.map(({ limit, window }, index) => <QuotaWindow key={`${limit.limitId ?? "default"}-${window.slot}-${index}`} limit={limit} window={window} now={now} />)}</div> : <div className="local-account-empty"><Gauge size={15} /><div><b>Quota unavailable</b><p>The authenticated account returned no usage windows.</p></div></div>}
      </>}
    </section>
    <AccountActivityPanel activity={activity} observedAt={snapshot?.activityObservedAt} />
  </>;
}

function QuotaWindow({ limit, window, now }: Readonly<{ limit: CodexQuotaLimit; window: CodexQuotaWindow; now: number }>) {
  const countdown = resetCountdown(window.resetsAt, now);
  const absolute = absoluteResetTime(window.resetsAt);
  const pace = estimateUsagePace(window, now);
  const title = [limit.limitName, limit.normalModelSlug, absolute ? `Resets ${absolute}` : undefined].filter(Boolean).join(" · ");
  return <article className="quota-window" title={title}>
    <div><span>{window.label}{limit.normalModelSlug ? ` · ${limit.normalModelSlug}` : ""}</span><strong>{Math.round(window.remainingPercent)}% left</strong></div>
    <div className="quota-track"><i style={{ width: `${window.remainingPercent}%` }} /></div>
    <small>{countdown ? `Resets in ${countdown}` : "Reset unavailable"}{pace ? ` · Linear pace ${pace.deltaPercent > 0 ? "+" : ""}${Math.round(pace.deltaPercent)}%` : ""}</small>
    {pace?.projectedExhaustionAt ? <small>Projected exhaustion {new Date(pace.projectedExhaustionAt).toLocaleString()}</small> : null}
  </article>;
}
