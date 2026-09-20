import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Activity, AlertTriangle, Check, ChevronDown, Circle, ExternalLink, EyeOff, Grip, LayoutGrid, Lock, Minus, Power, RefreshCw, Settings, Unlock, X } from "lucide-react";
import type { CodexQuotaWindow, OverlaySnapshot, TelemetryBufferHealth } from "../../../src/lib/overlay/contracts";
import { stackTokenSeries } from "../../../src/lib/telemetry/stacked-token-series";
import { tokenCompositionSegments, tokenVisualSeries } from "../../../src/lib/telemetry/token-visuals";
import { absoluteResetTime, estimateUsagePace, quotaFreshness, resetCountdown } from "../../../src/lib/overlay/account";
import { telemetryFreshness } from "./lib/freshness";
import { applyWindowSettings, configureHotkeys, controlRelay, fetchOverlay, getAutostart, getNativeState, hideOverlay, loadSettings, onNativeAction, openDashboard, quitOverlay, recoverOverlay, saveSettings, setAutostart, setCorner, setLayout, startDrag, startResize, type NativeState } from "./lib/native";
import { defaultDesktopOverlaySettings, overlayLayouts, overlayRanges, parseDesktopOverlaySettings, resolveLayout, shouldPollRemote, textColorValue, type DesktopOverlaySettings, type OverlayLayout, type OverlayRange } from "./lib/settings";
import { isUsableOverlaySnapshot, shouldReplaceOverlaySnapshot } from "./lib/snapshot";

type RelayState = "checking" | "online" | "offline" | "upstream-error" | "paused";
type HeaderMenu = "range" | "layout";
const clickThroughNotice = "Click-through enabled · Ctrl+Shift+O to regain control";
const overlayTokenSeries = [
  { key: "inputTokens", ...tokenVisualSeries[0] },
  { key: "outputTokens", ...tokenVisualSeries[1] },
  { key: "cachedTokens", ...tokenVisualSeries[2] },
  { key: "reasoningTokens", ...tokenVisualSeries[4] },
  { key: "toolTokens", ...tokenVisualSeries[5] },
] as const;

