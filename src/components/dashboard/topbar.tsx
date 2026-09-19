"use client";

import { Activity, Bot, GitBranch, ListTree, Settings, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function Topbar() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <>
    <header className="command-topbar">
      <Link className="command-brand" href="/"><span>CC</span><div><b>Command Center</b><small>Private developer operations</small></div></Link>
      <nav aria-label="Primary navigation">
        <span className="command-nav-label">Workspace</span>
        <Link className={pathname === "/" ? "active" : ""} href="/"><Activity size={14} />Codex</Link>
        <Link className={pathname.startsWith("/github") ? "active" : ""} href="/github"><GitBranch size={14} />GitHub</Link>
        <span className="command-nav-label">Operations</span>
        <Link href="/?section=usage"><Bot size={14} />Usage</Link>
        <Link href="/?section=forensics"><ListTree size={14} />Activity</Link>
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
