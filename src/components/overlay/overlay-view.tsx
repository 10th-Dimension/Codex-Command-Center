"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, CheckCircle2, ChevronDown, CircleAlert, Settings2, ShieldCheck } from "lucide-react";
import { compactNumber, formatDuration } from "@/lib/dashboard/analytics";
import { defaultOverlaySettings, parseOverlaySettings, resolveOverlayLayout, type OverlayLayout, type OverlaySettings } from "@/lib/overlay/settings";
import type { OverlaySnapshot } from "@/lib/overlay/view-model";
import { codexPricingCoverageReasons, type CodexEquivalentPricing } from "@/lib/telemetry/pricing";

const storageKey = "codex-command-center.overlay-settings.v1";

export function OverlayView({ initialSnapshot }: Readonly<{ initialSnapshot: OverlaySnapshot }>) {
  const [settings, setSettings] = useState(defaultOverlaySettings);
  const [layout, setLayout] = useState<OverlayLayout>(defaultOverlaySettings.layout);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let saved = defaultOverlaySettings;
    try { saved = parseOverlaySettings(JSON.parse(localStorage.getItem(storageKey) ?? "{}")); } catch { saved = defaultOverlaySettings; }
    queueMicrotask(() => setSettings(saved));
  }, []);
  useEffect(() => {
    const resize = () => setLayout(resolveOverlayLayout(window.innerWidth, window.innerHeight, settings.layout));
    resize(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, [settings.layout]);

  const update = (next: Partial<OverlaySettings>) => {
    const parsed = parseOverlaySettings({ ...settings, ...next }); setSettings(parsed); localStorage.setItem(storageKey, JSON.stringify(parsed));
  };
  const textColor = useMemo(() => settings.textColor === "custom" ? settings.customTextColor : ({ auto: "#e7eff2", white: "#ffffff", black: "#090d10", red: "#ff8f99", amber: "#ffc66d", cyan: "#8ce8f2" } as const)[settings.textColor], [settings]);
  const session = initialSnapshot.latestSession, summary = initialSnapshot.windowSummary;
  const healthy = Object.values(initialSnapshot.health).every((status) => status === "connected");
  return <main className={`overlay-root overlay-${layout} overlay-${settings.density} overlay-style-${settings.visualStyle}`} style={{ "--overlay-opacity": settings.backgroundOpacity / 100, "--overlay-text": textColor, "--overlay-accent": settings.accentColor, "--overlay-scale": settings.fontScale / 100 } as React.CSSProperties}>
    <div className="overlay-surface">
      <header className="overlay-header"><div className="overlay-brand"><Activity size={13} /><span>CODEX</span><i /></div><div className="overlay-header-actions"><span>{initialSnapshot.range.toUpperCase()}</span><button aria-expanded={showSettings} aria-label="Overlay settings" onClick={() => setShowSettings(!showSettings)} type="button"><Settings2 size={13} /></button></div></header>
      <section className="overlay-strip-content"><OverlayIdentity session={session} /><OverlayMetric label="Input" value={summary.inputTokens} /><OverlayMetric label="Output" value={summary.outputTokens} stripOptional /><OverlayMetric label="Cached" value={summary.cachedTokens} stripOptional /><OverlayMetric label="Reasoning" value={summary.reasoningTokens} /><OverlayMetric label="Tool" value={summary.toolTokens} stripOptional /><OverlayMetric label="TTFT" value={summary.averageTtftMs} duration /><OverlayMetric label="Tools" value={summary.completedTools} /><div className={`overlay-health ${healthy ? "healthy" : "attention"}`}>{healthy ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}<span>{healthy ? "Healthy" : "Attention"}</span></div></section>
      <ObservationRail session={session} summary={summary} lastTelemetryAt={initialSnapshot.lastTelemetryAt} />
      <OverlayPricing pricing={initialSnapshot.pricing} />
      <section className="overlay-expanded-content"><div className="overlay-section-title"><span>Window summary</span><small>{initialSnapshot.range.toUpperCase()}</small></div><div className="overlay-summary-grid"><OverlayMetric label="Sessions" value={summary.sessions} /><OverlayMetric label="Input" value={summary.inputTokens} /><OverlayMetric label="Output" value={summary.outputTokens} /><OverlayMetric label="Cached" value={summary.cachedTokens} /><OverlayMetric label="Reasoning" value={summary.reasoningTokens} /><OverlayMetric label="Tool" value={summary.toolTokens} /></div><div className="overlay-section-title"><span>Latest session</span><small>{session ? relativeTime(session.lastSeenAt) : "No session"}</small></div>{session ? <div className="overlay-session"><OverlayIdentity session={session} /><dl><div><dt>TTFT</dt><dd>{formatDuration(session.averageTtftMs)}</dd></div><div><dt>Tools</dt><dd>{session.completedTools}</dd></div><div><dt>Failures</dt><dd>{session.toolFailures ?? "—"}</dd></div><div><dt>Approvals</dt><dd>{session.approvals}</dd></div></dl></div> : <div className="overlay-empty">No retained session telemetry</div>}<div className="overlay-section-title"><span>Source health</span><small>Operational only</small></div><div className="overlay-health-grid">{Object.entries(initialSnapshot.health).map(([key, status]) => <div key={key}><i className={status} /><span>{key}</span><b>{status}</b></div>)}</div></section>
      {showSettings ? <SettingsPanel settings={settings} update={update} close={() => setShowSettings(false)} /> : null}
    </div>
  </main>;
}

function OverlayIdentity({ session }: Readonly<{ session?: OverlaySnapshot["latestSession"] }>) { return <div className="overlay-identity"><div><Bot size={15} /></div><span><strong>{session?.model ?? "No model"}</strong><small>{session?.reasoningEffort ?? "effort n/a"}</small></span></div>; }
function OverlayMetric({ label, value, duration, stripOptional }: Readonly<{ label: string; value?: number; duration?: boolean; stripOptional?: boolean }>) { return <div className={`overlay-metric ${stripOptional ? "strip-optional" : ""}`}><span>{label}</span><strong>{duration ? formatDuration(value) : compactNumber(value)}</strong></div>; }

function OverlayPricing({ pricing }: Readonly<{ pricing?: CodexEquivalentPricing }>) {
  const available = pricing?.status === "available" || pricing?.status === "partial";
  const coverageReasons = pricing ? codexPricingCoverageReasons(pricing) : [];
  return <section className={`overlay-pricing ${pricing?.status ?? "unavailable"}`} title={pricing?.note ?? "API-equivalent pricing is unavailable for this window."}>
    <div><span>API-equivalent usage</span><small>{pricing?.status === "partial" ? "Partial coverage" : pricing?.status === "available" ? "All observed models" : "Unavailable"}</small></div>
    <strong>{available && pricing?.usdEquivalent !== undefined ? `$${pricing.usdEquivalent}` : "Unavailable"}</strong>
    <b>{available && pricing?.apiCredits !== undefined ? `${pricing.apiCredits} credits` : "No priced token samples"}</b>
    <em>{pricing?.coveragePercent === undefined ? "Priced token coverage —" : `Priced token coverage ${pricing.coveragePercent}%`}</em>
    {pricing?.status === "partial" && coverageReasons.length ? <small className="pricing-coverage-reasons">{coverageReasons.join(" · ")}</small> : null}
  </section>;
}

function ObservationRail({ session, summary, lastTelemetryAt }: Readonly<{ session?: OverlaySnapshot["latestSession"]; summary: OverlaySnapshot["windowSummary"]; lastTelemetryAt?: string }>) {
  const observedAt = session?.lastSeenAt ?? lastTelemetryAt;
  const observed = Boolean(session);
  return <section className={`overlay-observation-rail ${observed ? "observed" : "unavailable"}`}>
    <span className="overlay-observation-pulse"><Activity size={13} /></span>
    <div className="overlay-observation-copy"><strong>{observed ? "Last session observed" : "No session observed"}</strong><small>{observed ? `${session?.model ?? "Model unavailable"} · ${session?.reasoningEffort ?? "effort unavailable"}` : "No bounded session summary is available."}</small></div>
    <time>{observedAt ? relativeTime(observedAt) : "Unavailable"}</time>
    <div className="overlay-observation-facts"><span><b>{compactNumber(summary.completedTools)}</b> tools</span><span><b>{compactNumber(summary.approvals)}</b> approvals</span><span><b>{compactNumber(summary.failures)}</b> failed</span></div>
    <p><ShieldCheck size={12} />Observed state only · prompts, commands, and agent-graph details stay out of this surface.</p>
  </section>;
}

function SettingsPanel({ settings, update, close }: Readonly<{ settings: OverlaySettings; update: (next: Partial<OverlaySettings>) => void; close: () => void }>) {
  return <aside className="overlay-settings"><header><div><Settings2 size={13} /><span>Overlay appearance</span></div><button onClick={close} type="button"><ChevronDown size={14} /></button></header><div className="overlay-settings-fields"><label><span>Layout</span><select value={settings.layout} onChange={(event) => update({ layout: event.target.value as OverlayLayout })}><option value="compact">Compact</option><option value="expanded">Expanded</option><option value="strip">Strip</option></select></label><label><span>Density</span><select value={settings.density} onChange={(event) => update({ density: event.target.value as OverlaySettings["density"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label><label><span>Visual style</span><select value={settings.visualStyle} onChange={(event) => update({ visualStyle: event.target.value as OverlaySettings["visualStyle"] })}><option value="mica">Mica-ready</option><option value="translucent">Translucent</option><option value="acrylic">Acrylic-ready</option><option value="solid">Solid</option></select></label><label><span>Text</span><select value={settings.textColor} onChange={(event) => update({ textColor: event.target.value as OverlaySettings["textColor"] })}>{["auto","white","black","red","amber","cyan","custom"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Opacity · {settings.backgroundOpacity}%</span><input min="20" max="100" type="range" value={settings.backgroundOpacity} onChange={(event) => update({ backgroundOpacity: Number(event.target.value) })} /></label><label><span>Font · {settings.fontScale}%</span><input min="80" max="150" type="range" value={settings.fontScale} onChange={(event) => update({ fontScale: Number(event.target.value) })} /></label><label><span>Accent</span><input aria-label="Custom accent color" type="color" value={settings.accentColor} onChange={(event) => update({ accentColor: event.target.value })} /></label>{settings.textColor === "custom" ? <label><span>Custom text</span><input aria-label="Custom text color" type="color" value={settings.customTextColor} onChange={(event) => update({ customTextColor: event.target.value })} /></label> : null}</div><p>Mica and Acrylic are visual intent only; the future native host owns the actual Windows backdrop.</p></aside>;
}
function relativeTime(value: string) { const ms = Date.now() - Date.parse(value); return ms < 60_000 ? "just now" : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : ms < 86_400_000 ? `${Math.floor(ms / 3_600_000)}h ago` : `${Math.floor(ms / 86_400_000)}d ago`; }