export function App() {
  const [settings, setSettings] = useState(defaultDesktopOverlaySettings);
  const [effectiveLayout, setEffectiveLayout] = useState<OverlayLayout>(defaultDesktopOverlaySettings.layout);
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>();
  const [relay, setRelay] = useState<RelayState>("checking");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu>();
  const [nativeState, setNativeState] = useState<NativeState>();
  const [message, setMessage] = useState<string>();
  const [ready, setReady] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const snapshotRef = useRef<OverlaySnapshot | undefined>(undefined);

  const refresh = useCallback(async (range: DesktopOverlaySettings["range"]) => {
    try {
      const next = await fetchOverlay(range);
      if (!shouldReplaceOverlaySnapshot(snapshotRef.current, next)) {
        setRelay("upstream-error");
        setMessage("Snapshot degraded · showing last good data");
        return;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setRelay("online");
      setMessage(undefined);
    } catch (error) {
      const detail = String(error);
      const hasLastGoodSnapshot = snapshotRef.current ? isUsableOverlaySnapshot(snapshotRef.current) : false;
      setRelay(detail.includes("snapshot_unavailable") ? "upstream-error" : "offline");
      setMessage(detail.includes("snapshot_unavailable")
        ? hasLastGoodSnapshot ? "Snapshot unavailable · showing last good data" : "Command Center snapshot unavailable"
        : hasLastGoodSnapshot ? "Relay offline · showing last good data" : "Relay offline");
    }
  }, []);

  const updateSettings = useCallback(async (partial: Partial<DesktopOverlaySettings>, resize = false) => {
    const next = parseDesktopOverlaySettings({ ...settings, ...partial });
    const enablingClickThrough = partial.clickThrough === true && !settings.clickThrough;
    setSettings(next);
    setMessage(enablingClickThrough ? clickThroughNotice : undefined);
    try {
      if (enablingClickThrough) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      if (partial.showHideHotkey !== undefined || partial.clickThroughHotkey !== undefined) {
        setNativeState(await configureHotkeys(next.showHideHotkey, next.clickThroughHotkey));
      }
      if (partial.startWithWindows !== undefined) await setAutostart(next.startWithWindows);
      if (partial.corner !== undefined && next.corner !== "free") await setCorner(next.corner);
      if (resize || partial.layout !== undefined) await setLayout(next.layout);
      const applied = await applyWindowSettings(next);
      setNativeState(applied);
      await saveSettings(next);
      if (partial.range !== undefined || partial.followChatgpt !== undefined) {
        if (shouldPollRemote(next.followChatgpt, applied.chatgptRunning, document.visibilityState !== "hidden")) await refresh(next.range);
        else setRelay("paused");
      }
    } catch (error) {
      setMessage(safeNativeMessage(error));
      if (next.clickThrough) {
        const safe = { ...next, clickThrough: false };
        setSettings(safe);
        await saveSettings(safe).catch(() => undefined);
      }
    }
  }, [refresh, settings]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (message !== clickThroughNotice) return;
    const timer = window.setTimeout(() => setMessage((current) => current === clickThroughNotice ? undefined : current), 8_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    void (async () => {
      const stored = parseDesktopOverlaySettings(await loadSettings().catch(() => undefined));
      const autostart = await getAutostart().catch(() => stored.startWithWindows);
      const hydrated = { ...stored, startWithWindows: autostart };
      setSettings(hydrated);
      let chatgptRunning = true;
      try {
        const shortcuts = await configureHotkeys(hydrated.showHideHotkey, hydrated.clickThroughHotkey);
        setNativeState(shortcuts);
        const applied = await applyWindowSettings({ ...hydrated, clickThrough: hydrated.clickThrough && shortcuts.shortcutsReady });
        chatgptRunning = applied.chatgptRunning;
        setNativeState(applied);
      } catch (error) {
        setMessage(safeNativeMessage(error));
        setSettings((current) => ({ ...current, clickThrough: false }));
        const current = await getNativeState().catch(() => undefined);
        chatgptRunning = current?.chatgptRunning ?? true;
        setNativeState(current);
      }
      setReady(true);
      if (shouldPollRemote(hydrated.followChatgpt, chatgptRunning, document.visibilityState !== "hidden")) await refresh(hydrated.range);
      else setRelay("paused");
    })();
  }, [refresh]);

  useEffect(() => {
    if (!ready || !shouldPollRemote(settings.followChatgpt, nativeState?.chatgptRunning ?? true, overlayVisible)) {
      return;
    }
    const timer = window.setInterval(() => void refresh(settings.range), settings.refreshSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [nativeState?.chatgptRunning, overlayVisible, ready, refresh, settings.followChatgpt, settings.range, settings.refreshSeconds]);

  useEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState !== "hidden";
      setOverlayVisible(visible);
      if (visible && shouldPollRemote(settings.followChatgpt, nativeState?.chatgptRunning ?? true, true)) void refresh(settings.range);
      else setRelay("paused");
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [nativeState?.chatgptRunning, refresh, settings.followChatgpt, settings.range]);

  useEffect(() => {
    const resize = () => setEffectiveLayout(resolveLayout(window.innerWidth, window.innerHeight, settings.layout));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [settings.layout]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen || contextOpen || headerMenu) { setSettingsOpen(false); setContextOpen(false); setHeaderMenu(undefined); }
      else void hideOverlay();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [contextOpen, headerMenu, settingsOpen]);

  useEffect(() => {
    let unlisten: undefined | (() => void);
    void onNativeAction((action) => {
      if (action.kind === "show-settings") setSettingsOpen(true);
      else if (action.kind === "recover-overlay") void updateSettings({ clickThrough: false, lockPosition: false });
      else if (action.kind === "layout") void updateSettings({ layout: action.value }, true);
      else if (action.kind === "click-through") void updateSettings({ clickThrough: action.value });
      else if (action.kind === "lock-position") void updateSettings({ lockPosition: action.value });
      else if (action.kind === "always-on-top") void updateSettings({ alwaysOnTop: action.value });
      else if (action.kind === "chatgpt-running") {
        setNativeState((current) => current ? { ...current, chatgptRunning: action.value } : current);
        if (action.value) void refresh(settings.range);
        else setRelay("paused");
      } else if (action.kind === "relay-status") {
        setNativeState((current) => current ? { ...current, relayStatus: action.value, relayOwned: action.owned } : current);
        if (action.value === "online" || action.value === "external") void refresh(settings.range);
        else if (action.value === "offline" || action.value === "error") setRelay("offline");
      }
    }).then((dispose) => { unlisten = dispose; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh, settings.range, updateSettings]);

  const toggleDensityLayout = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("button, input, select")) return;
    const layout = settings.layout === "mini" ? "standard" : "mini";
    void updateSettings({ layout }, true);
  };

  const drag = (event: MouseEvent) => {
    if (event.button !== 0 || settings.lockPosition || (event.target as HTMLElement).closest("button, input, select")) return;
    void startDrag(settings.edgeSnapping);
  };

  const dataPathHealthy = (relay === "online" || relay === "paused") && snapshot?.health.telemetry === "connected" && snapshot.health.d1 === "connected";
  const freshness = telemetryFreshness(snapshot?.lastTelemetryAt, undefined, dataPathHealthy);
  const colors = { "--text": textColorValue(settings), "--accent": settings.accentColor, "--surface-opacity": settings.opacity / 100, "--font-scale": settings.fontScale / 100 } as CSSProperties;

  return <main className={`app layout-${effectiveLayout} density-${settings.density} effect-${settings.effect} surface-${settings.surface} ${settings.clickThrough ? "click-through-enabled" : ""}`} style={colors} onContextMenu={(event) => { event.preventDefault(); setHeaderMenu(undefined); setContextOpen(true); }}>
    <section className="instrument">
      {!settings.lockPosition && !settings.clickThrough ? <ResizeHandles /> : null}
      <header className="drag-region" title="Drag to move Codex Live" onMouseDown={drag} onDoubleClick={toggleDensityLayout}>
        <div className="brand" title="Codex Live · privacy-safe observed telemetry"><Activity size={13} /><b>CODEX LIVE</b><span className="brand-mode">OBSERVED</span><StatusDot state={relay === "online" ? freshness.state : relay === "checking" || relay === "paused" ? "unavailable" : "stale"} />{settings.clickThrough ? <span className="click-through-indicator"><EyeOff size={9} />Pass</span> : null}</div>
        <div className="header-meta">
          <div className="header-control"><button className="range-trigger" aria-label="Select telemetry range" aria-expanded={headerMenu === "range"} onClick={() => setHeaderMenu((current) => current === "range" ? undefined : "range")}>{settings.range.toUpperCase()}</button>{headerMenu === "range" ? <div className="header-selector range-selector">{overlayRanges.map((range) => <button className={settings.range === range ? "active" : ""} key={range} onClick={() => { setHeaderMenu(undefined); void updateSettings({ range }); }}>{range.toUpperCase()}</button>)}</div> : null}</div>
          <div className="header-control"><button aria-label="Select overlay layout" aria-expanded={headerMenu === "layout"} title={`Layout · ${titleCase(settings.layout)}`} onClick={() => setHeaderMenu((current) => current === "layout" ? undefined : "layout")}><LayoutGrid size={12} /></button>{headerMenu === "layout" ? <div className="header-selector layout-selector">{overlayLayouts.map((layout) => <button className={settings.layout === layout ? "active" : ""} key={layout} onClick={() => { setHeaderMenu(undefined); void updateSettings({ layout }, true); }}>{titleCase(layout)}</button>)}</div> : null}</div>
          <button title={settings.lockPosition ? "Unlock position" : "Lock position"} onClick={() => void updateSettings({ lockPosition: !settings.lockPosition })}>{settings.lockPosition ? <Lock size={12} /> : <Grip size={12} />}</button><button title="Settings" onClick={() => setSettingsOpen(true)}><Settings size={12} /></button><button title="Hide overlay" onClick={() => void hideOverlay()}><Minus size={12} /></button>
        </div>
      </header>

      {(relay === "offline" || relay === "upstream-error") && !snapshot ? <OfflineState kind={relay} openSettings={() => setSettingsOpen(true)} retry={() => void refresh(settings.range)} /> : relay === "paused" && !snapshot ? <PausedState /> : <OverlayContent snapshot={snapshot} relay={relay} layout={effectiveLayout} freshness={freshness} now={now} />}

      {message ? <div className="message"><AlertTriangle size={11} /><span>{message}</span><button aria-label="Dismiss" onClick={() => setMessage(undefined)}><X size={11} /></button></div> : null}
      {settingsOpen ? <SettingsPanel settings={settings} nativeState={nativeState} close={() => setSettingsOpen(false)} update={updateSettings} refresh={() => void refresh(settings.range)} report={(error) => setMessage(safeNativeMessage(error))} /> : null}
      {contextOpen ? <ContextMenu settings={settings} close={() => setContextOpen(false)} update={updateSettings} /> : null}
    </section>
  </main>;
}

function OverlayContent({ snapshot, relay, layout, freshness, now }: Readonly<{ snapshot?: OverlaySnapshot; relay: RelayState; layout: OverlayLayout; freshness: ReturnType<typeof telemetryFreshness>; now: number }>) {
  if (!snapshot) return <div className="overlay-content"><div className="loading"><RefreshCw className="spin" size={15} />Retrieving private snapshot…</div></div>;
  const session = snapshot.latestSession;
  const summary = snapshot.windowSummary;
  if (layout === "strip") return <div className="overlay-content overlay-content-strip"><div className="strip-content"><Identity session={session} /><StripQuota account={snapshot.codexAccount} /><Metric short="IN" value={summary.inputTokens} /><Metric short="TOOLS" value={summary.completedTools} /><HealthLabel relay={relay} freshness={freshness} /></div></div>;
  if (layout === "mini") return <div className="overlay-content overlay-content-mini">
    <div className="identity-row"><Identity session={session} /><QuotaFreshness account={snapshot.codexAccount} now={now} /></div>
    <MiniQuota account={snapshot.codexAccount} now={now} summary={summary} />
    <footer><HealthChip label="Relay" status={relay === "online" ? "connected" : "degraded"} /><HealthChip label="Telemetry" status={snapshot.health.telemetry} /><HealthChip label="D1" status={snapshot.health.d1} /><BufferStatus buffer={snapshot.telemetryBuffer} /></footer>
  </div>;
  return <div className={`overlay-content overlay-content-${layout}`}>
    <div className="identity-row"><Identity session={session} /><span className={`freshness ${freshness.state}`}>OTel {freshness.label}</span></div>
    {layout === "standard" ? <ObservationRail session={session} summary={summary} lastTelemetryAt={snapshot.lastTelemetryAt} /> : null}
    <QuotaPanel account={snapshot.codexAccount} now={now} />
    <PricingPanel pricing={snapshot.pricing} />
    <div className="metric-grid primary"><Metric label="Input" value={summary.inputTokens} /><Metric label="Output" value={summary.outputTokens} /><Metric label="Cached" value={summary.cachedTokens} optionalMini /><Metric label="Reasoning" value={summary.reasoningTokens} /><Metric label="Tool tokens" value={summary.toolTokens} optionalMini /><Metric label="TTFT" value={summary.averageTtftMs} duration /><Metric label="Tools" value={summary.completedTools} /><Metric label="Errors" value={summary.failures} /></div>
    {layout === "expanded" ? <Expanded snapshot={snapshot} now={now} /> : null}
    <footer><HealthChip label="Relay" status={relay === "online" ? "connected" : "degraded"} /><HealthChip label="Telemetry" status={snapshot.health.telemetry} /><HealthChip label="D1" status={snapshot.health.d1} /><BufferStatus buffer={snapshot.telemetryBuffer} /></footer>
  </div>;
}

function Expanded({ snapshot, now }: Readonly<{ snapshot: OverlaySnapshot; now: number }>) {
  const session = snapshot.latestSession;
  return <div className="expanded-content">
    <ObservedOperations session={session} summary={snapshot.windowSummary} lastTelemetryAt={snapshot.lastTelemetryAt} />
    <AccountDetails account={snapshot.codexAccount} now={now} />
    <section><SectionTitle title="Token trend" note={snapshot.range.toUpperCase()} /><TokenTrendChart points={snapshot.tokenTrend} /></section>
    <div className="split"><section><SectionTitle title="Token composition" /><Composition summary={snapshot.windowSummary} /></section><section><SectionTitle title="Model mix" /><Distribution items={snapshot.modelDistribution} /></section></div>
    <div className="split"><section><SectionTitle title="Reasoning mix" /><Distribution items={snapshot.reasoningDistribution} /></section><section><SectionTitle title="Latest session" note={session ? shortAge(session.lastSeenAt) : undefined} /><div className="session-line"><span>{session ? `${session.completedTools} tools` : "No session"}</span><span>{session ? `${session.toolFailures ?? 0} failed` : "—"}</span></div></section></div>
    <section><SectionTitle title="Delivery" note={snapshot.delivery?.repository} /><div className="delivery"><HealthChip label="GitHub" status={snapshot.health.github} /><HealthChip label={snapshot.delivery?.latestBuild?.name ?? "CI"} status={snapshot.health.ci} /><span>{snapshot.delivery?.latestBuild?.status ?? "Unavailable"}</span></div></section>
  </div>;
}

function primaryWindows(account: OverlaySnapshot["codexAccount"]) {
  return account?.limits[0]?.windows ?? [];
}

function StripQuota({ account }: Readonly<{ account?: OverlaySnapshot["codexAccount"] }>) {
  const windows = primaryWindows(account);
  if (!windows.length) return <div className="strip-quota unavailable">Quota unavailable</div>;
  return <div className="strip-quota">{windows.slice(0, 2).map((window) => <span key={window.slot}>{window.kind === "5h" ? "5H" : window.kind === "7d" ? "7D" : window.label} <b>{Math.round(window.remainingPercent)}%</b></span>)}</div>;
}

function QuotaFreshness({ account, now }: Readonly<{ account?: OverlaySnapshot["codexAccount"]; now: number }>) {
  const freshness = quotaFreshness(account, now);
  return <span className={`freshness ${freshness.state}`}>Quota {freshness.label}</span>;
}

function MiniQuota({ account, now, summary }: Readonly<{ account?: OverlaySnapshot["codexAccount"]; now: number; summary: OverlaySnapshot["windowSummary"] }>) {
  const windows = primaryWindows(account);
  return <div className="mini-quota">
    <div>{windows.length ? windows.slice(0, 2).map((window) => <span key={window.slot}><small>{window.kind === "5h" ? "5H" : window.kind === "7d" ? "7D" : window.label}</small><b>{Math.round(window.remainingPercent)}%</b><i>{resetCountdown(window.resetsAt, now) ?? "—"}</i></span>) : <strong>Quota unavailable</strong>}</div>
    <p>Input {numberLabel(summary.inputTokens)} · Tools {numberLabel(summary.completedTools)} · Errors {numberLabel(summary.failures)}</p>
  </div>;
}

function QuotaPanel({ account, now }: Readonly<{ account?: OverlaySnapshot["codexAccount"]; now: number }>) {
  const windows = primaryWindows(account);
  if (!windows.length) return <div className="quota-panel unavailable"><span>Quota unavailable</span><small>{account?.status === "error" ? "App-server error" : "Local Codex account data unavailable"}</small></div>;
  return <div className="quota-panel">{windows.slice(0, 2).map((window) => <QuotaRow key={window.slot} window={window} now={now} />)}</div>;
}

function PricingPanel({ pricing }: Readonly<{ pricing?: OverlaySnapshot["pricing"] }>) {
  const available = pricing?.status === "available" || pricing?.status === "partial";
  return <section className={`pricing-panel ${pricing?.status ?? "unavailable"}`} title={pricing?.note ?? "API-equivalent pricing is unavailable for this window."}>
    <div className="section-title"><b>API-equivalent usage</b><span>{pricing?.status === "partial" ? "Partial coverage" : pricing?.status === "available" ? "All observed models" : "Unavailable"}</span></div>
    <div className="pricing-main"><div><small>USD equivalent</small><strong>{available && pricing?.usdEquivalent !== undefined ? `$${pricing.usdEquivalent}` : "Unavailable"}</strong></div><div><small>Codex credits</small><strong>{available && pricing?.apiCredits !== undefined ? pricing.apiCredits : "—"}</strong></div><div><small>Coverage</small><strong>{pricing?.coveragePercent === undefined ? "—" : `${pricing.coveragePercent}%`}</strong></div></div>
    {pricing?.byModel.length ? <details className="pricing-details"><summary>Model math <span>+</span></summary><div>{pricing.byModel.map((model) => <div key={model.model}><span><b>{model.displayName}</b><small>{model.model} · {model.eventCount.toLocaleString()} events</small></span><strong>{model.status === "priced" ? `$${model.usdEquivalent}` : "Unpriced"}</strong></div>)}</div></details> : null}
    <p>Standard token rates · feature charges excluded · reasoning is not double-counted.</p>
  </section>;
}

function QuotaRow({ window, now }: Readonly<{ window: CodexQuotaWindow; now: number }>) {
  const countdown = resetCountdown(window.resetsAt, now);
  const absolute = absoluteResetTime(window.resetsAt);
  return <div className="quota-row" title={absolute ? `${window.label} resets ${absolute}` : `${window.label} reset unavailable`}><span>{window.label}</span><i><b style={{ width: `${window.remainingPercent}%` }} /></i><strong>{Math.round(window.remainingPercent)}% left</strong><small>{countdown ? `${countdown}` : "—"}</small></div>;
}

function AccountDetails({ account, now }: Readonly<{ account?: OverlaySnapshot["codexAccount"]; now: number }>) {
  if (!account) return null;
  const extraLimits = account.limits.slice(1);
  const credits = account.limits.map((limit) => limit.credits).find(Boolean);
  const activity = account.activity;
  return <>
    <section><SectionTitle title="Account quota" note={account.planType ? `${account.planType} plan` : undefined} /><div className="account-facts"><span>Included usage<b>{account.ordinaryUsageAllowed === false ? "Blocked" : account.ordinaryUsageAllowed === true ? "Available" : "Unknown"}</b></span><span>Usage credits<b>{credits?.unlimited ? "Unlimited" : credits?.balance ? `${credits.balance} credits` : "Unavailable"}</b></span><span>Banked resets<b>{account.resetCredits ? account.resetCredits.availableCount : "Unavailable"}</b></span></div></section>
    {account.limits.flatMap((limit) => limit.windows.map((window) => ({ limit, window }))).map(({ limit, window }, index) => <section key={`${limit.limitId ?? "default"}-${window.slot}-${index}`}><SectionTitle title={limit.normalModelSlug ?? limit.limitName ?? window.label} note={window.label} /><QuotaDetail window={window} now={now} /></section>)}
    {extraLimits.length ? <section><SectionTitle title="Additional limit pools" note={`${extraLimits.length}`} /><div className="extra-limits">{extraLimits.map((limit) => <span key={limit.limitId ?? limit.limitName}><b>{limit.limitName ?? limit.limitId ?? "Usage limit"}</b><small>{limit.normalModelSlug ?? "Model association unavailable"}</small></span>)}</div></section> : null}
    {activity ? <section><SectionTitle title="Account Activity" note="OpenAI backend" /><div className="account-facts"><span>Lifetime tokens<b>{numberLabel(activity.lifetimeTokens)}</b></span><span>Current streak<b>{activity.currentStreakDays === undefined ? "Unavailable" : `${activity.currentStreakDays}d`}</b></span><span>Peak daily<b>{numberLabel(activity.peakDailyTokens)}</b></span></div><p className="account-note">Daily activity bucket timezone semantics are backend-defined and are not merged with OTel history.</p></section> : null}
  </>;
}

function QuotaDetail({ window, now }: Readonly<{ window: CodexQuotaWindow; now: number }>) {
  const pace = estimateUsagePace(window, now);
  const countdown = resetCountdown(window.resetsAt, now);
  const projected = pace?.projectedExhaustionAt ? new Date(pace.projectedExhaustionAt).toLocaleString() : undefined;
  return <div className="quota-detail"><div><i><b style={{ width: `${window.remainingPercent}%` }} /></i><strong>{Math.round(window.remainingPercent)}% left</strong></div><span>{countdown ? `Resets in ${countdown}` : "Reset unavailable"}</span>{pace ? <span>Linear pace {pace.deltaPercent > 0 ? "+" : ""}{Math.round(pace.deltaPercent)}%</span> : null}{projected ? <span title={projected}>Projected {projected}</span> : null}</div>;
}

function Identity({ session }: Readonly<{ session?: OverlaySnapshot["latestSession"] }>) { return <div className="identity" title={session ? `Latest observed session · ${session.lastSeenAt}` : "No observed session"}><span>{friendlyModel(session?.model)}</span><i>·</i><small>{session?.reasoningEffort ?? "effort unavailable"}</small></div>; }

function ObservationRail({ session, summary, lastTelemetryAt }: Readonly<{ session?: OverlaySnapshot["latestSession"]; summary: OverlaySnapshot["windowSummary"]; lastTelemetryAt?: string }>) {
  const observed = Boolean(session);
  const observedAt = session?.lastSeenAt ?? lastTelemetryAt;
  return <div className={`observation-rail ${observed ? "observed" : "unavailable"}`} title="This is the latest observed telemetry, not a claim about current agent state.">
    <StatusDot state={observed ? "connected" : "unavailable"} />
    <div><b>{observed ? "Last session observed" : "No session observed"}</b><small>{observed ? `${friendlyModel(session?.model)} · ${session?.reasoningEffort ?? "effort unavailable"}` : "No bounded session summary is available."}</small></div>
    <time>{observedAt ? shortAge(observedAt) : "Unavailable"}</time>
    <span className="observation-facts">{numberLabel(summary.completedTools)} tools · {numberLabel(summary.approvals)} approvals · {numberLabel(summary.failures)} failed</span>
  </div>;
}

function ObservedOperations({ session, summary, lastTelemetryAt }: Readonly<{ session?: OverlaySnapshot["latestSession"]; summary: OverlaySnapshot["windowSummary"]; lastTelemetryAt?: string }>) {
  const observed = Boolean(session);
  const observedAt = session?.lastSeenAt ?? lastTelemetryAt;
  return <section className={`observed-panel ${observed ? "observed" : "unavailable"}`}>
    <SectionTitle title="Observed operations" note="privacy-safe" />
    <div className="observed-card"><StatusDot state={observed ? "connected" : "unavailable"} /><div><strong>{observed ? "Session evidence available" : "No session evidence"}</strong><small>{observedAt ? `Last observed ${shortAge(observedAt)}` : "Telemetry timestamp unavailable"}</small></div><span>{observed ? friendlyModel(session?.model) : "Unavailable"}</span></div>
    <div className="observed-facts"><span>Events<b>{numberLabel(summary.events)}</b></span><span>Tools<b>{numberLabel(summary.completedTools)}</b></span><span>Approvals<b>{numberLabel(summary.approvals)}</b></span><span>Failures<b>{numberLabel(summary.failures)}</b></span></div>
    <p className="privacy-note">Observed aggregates only. Prompts, commands, tool arguments, and agent-graph details are intentionally not emitted.</p>
  </section>;
}

function ResizeHandles() {
  const directions = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;
  return <>{directions.map((direction) => <i aria-hidden="true" className={`resize-handle resize-${direction}`} key={direction} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); void startResize(direction); }} />)}</>;
}
function Metric({ label, short, value, duration, optionalMini }: Readonly<{ label?: string; short?: string; value?: number; duration?: boolean; optionalMini?: boolean }>) { return <div className={`metric ${optionalMini ? "optional-mini" : ""}`}><span>{short ?? label}</span><b>{duration ? durationLabel(value) : numberLabel(value)}</b></div>; }
function StatusDot({ state }: Readonly<{ state: string }>) { return <Circle className={`status-dot ${state}`} fill="currentColor" size={6} />; }
function HealthChip({ label, status }: Readonly<{ label: string; status: string }>) { return <span className="health-chip"><StatusDot state={status} />{label}</span>; }
function BufferStatus({ buffer }: Readonly<{ buffer?: TelemetryBufferHealth }>) {
  if (!buffer) return null;
  const state = buffer.replayState === "replaying" ? "replaying" : buffer.replayState === "degraded" ? "degraded" : buffer.queuedBatches ? "buffering" : "connected";
  const label = buffer.replayState === "replaying" ? `OTel replaying${buffer.queuedBatches ? ` · ${buffer.queuedBatches}` : ""}` : buffer.queuedBatches ? `OTel buffered · ${buffer.queuedBatches}` : buffer.droppedBatches ? `OTel degraded · ${buffer.droppedBatches} dropped` : "OTel live";
  const title = `${buffer.queuedBatches} queued batch${buffer.queuedBatches === 1 ? "" : "es"}${buffer.oldestQueuedAgeSeconds === undefined ? "" : ` · oldest ${buffer.oldestQueuedAgeSeconds}s`}${buffer.droppedBatches ? ` · ${buffer.droppedBatches} dropped` : ""}`;
  return <span className="buffer-status" title={title}><StatusDot state={state} />{label}</span>;
}
function HealthLabel({ relay, freshness }: Readonly<{ relay: RelayState; freshness: ReturnType<typeof telemetryFreshness> }>) { const healthy = relay === "online" && freshness.state !== "stale"; return <div className={`strip-health ${healthy ? "connected" : "degraded"}`}><StatusDot state={healthy ? "connected" : "degraded"} />{healthy ? freshness.label : "Attention"}</div>; }
function SectionTitle({ title, note }: Readonly<{ title: string; note?: string }>) { return <div className="section-title"><b>{title}</b>{note ? <span title={note}>{note}</span> : null}</div>; }

