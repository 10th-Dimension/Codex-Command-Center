"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Command, ShieldCheck } from "lucide-react";

import { navigationItems } from "@/lib/navigation";

export function Topbar() {
  const pathname = usePathname();
  const currentItem = navigationItems.find((item) => item.href === pathname) ?? navigationItems.find((item) => item.href !== "/" && pathname.startsWith(item.href));

  return (
    <header className="flex min-h-[72px] items-center justify-between border-b border-white/[0.07] px-8 lg:px-12">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-600">Command center</span>
        <span className="text-slate-700">/</span>
        <span className="text-slate-300">{currentItem?.label ?? "Overview"}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[11px] text-slate-500 sm:flex">
          <ShieldCheck size={13} className="text-cyan-200/70" />
          Local-first posture
        </div>
        <Link className="group flex items-center gap-2 rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-cyan-200/30 hover:text-cyan-100" href="/settings">
          <Command size={14} />
          Preferences
          <ArrowUpRight size={13} className="text-slate-600 transition group-hover:text-cyan-200" />
        </Link>
      </div>
    </header>
  );
}
