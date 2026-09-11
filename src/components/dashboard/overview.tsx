import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CircleDot,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Layers3,
  PackageOpen,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import type { DashboardSnapshot } from "@/lib/dashboard/queries";

const metricIcons: LucideIcon[] = [Layers3, GitCommitHorizontal, GitPullRequest, CircleDot, ShieldCheck, Activity];

export function Overview({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  return (
    <div className="fade-in-up mx-auto max-w-[1480px]">
      <section className="mb-8 flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Private engineering intelligence</p>
          <h1 className="page-title max-w-3xl text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-slate-100">Your systems, clearly in view.</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-400">One calm surface for the repositories, work queues, builds, and agent signals you trust. The command center is ready; the sources are yours to connect.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link className="group inline-flex items-center gap-2 rounded-lg bg-cyan-100 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-50" href="/data-sources">
            Connect a data source
            <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <div className="mb-7 flex flex-col gap-4 rounded-2xl border border-amber-200/15 bg-[linear-gradient(110deg,rgba(242,195,123,0.10),rgba(242,195,123,0.025))] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-amber-200/20 bg-amber-200/[0.08] text-amber-100/80"><Radio size={15} /></div>
          <div>
            <p className="text-sm font-medium text-amber-50/90">No live sources connected</p>
            <p className="mt-1 text-xs leading-5 text-amber-100/55">The structure is in place. Connect a provider when you are ready to see real signals.</p>
          </div>
        </div>
        <Link className="inline-flex items-center gap-2 self-start text-xs font-semibold text-amber-100/80 transition hover:text-amber-50 sm:self-auto" href="/data-sources">Review sources <ArrowRight size={13} /></Link>
      </div>

      <section aria-label="Overview metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {snapshot.metrics.map((metric, index) => (
          <MetricCard icon={metricIcons[index] ?? PackageOpen} key={metric.id} label={metric.label} helper={metric.helper} result={metric.result} />
        ))}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="panel hairline-grid p-5 sm:p-6">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Signal horizon</p>
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-200">Trends without guesswork</h2>
              <p className="mt-1 text-xs text-slate-500">A place for real 7-day and 30-day movement once telemetry is available.</p>
            </div>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-600">Awaiting telemetry</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TrendPanel label="7-day trend" description="Recent movement across connected signals." />
            <TrendPanel label="30-day trend" description="Longer-range context for your workspace." />
          </div>
        </div>

        <div className="panel p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Data foundations</p>
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-200">Source posture</h2>
            </div>
            <Link className="text-slate-600 transition hover:text-cyan-200" href="/data-sources" aria-label="Manage data sources"><ArrowRight size={16} /></Link>
          </div>
          <div className="space-y-3">
            {snapshot.sources.map((source) => (
              <div className="panel-subtle flex items-center justify-between gap-3 px-3.5 py-3" key={source.id}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-300">{source.name}</p>
                  <p className="mt-1 truncate text-[10px] text-slate-600">{source.capabilities.slice(0, 2).join(" · ")}</p>
                </div>
                <StatusPill connected={source.status === "connected"} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="panel p-5 sm:p-6">
          <PanelHeading icon={Activity} label="Recent project activity" href="/activity" />
          {snapshot.recentActivity.status === "connected" ? <EmptyState title="Activity is ready to render" description="A connected activity provider has returned records, but a dedicated activity view is still being wired." compact /> : <EmptyState title="Data source not connected" description={snapshot.recentActivity.reason} compact />}
        </div>
        <div className="panel p-5 sm:p-6">
          <PanelHeading icon={GitBranch} label="Build / CI health" href="/build-ci-health" />
          {snapshot.buildHealth.status === "connected" ? <EmptyState title="Build evidence is ready to render" description="A connected CI provider has returned records, but the detailed build view is still being wired." compact /> : <EmptyState title="Data source not connected" description={snapshot.buildHealth.reason} compact />}
        </div>
      </section>

      <section className="mt-4 flex flex-col gap-4 rounded-2xl border border-cyan-200/10 bg-cyan-100/[0.035] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.08] text-cyan-100/80"><PackageOpen size={17} /></div>
          <div>
            <p className="text-sm font-medium text-slate-200">A trustworthy foundation starts with provenance.</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Every metric will carry a source, freshness, and failure state. Until then, this command center stays deliberately quiet.</p>
          </div>
        </div>
        <Link className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-cyan-100/80 transition hover:text-cyan-50" href="/data-sources">View provider design <ArrowRight size={13} /></Link>
      </section>
    </div>
  );
}

function TrendPanel({ label, description }: Readonly<{ label: string; description: string }>) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <span className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Unavailable</span>
      </div>
      <div className="mb-3 grid h-12 place-items-center rounded-lg border border-dashed border-white/[0.08] bg-black/10">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-700">No series available</span>
      </div>
      <p className="text-[11px] leading-5 text-slate-600">{description} No telemetry connected.</p>
    </div>
  );
}

function PanelHeading({ icon: Icon, label, href }: Readonly<{ icon: LucideIcon; label: string; href: string }>) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <Icon size={15} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-300">{label}</h2>
      </div>
      <Link className="text-slate-600 transition hover:text-cyan-200" href={href} aria-label={`Open ${label}`}><ArrowRight size={15} /></Link>
    </div>
  );
}
