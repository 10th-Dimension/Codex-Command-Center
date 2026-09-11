"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigationItems } from "@/lib/navigation";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="flex items-center gap-3 px-6 pb-5 pt-7">
        <div className="grid size-9 place-items-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100 shadow-[0_0_24px_rgba(121,216,230,0.12)]">
          <span className="text-sm font-semibold tracking-tight">CC</span>
        </div>
        <div>
          <p className="text-[13px] font-semibold tracking-wide text-slate-100">Codex Command</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Private workspace</p>
        </div>
      </div>

      <div className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link className={`nav-link ${isActive ? "nav-link-active" : ""}`} href={item.href} key={item.href}>
              <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer border-t border-white/[0.07] px-6 py-5">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>System posture</span>
          <span className="flex items-center gap-1.5 text-amber-200/80"><span className="status-dot" />Awaiting sources</span>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-600">Private by default. Every signal should carry its source.</p>
      </div>
    </aside>
  );
}
