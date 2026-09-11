import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, Radio, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import type { SectionContent } from "@/lib/navigation";

export function SectionPage({ content }: Readonly<{ content: SectionContent }>) {
  return (
    <div className="fade-in-up mx-auto max-w-[1180px]">
      <section className="mb-8">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">{content.eyebrow}</p>
        <h1 className="page-title text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-slate-100">{content.title}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-400">{content.description}</p>
      </section>

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200/15 bg-amber-200/[0.05] p-5">
        <Radio className="mt-0.5 shrink-0 text-amber-100/70" size={17} />
        <div>
          <p className="text-sm font-medium text-amber-50/90">{content.note}</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/55">This page will only show values returned by a connected provider.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="panel p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2.5">
            <Sparkles size={15} className="text-cyan-200/70" />
            <h2 className="text-sm font-semibold text-slate-300">Planned surface</h2>
          </div>
          <EmptyState />
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2.5">
            <LockKeyhole size={15} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-300">What this surface will support</h2>
          </div>
          <div className="space-y-3">
            {content.capabilities.map((capability) => (
              <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3" key={capability}>
                <div className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-cyan-200/[0.1] text-cyan-100/75"><Check size={10} strokeWidth={3} /></div>
                <p className="text-xs leading-5 text-slate-400">{capability}</p>
              </div>
            ))}
          </div>
          <Link className="group mt-5 inline-flex items-center gap-2 text-xs font-semibold text-cyan-100/80 transition hover:text-cyan-50" href="/data-sources">Review provider status <ArrowRight size={13} className="transition group-hover:translate-x-0.5" /></Link>
        </section>
      </div>
    </div>
  );
}
