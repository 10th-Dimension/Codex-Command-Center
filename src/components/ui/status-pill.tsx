import { CircleAlert, CircleCheck } from "lucide-react";

export function StatusPill({ connected }: Readonly<{ connected: boolean }>) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/15 bg-emerald-200/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/80">
      <CircleCheck size={12} /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-200/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100/75">
      <CircleAlert size={12} /> Not connected
    </span>
  );
}
