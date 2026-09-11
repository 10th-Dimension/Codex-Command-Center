import type { LucideIcon } from "lucide-react";

import type { DataResult } from "@/lib/providers/types";

export function MetricCard({
  label,
  helper,
  result,
  icon: Icon,
}: Readonly<{
  label: string;
  helper: string;
  result: DataResult<number>;
  icon: LucideIcon;
}>) {
  const isConnected = result.status === "connected";
  const isBounded = isConnected && Boolean(result.meta?.bounds);
  const isTruncated = isConnected && Boolean(result.meta?.bounds?.truncated);

  return (
    <article className="panel flex min-h-[148px] flex-col justify-between p-5 transition hover:-translate-y-0.5 hover:border-white/[0.22]">
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-400">
          <Icon size={15} strokeWidth={1.8} />
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.15em] ${isConnected ? "bg-emerald-200/[0.08] text-emerald-200/80" : "bg-amber-200/[0.07] text-amber-100/70"}`}>
          {isConnected ? (isBounded ? "Bounded" : "Live") : "Unavailable"}
        </span>
      </div>
      <div className="mt-6">
        <div className="flex items-baseline gap-2">
          <p className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100">{isConnected ? `${isTruncated ? "≥" : ""}${result.data.toLocaleString()}` : "—"}</p>
          <p className="text-xs text-slate-500">{isConnected ? (isBounded ? "bounded records" : "records") : "not connected"}</p>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
        <p className="mt-1 text-[11px] text-slate-600">{helper}</p>
      </div>
    </article>
  );
}
