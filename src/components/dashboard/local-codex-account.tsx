"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Gauge, RefreshCw } from "lucide-react";

import { AccountActivityPanel } from "@/components/dashboard/account-activity";
import { absoluteResetTime, estimateUsagePace, isCodexAccountSnapshot, quotaFreshness, resetCountdown } from "@/lib/overlay/account";
import type { CodexAccountSnapshot, CodexQuotaLimit, CodexQuotaWindow } from "@/lib/overlay/contracts";

const LOCAL_ACCOUNT_URL = "https://127.0.0.1:14318/v1/account";
const LOCAL_REFRESH_MS = 45_000;
const PAIRING_KEY = "codex-command-center.local-account-pairing.v1";

function readPairing() {
  try { return window.localStorage.getItem(PAIRING_KEY) ?? ""; } catch { return ""; }
}

function subscribeToPairing(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PAIRING_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PAIRING_KEY, onChange);
  };
}

export function LocalCodexAccount({ showActivity = true }: Readonly<{ showActivity?: boolean }>) {
  const pairing = useSyncExternalStore(subscribeToPairing, readPairing, () => "");
  const [pairingInput, setPairingInput] = useState("");
  const [pairingError, setPairingError] = useState("");
  const [account, setAccount] = useState<{ pairing: string; snapshot?: CodexAccountSnapshot }>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const read = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(LOCAL_ACCOUNT_URL, {
          cache: "no-store", credentials: "omit", mode: "cors", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${pairing}` },
        });
        const value: unknown = response.ok ? await response.json() : undefined;
        if (!active) return;
        setAccount({ pairing, snapshot: isCodexAccountSnapshot(value) ? value : undefined });
      } catch {
        if (active) setAccount({ pairing });
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void read();
    const refresh = window.setInterval(() => void read(), LOCAL_REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { active = false; window.clearInterval(refresh); window.clearInterval(clock); };
  }, [pairing]);

  function changePairing(value: string) {
    try {
      if (value) window.localStorage.setItem(PAIRING_KEY, value);
      else window.localStorage.removeItem(PAIRING_KEY);
      setPairingInput("");
      setPairingError("");
      window.dispatchEvent(new Event(PAIRING_KEY));
    } catch {
      setPairingError("This browser blocked local pairing storage.");
    }
  }

  const snapshot = pairing && account?.pairing === pairing ? account.snapshot : undefined;
  const freshness = quotaFreshness(snapshot, now);
  const windows = useMemo(() => snapshot?.limits.flatMap((limit) => limit.windows.map((window) => ({ limit, window }))) ?? [], [snapshot]);
  const availableResetDetails = snapshot?.resetCredits?.details?.filter((detail) => detail.status.toLowerCase() === "available") ?? [];
  const resetTypes = [...new Set(availableResetDetails.flatMap((detail) => detail.resetType ? [detail.resetType] : []))];
  const nextResetExpiry = availableResetDetails.flatMap((detail) => detail.expiresAt && detail.expiresAt * 1_000 > now ? [detail.expiresAt] : []).sort((left, right) => left - right)[0];
  const activity = snapshot?.activity;

  return <>
    <section className="local-account panel">
      <header>
        <span><Gauge size={14} /> Account quota</span>
        <small className={`local-account-freshness ${freshness.state}`}>{freshness.label}</small>
      </header>
      {!pairing ? <form className="local-account-empty" onSubmit={(event) => {
        event.preventDefault();
        const value = pairingInput.trim();
        if (/^[a-f0-9]{64}$/.test(value)) changePairing(value);
        else setPairingError("Paste the 64-character value from your local browser.token file.");
      }}>
        <div><b>Pair this browser with Codex Live</b><p>Trust the local relay certificate and enter the value from your browser.token file.</p>
          <input type="password" aria-label="Local account pairing code" autoComplete="off" value={pairingInput} onChange={(event) => setPairingInput(event.target.value)} />
          <button type="submit" className="platform-refresh-button">Pair browser</button>
        </div>
      </form> : !snapshot || snapshot.status === "unavailable" || snapshot.status === "error" ? <div className="local-account-empty">
        <RefreshCw size={15} /><div><b>Quota unavailable</b><p>Check that Codex Live is running, the relay certificate is trusted, and this site has local network permission.</p></div>
      </div> : <>
        <div className="local-account-meta">
          <span>{snapshot.planType ? `${snapshot.planType} plan` : "Plan unavailable"}</span>
          <span>{snapshot.ordinaryUsageAllowed === false ? "Included usage blocked" : snapshot.ordinaryUsageAllowed === true ? "Included usage available" : "Availability unknown"}</span>
          {snapshot.resetCredits ? <span>Banked resets: {snapshot.resetCredits.availableCount}</span> : null}
          {resetTypes.length ? <span>Returned available reset type(s): {resetTypes.join(", ")}</span> : null}
          {nextResetExpiry ? <span>Earliest returned available reset expires {new Date(nextResetExpiry * 1_000).toLocaleDateString()}</span> : null}
        </div>
        {windows.length ? <div className="quota-window-grid">{windows.map(({ limit, window }, index) => <QuotaWindow key={`${limit.limitId ?? "default"}-${window.slot}-${index}`} limit={limit} window={window} now={now} />)}</div> : <div className="local-account-empty"><Gauge size={15} /><div><b>Quota unavailable</b><p>The authenticated account returned no usage windows.</p></div></div>}
      </>}
      {pairing && <button type="button" className="platform-refresh-button" onClick={() => changePairing("")}>Forget local pairing</button>}
      {pairingError && <p role="alert">{pairingError}</p>}
    </section>
    {showActivity ? <AccountActivityPanel activity={activity} observedAt={snapshot?.activityObservedAt} /> : null}
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
