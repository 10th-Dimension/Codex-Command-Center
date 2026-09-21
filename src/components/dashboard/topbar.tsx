"use client";

import { BarChart3, ExternalLink, GitBranch, LayoutDashboard, ListTree, RefreshCw, Settings, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { CodexMark } from "@/components/brand/codex-mark";
import { useBrowserTimeZone } from "@/components/dashboard/browser-time";
import { codexWorkspaceMode } from "@/lib/navigation";

export function Topbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const range = searchParams.get("range");
  const rangeQuery = range && ["24h", "7d", "30d"].includes(range) ? `range=${encodeURIComponent(range)}` : "";
  const sectionHref = (nextSection?: string) => {
    const query = [rangeQuery, nextSection ? `section=${encodeURIComponent(nextSection)}` : ""].filter(Boolean).join("&");
    return query ? `/?${query}` : "/";
  };
  const workspaceMode = codexWorkspaceMode(section ?? undefined);
  const overviewActive = pathname === "/" && workspaceMode === "overview";
  const usageActive = pathname === "/" && workspaceMode === "usage";
  const activityActive = pathname === "/" && workspaceMode === "activity";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const timeZone = useBrowserTimeZone();

  return <>
    <header className="command-topbar">
      <Link className="command-brand" href="/"><span className="command-brand-mark"><CodexMark size={31} /></span><div><b>Command Center</b><small>Private developer operations</small></div></Link>
      <nav aria-label="Primary navigation">
        <span className="command-nav-label">Workspace</span>
        <Link aria-current={overviewActive ? "page" : undefined} className={overviewActive ? "active" : ""} href={sectionHref()}><LayoutDashboard size={14} />Overview</Link>
        <Link aria-current={usageActive ? "page" : undefined} className={usageActive ? "active" : ""} href={sectionHref("usage")}><BarChart3 size={14} />Usage</Link>
        <Link aria-current={activityActive ? "page" : undefined} className={activityActive ? "active" : ""} href={sectionHref("activity")}><ListTree size={14} />Activity</Link>
        <span className="command-nav-label">Delivery</span>
        <Link aria-current={pathname.startsWith("/github") ? "page" : undefined} className={pathname.startsWith("/github") ? "active" : ""} href="/github"><GitBranch size={14} />GitHub</Link>
      </nav>
      <button aria-label="Open settings" className="settings-gear" onClick={() => setSettingsOpen(true)} type="button"><Settings size={16} /></button>
    </header>
    {settingsOpen ? <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
      <aside aria-label="Settings" aria-modal="true" className="settings-drawer" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Settings size={15} /><div><b>Settings</b><small>Command Center workspace</small></div></div><button aria-label="Close settings" onClick={() => setSettingsOpen(false)} type="button"><X size={16} /></button></header>
        <section>
          <div className="settings-section-heading"><h2>Display</h2><span className="settings-live-badge">Automatic</span></div>
          <div className="settings-row"><span>Time zone</span><b>{timeZone}</b></div>
          <p>Chart labels and hover details use the viewer&apos;s browser-local clock. Backend-reported daily buckets keep their source calendar day.</p>
        </section>
        <section>
          <div className="settings-section-heading"><h2>Quick actions</h2><span className="settings-section-caption">Shortcuts</span></div>
          <div className="settings-actions">
            <button className="settings-action" onClick={() => window.location.reload()} type="button"><RefreshCw size={14} /><span><b>Refresh dashboard</b><small>Fetch the current snapshot now</small></span></button>
            <Link className="settings-action" href={sectionHref("usage")} onClick={() => setSettingsOpen(false)}><BarChart3 size={14} /><span><b>Open Usage</b><small>Token ledger and account quota</small></span><ExternalLink size={12} /></Link>
            <Link className="settings-action" href={sectionHref("activity")} onClick={() => setSettingsOpen(false)}><ListTree size={14} /><span><b>Open Activity</b><small>Sessions, tools, and diagnostics</small></span><ExternalLink size={12} /></Link>
            <Link className="settings-action" href="/overlay" onClick={() => setSettingsOpen(false)}><ExternalLink size={14} /><span><b>Open Codex Live</b><small>Native local telemetry companion</small></span><ExternalLink size={12} /></Link>
          </div>
        </section>
        <section><div className="settings-section-heading"><h2>Data policy</h2><ShieldCheck size={14} /></div><p>Normal Codex views read materialized rollup snapshots. Raw telemetry is loaded only through the explicit Forensics action.</p><div className="settings-assurance"><ShieldCheck size={15} /><span>Private routes · no public cache · no fabricated metrics</span></div></section>
        <section><div className="settings-section-heading"><h2>Refresh policy</h2><span className="settings-section-caption">Bounded</span></div><p>The website fetches on navigation, range changes, and manual refresh. It does not run an aggressive background polling loop.</p></section>
        <section><div className="settings-section-heading"><h2>Providers</h2><span className="settings-section-caption">Server-only</span></div><p>GitHub credentials and telemetry credentials remain server-only and separated by the provider registry.</p></section>
      </aside>
    </div> : null}
  </>;
}
