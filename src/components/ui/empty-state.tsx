import { DatabaseZap } from "lucide-react";

export function EmptyState({
  title = "Data source not connected",
  description = "Connect a trusted provider to populate this surface. No placeholder values are shown.",
  compact = false,
}: Readonly<{
  title?: string;
  description?: string;
  compact?: boolean;
}>) {
  return (
    <div className={`flex ${compact ? "min-h-[132px]" : "min-h-[190px]"} flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-black/10 px-6 text-center`}>
      <div className="mb-3 grid size-9 place-items-center rounded-full border border-amber-200/15 bg-amber-200/[0.06] text-amber-100/70">
        <DatabaseZap size={16} />
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}