function TokenTrendChart({ points }: Readonly<{ points: OverlaySnapshot["tokenTrend"] }>) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const values = points.slice(-30);
  const totals = values.map(tokenPointTotal);
  if (!totals.some((point) => point > 0)) return <div className="chart-empty">No samples</div>;

  const width = 320;
  const height = 48;
  const top = 3;
  const bottom = height - 4;
  const maximum = Math.max(...totals, 1);
  const x = (index: number) => values.length === 1 ? width / 2 : index / (values.length - 1) * width;
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  const stacked = stackTokenSeries(values, overlayTokenSeries, overlayTokenValue);
  const activePoint = activeIndex === undefined ? undefined : values[activeIndex];
  const hitWidth = values.length === 1 ? width : Math.max(8, width / (values.length - 1));

  return <div className="trend-chart">
    <svg aria-label="Color-coded measured token activity by time bucket" className="spark" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`} onMouseLeave={() => setActiveIndex(undefined)}>
      {stacked.map(({ definition, base, topValues }) => <path className="spark-series-area" d={stackedAreaPath(topValues, base, x, y)} fill={definition.color} fillOpacity={0.3} key={definition.id} stroke={definition.color} strokeOpacity={0.84} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />)}
      <path aria-label="Total measured tokens" className="spark-total-line" d={linePath(totals, x, y)} />
      {activeIndex !== undefined ? <line className="spark-hover-line" x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} /> : null}
      {values.map((point, index) => <rect aria-label={tokenTrendTooltip(point)} className="spark-hit" height={height} key={`${point.label}-${index}`} tabIndex={0} width={hitWidth} x={x(index) - hitWidth / 2} y={0} onBlur={() => setActiveIndex(undefined)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)} />)}
    </svg>
    <div aria-live="polite" className={`trend-tooltip ${activePoint ? "visible" : ""}`}>{activePoint ? tokenTrendTooltip(activePoint) : "Stacked fields · band thickness = actual tokens"}</div>
    <div className="trend-legend">{overlayTokenSeries.map((series) => <span key={series.id}><i style={{ background: series.color }} />{series.label}</span>)}</div>
  </div>;
}

function linePath(values: number[], x: (index: number) => number, y: (value: number) => number) {
  return values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
}

function stackedAreaPath(topValues: number[], baseValues: number[], x: (index: number) => number, y: (value: number) => number) {
  const topPath = linePath(topValues, x, y);
  const basePath = baseValues.map((value, index) => `${x(index)},${y(value)}`).reverse().join(" L");
  return `${topPath} L${basePath} Z`;
}

function overlayTokenValue(point: OverlaySnapshot["tokenTrend"][number] | OverlaySnapshot["windowSummary"], key: typeof overlayTokenSeries[number]["key"]) {
  return point[key] ?? 0;
}

function tokenPointTotal(point: OverlaySnapshot["tokenTrend"][number]) {
  return overlayTokenSeries.reduce((sum, series) => sum + overlayTokenValue(point, series.key), 0);
}

function tokenTrendTooltip(point: OverlaySnapshot["tokenTrend"][number]) {
  const total = tokenPointTotal(point);
  const fields = overlayTokenSeries.filter((series) => overlayTokenValue(point, series.key) > 0).map((series) => `${series.label} ${numberLabel(overlayTokenValue(point, series.key))}`);
  return [point.label, `${numberLabel(total)} tokens`, ...fields].join(" · ");
}

function Composition({ summary }: Readonly<{ summary: OverlaySnapshot["windowSummary"] }>) {
  const values = overlayTokenSeries.map((series) => ({ ...series, value: overlayTokenValue(summary, series.key) })).filter((item) => item.value > 0);
  const { items, total } = tokenCompositionSegments(values);
  if (!total) return <div className="chart-empty">No samples</div>;
  return <div className="composition-wrap">
    <div className="composition" aria-label={`Input, output, cached, reasoning, and tool measured fields, ${numberLabel(total)} displayed tokens`} role="img" title={`Displayed measured fields total: ${numberLabel(total)} tokens`}>{items.map((item) => <i aria-label={`${item.label}: ${numberLabel(item.value)} tokens`} key={item.id} style={{ background: item.color, flex: `0 0 ${item.fraction * 100}%` }} title={`${item.label}: ${numberLabel(item.value)} tokens`} />)}</div>
    <div className="composition-legend">{items.map((item) => <span key={item.id} title={`${item.label}: ${numberLabel(item.value)} tokens`}><i style={{ background: item.color }} />{item.label}</span>)}</div>
  </div>;
}

function Distribution({ items }: Readonly<{ items: OverlaySnapshot["modelDistribution"] }>) {
  const visible = items.slice(0, 3), max = Math.max(1, ...visible.map((item) => item.count));
  return visible.length ? <div className="distribution">{visible.map((item) => <div key={item.label}><span title={item.label}>{friendlyModel(item.label)}</span><i><b style={{ width: `${item.count / max * 100}%` }} /></i></div>)}</div> : <div className="chart-empty">Unavailable</div>;
}

function OfflineState({ kind, retry, openSettings }: Readonly<{ kind: Extract<RelayState, "offline" | "upstream-error">; retry: () => void; openSettings: () => void }>) { const upstream = kind === "upstream-error"; return <div className="offline"><div><Power size={18} /><h1>{upstream ? "Snapshot unavailable" : "Relay offline"}</h1><p>{upstream ? "The local relay is running, but the bounded Command Center snapshot could not be read." : "Start or restart the Codex telemetry relay to resume live analytics."}</p></div><div><button onClick={retry}><RefreshCw size={12} />Retry</button><button onClick={openSettings}><Settings size={12} />Settings</button></div></div>; }
function PausedState() { return <div className="offline"><div><Power size={18} /><h1>Following ChatGPT</h1><p>Remote snapshot polling is paused until ChatGPT is running and the overlay is visible.</p></div></div>; }

function SettingsPanel({ settings, nativeState, close, update, refresh, report }: Readonly<{ settings: DesktopOverlaySettings; nativeState?: NativeState; close: () => void; update: (partial: Partial<DesktopOverlaySettings>, resize?: boolean) => Promise<void>; refresh: () => void; report: (error: unknown) => void }>) {
  return <aside className="settings-panel"><header><div><Settings size={13} /><b>Overlay settings</b></div><button onClick={close}><X size={14} /></button></header><div className="settings-scroll">
    <SettingsGroup title="Appearance"><Select label="Effect" value={settings.effect} values={["translucent", "mica", "acrylic", "solid"]} change={(value) => void update({ effect: value as DesktopOverlaySettings["effect"] })} /><Select label="Surface" value={settings.surface} values={["dark", "light"]} change={(value) => void update({ surface: value as DesktopOverlaySettings["surface"] })} /><Range label={`Opacity · ${settings.opacity}%`} value={settings.opacity} min={20} max={100} change={(value) => void update({ opacity: value })} /><Select label="Text" value={settings.textColor} values={["auto", "white", "black", "red", "amber", "cyan", "custom"]} change={(value) => void update({ textColor: value as DesktopOverlaySettings["textColor"] })} /><Color label="Accent" value={settings.accentColor} change={(value) => void update({ accentColor: value })} />{settings.textColor === "custom" ? <Color label="Custom text" value={settings.customTextColor} change={(value) => void update({ customTextColor: value })} /> : null}<Range label={`Font · ${settings.fontScale}%`} value={settings.fontScale} min={80} max={150} change={(value) => void update({ fontScale: value })} /><Select label="Density" value={settings.density} values={["tight", "comfortable"]} change={(value) => void update({ density: value as DesktopOverlaySettings["density"] })} /></SettingsGroup>
    <SettingsGroup title="Window"><Select label="Layout" value={settings.layout} values={[...overlayLayouts]} change={(value) => void update({ layout: value as OverlayLayout }, true)} /><Select label="Position" value={settings.corner} values={["free", "top-left", "top-right", "bottom-left", "bottom-right"]} change={(value) => void update({ corner: value as DesktopOverlaySettings["corner"] })} /><Toggle label="Lock position" checked={settings.lockPosition} change={(value) => void update({ lockPosition: value })} /><Toggle label="Edge snapping" checked={settings.edgeSnapping} change={(value) => void update({ edgeSnapping: value })} /><Toggle label="Always on top" checked={settings.alwaysOnTop} change={(value) => void update({ alwaysOnTop: value })} /><Toggle label="Show in taskbar" checked={settings.showInTaskbar} change={(value) => void update({ showInTaskbar: value })} /><Toggle label="Click through" checked={settings.clickThrough} disabled={!nativeState?.shortcutsReady} change={(value) => void update({ clickThrough: value })} /></SettingsGroup>
    <SettingsGroup title="Behavior"><Toggle label="Follow ChatGPT" checked={settings.followChatgpt} change={(value) => void update({ followChatgpt: value })} /><p>Detected host: <b>{nativeState?.chatgptRunning ? "ChatGPT running" : "ChatGPT closed"}</b></p><Select label="Local refresh" value={String(settings.refreshSeconds)} values={["5", "10", "15", "30", "60"]} labels={["5 seconds", "10 seconds", "15 seconds", "30 seconds", "60 seconds"]} change={(value) => void update({ refreshSeconds: Number(value) })} /><Select label="Range" value={settings.range} values={[...overlayRanges]} change={(value) => void update({ range: value as OverlayRange })} /><Toggle label="Start with Windows" checked={settings.startWithWindows} change={(value) => void update({ startWithWindows: value })} /><Text label="Show / hide" value={settings.showHideHotkey} change={(value) => void update({ showHideHotkey: value })} /><Text label="Click through" value={settings.clickThroughHotkey} change={(value) => void update({ clickThroughHotkey: value })} />{nativeState?.shortcutError ? <p className="settings-error">{nativeState.shortcutError}</p> : null}</SettingsGroup>
      <SettingsGroup title="Data"><div className="data-actions"><button onClick={refresh}><RefreshCw size={12} />Refresh now</button><button onClick={() => void openDashboard()}><ExternalLink size={12} />Open Command Center</button></div><div className="data-actions"><button onClick={() => void controlRelay("start").then(refresh).catch(report)}><Power size={12} />Start relay</button><button onClick={() => void controlRelay("restart").then(refresh).catch(report)}><RefreshCw size={12} />Restart relay</button><button onClick={() => void controlRelay("stop").catch(report)}><X size={12} />Stop relay</button></div><p>Relay: <b>{nativeState?.relayStatus ?? "checking"}</b> · 127.0.0.1:14318</p><p>The widget refreshes locally at the selected cadence. The relay limits remote snapshot reads to once every 30 seconds.</p><p>Snapshot values are operational and privacy-filtered. No cloud credential is stored in this app.</p></SettingsGroup>
  </div></aside>;
}

function ContextMenu({ settings, close, update }: Readonly<{ settings: DesktopOverlaySettings; close: () => void; update: (partial: Partial<DesktopOverlaySettings>, resize?: boolean) => Promise<void> }>) { return <div className="context-menu" onMouseLeave={close}>{overlayRanges.map((range) => <button key={range} onClick={() => { close(); void update({ range }); }}>{settings.range === range ? <Check size={11} /> : <span />}{range.toUpperCase()}</button>)}<hr />{overlayLayouts.map((layout) => <button key={layout} onClick={() => { close(); void update({ layout }, true); }}>{settings.layout === layout ? <Check size={11} /> : <span />}{layout}</button>)}<hr /><button onClick={() => { close(); void update({ alwaysOnTop: !settings.alwaysOnTop }); }}><span />Always on top</button><button onClick={() => { close(); void update({ lockPosition: !settings.lockPosition }); }}>{settings.lockPosition ? <Lock size={11} /> : <Unlock size={11} />}Lock position</button><button disabled={!settings.clickThroughHotkey} onClick={() => { close(); void update({ clickThrough: !settings.clickThrough }); }}><EyeOff size={11} />Click through</button><button onClick={() => { close(); void recoverOverlay(); }}><Unlock size={11} />Recover movement</button><hr /><button onClick={() => void openDashboard()}><ExternalLink size={11} />Open Command Center</button><button onClick={() => void quitOverlay()}><Power size={11} />Quit</button></div>; }

function SettingsGroup({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) { return <section className="settings-group"><h2>{title}</h2><div>{children}</div></section>; }
function Select({ label, value, values, labels, change }: Readonly<{ label: string; value: string; values: string[]; labels?: string[]; change: (value: string) => void }>) { return <label><span>{label}</span><select value={value} onChange={(event) => change(event.target.value)}>{values.map((item, index) => <option key={item} value={item}>{labels?.[index] ?? titleCase(item)}</option>)}</select><ChevronDown size={10} /></label>; }
function Range({ label, value, min, max, change }: Readonly<{ label: string; value: number; min: number; max: number; change: (value: number) => void }>) { return <label className="range"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => change(Number(event.target.value))} /></label>; }
function Color({ label, value, change }: Readonly<{ label: string; value: string; change: (value: string) => void }>) { return <label><span>{label}</span><input aria-label={label} type="color" value={value} onChange={(event) => change(event.target.value)} /></label>; }
function Toggle({ label, checked, disabled, change }: Readonly<{ label: string; checked: boolean; disabled?: boolean; change: (value: boolean) => void }>) { return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => change(event.target.checked)} /><i /></label>; }
function Text({ label, value, change }: Readonly<{ label: string; value: string; change: (value: string) => void }>) { const [draft, setDraft] = useState(value); return <label><span>{label}</span><input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => change(draft)} /></label>; }

function numberLabel(value?: number) { return value === undefined ? "—" : new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function durationLabel(value?: number) { return value === undefined ? "—" : value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`; }
function friendlyModel(value?: string) { return value ? value.replace(/^gpt-/, "").replace(/\.0$/, "") : "No model"; }
function shortAge(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000)); return seconds < 60 ? `${seconds}s ago` : seconds < 3_600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3_600)}h ago`; }
function titleCase(value: string) { return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function safeNativeMessage(error: unknown) {
  const detail = String(error);
  if (/shortcut/i.test(detail)) return detail.replace(/^Error:\s*/i, "").slice(0, 160);
  if (detail.includes("relay_not_owned")) return "That relay was not started by Codex Live, so it was left untouched.";
  if (detail.includes("node_runtime_not_found")) return "Node.js runtime not found. Install Node.js 22 or newer and try again.";
  if (detail.includes("relay_runtime_unavailable")) return "Build dependencies for the local relay are unavailable.";
  if (detail.includes("relay_start_failed")) return "The local relay could not start. Check the local configuration and port.";
  if (detail.includes("relay_stop_failed")) return "The Codex Live-owned relay could not be stopped.";
  if (detail.includes("dashboard_open_failed")) return "The Command Center could not be opened.";
  if (detail.includes("window_") || detail.includes("click_through")) return "The requested native window change could not be applied.";
  return "Native host unavailable.";
}
