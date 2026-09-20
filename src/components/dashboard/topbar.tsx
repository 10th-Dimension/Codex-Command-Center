"use client";

import { BarChart3, GitBranch, LayoutDashboard, ListTree, Settings, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

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
  return <>
    <header className="command-topbar">
      <Link className="command-brand" href="/"><span>CC</span><div><b>Command Center</b><small>Private developer operations</small></div></Link>
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
      <aside aria-label="Settings" className="settings-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Settings size={15} /><b>Settings</b></div><button aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={16} /></button></header>
        <section><h2>Data policy</h2><p>Normal Codex views read materialized rollup snapshots. Raw telemetry is loaded only through the explicit Forensics action.</p><div className="settings-assurance"><ShieldCheck size={15} /><span>Private routes · no public cache · no fabricated metrics</span></div></section>
        <section><h2>Refresh policy</h2><p>The website fetches on navigation, range changes, and manual refresh. It does not run an aggressive background polling loop.</p></section>
        <section><h2>Providers</h2><p>GitHub credentials and telemetry credentials remain server-only and separated by the provider registry.</p></section>
      </aside>
    </div> : null}
  </>;
}
