import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CircleDot,
  CircleCheck,
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
import type { ActivityRecord, ActivityTrendPoint, BuildRecord, DataResult } from "@/lib/providers/types";

const metricIcons: LucideIcon[] = [Layers3, GitCommitHorizontal, GitPullRequest, CircleDot, ShieldCheck, Activity];

export function Overview({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const githubConnected = snapshot.githubHealth.status !== "unavailable";
  const githubDegraded = snapshot.githubHealth.status === "degraded";

  return (
    <div className="fade-in-up mx-auto max-w-[1480px]">
      <section className="mb-8 flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Private engineering intelligence</p>
          <h1 className="page-title max-w-3xl text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-slate-100">Your systems, clearly in view.</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-400">One calm surface for the repositories, work queues, builds, and agent signals you trust. Every live value below carries the provenance of its provider.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link className="group inline-flex items-center gap-2 rounded-lg bg-cyan-100 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-50" href="/data-sources">
            Review data sources
            <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <div className={`mb-7 flex flex-col gap-4 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${githubConnected ? "border-emerald-200/15 bg-[linear-gradient(110deg,rgba(112,218,174,0.10),rgba(112,218,174,0.025))]" : "border-amber-200/15 bg-[linear-gradient(110deg,rgba(242,195,123,0.10),rgba(242,195,123,0.025))]"}`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border ${githubConnected ? "border-emerald-200/20 bg-emerald-200/[0.08] text-emerald-100/80" : "border-amber-200/20 bg-amber-200/[0.08] text-amber-100/80"}`}>
            {githubConnected ? <CircleCheck size={15} /> : <Radio size={15} />}
          </div>
          <div>
            <p className={`text-sm font-medium ${githubConnected ? "text-emerald-50/90" : "text-amber-50/90"}`}>{githubDegraded ? "GitHub is partially available" : githubConnected ? "GitHub is connected" : "No live sources connected"}</p>
            <p className={`mt-1 text-xs leading-5 ${githubConnected ? "text-emerald-100/60" : "text-amber-100/55"}`}>
              {githubDegraded ? snapshot.githubHealth.message : githubConnected ? `${snapshot.githubHealth.configuredResource ?? "Configured repository"} is supplying read-only data.` : snapshot.githubHealth.message}
            </p>
          </div>
        </div>
        <Link className={`inline-flex items-center gap-2 self-start text-xs font-semibold transition sm:self-auto ${githubConnected ? "text-emerald-100/80 hover:text-emerald-50" : "text-amber-100/80 hover:text-amber-50"}`} href="/data-sources">
          {githubConnected ? "View source health" : "Connect a data source"}
          <ArrowRight size={13} />
        </Link>
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
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-200">Trends from GitHub activity</h2>
              <p className="mt-1 text-xs text-slate-500">Commit counts returned by GitHub for the configured repository.</p>
            </div>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-600">{githubConnected ? "Live source" : "Unavailable"}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TrendPanel label="7-day trend" description="Recent commit movement." result={snapshot.trends.sevenDay} />
            <TrendPanel label="30-day trend" description="Longer-range commit context." result={snapshot.trends.thirtyDay} />
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
                  <p className="mt-1 truncate text-[10px] text-slate-600">{source.configuredResource ?? source.capabilities.slice(0, 2).join(" · ")}</p>
                </div>
                <StatusPill status={source.status} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="panel p-5 sm:p-6">
          <PanelHeading icon={Activity} label="Recent project activity" href="/activity" />
          <ActivityPreview result={snapshot.activity} />
        </div>
        <div className="panel p-5 sm:p-6">
          <PanelHeading icon={GitBranch} label="Build / CI health" href="/build-ci-health" />
          <BuildPreview result={snapshot.builds} />
        </div>
      </section>

      <section className="mt-4 flex flex-col gap-4 rounded-2xl border border-cyan-200/10 bg-cyan-100/[0.035] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.08] text-cyan-100/80"><PackageOpen size={17} /></div>
          <div>
            <p className="text-sm font-medium text-slate-200">A trustworthy foundation starts with provenance.</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Every metric carries a source, freshness, and failure state. Future providers can join the same adapter boundary without changing the dashboard contract.</p>
          </div>
        </div>
        <Link className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-cyan-100/80 transition hover:text-cyan-50" href="/data-sources">View provider health <ArrowRight size={13} /></Link>
      </section>
    </div>
  );
}

function TrendPanel({ label, description, result }: Readonly<{ label: string; description: string; result: DataResult<ActivityTrendPoint[]> }>) {
  if (result.status === "unavailable") {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-300">{label}</p>
          <span className="text-[10px] uppercase tracking-[0.12em] text-amber-100/60">Unavailable</span>
        </div>
        <EmptyState title="Data source not connected" description={result.reason} compact />
      </div>
    );
  }

  if (result.data.length === 0) {
    return <EmptyState title="No trend data returned" description={`${description} GitHub returned no points for this period.`} compact />;
  }

  const maxValue = Math.max(...result.data.map((point) => point.value), 1);
  const hasActivity = result.data.some((point) => point.value > 0);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <span className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/70">Live</span>
      </div>
      <div className="flex h-20 items-end gap-1.5 rounded-lg border border-white/[0.06] bg-black/10 px-2 pb-2 pt-3" aria-label={`${label} commit trend`}>
        {result.data.map((point) => {
          const height = point.value === 0 ? 3 : Math.max(10, Math.round((point.value / maxValue) * 100));
          return <div className="group flex h-full min-w-0 flex-1 items-end" key={`${point.label}-${point.value}`} title={`${point.label}: ${point.value} commit${point.value === 1 ? "" : "s"}`}><div aria-label={`${point.label}: ${point.value}`} className="w-full rounded-sm bg-cyan-200/65 transition group-hover:bg-cyan-100" style={{ height: `${height}%` }} /></div>;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-600">
        <span>{result.data[0]?.label}</span>
        <span className="text-slate-500">{hasActivity ? `${result.data.reduce((total, point) => total + point.value, 0).toLocaleString()} commits` : "No commits recorded"}</span>
        <span>{result.data.at(-1)?.label}</span>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-600">{description} Values are from the configured GitHub repository.</p>
    </div>
  );
}

function ActivityPreview({ result }: Readonly<{ result: DataResult<ActivityRecord[]> }>) {
  if (result.status === "unavailable") return <EmptyState title="Data source not connected" description={result.reason} compact />;
  if (result.data.length === 0) return <EmptyState title="No recent activity" description="GitHub returned no recent commits, open work items, or workflow runs." compact />;

  return (
    <div className="space-y-2">
      {result.data.slice(0, 4).map((record) => <ActivityRow key={record.id} record={record} />)}
      <Link className="group mt-4 inline-flex items-center gap-2 text-xs font-semibold text-cyan-100/75 transition hover:text-cyan-50" href="/activity">Open full activity <ArrowRight size={13} className="transition group-hover:translate-x-0.5" /></Link>
    </div>
  );
}

function BuildPreview({ result }: Readonly<{ result: DataResult<BuildRecord[]> }>) {
  if (result.status === "unavailable") return <EmptyState title="Data source not connected" description={result.reason} compact />;
  if (result.data.length === 0) return <EmptyState title="No workflow runs" description="GitHub Actions returned no recent workflow runs for the configured repository." compact />;

  return (
    <div className="space-y-2">
      {result.data.slice(0, 4).map((build) => (
        <div className="panel-subtle flex items-center justify-between gap-3 px-3.5 py-3" key={build.id}>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-300">{build.name}</p>
            <p className="mt-1 text-[10px] text-slate-600">{build.repositoryId} · {formatDate(build.completedAt ?? build.startedAt)}</p>
          </div>
          <BuildStatus status={build.status} />
        </div>
      ))}
      <Link className="group mt-4 inline-flex items-center gap-2 text-xs font-semibold text-cyan-100/75 transition hover:text-cyan-50" href="/build-ci-health">Open CI health <ArrowRight size={13} className="transition group-hover:translate-x-0.5" /></Link>
    </div>
  );
}

function ActivityRow({ record }: Readonly<{ record: ActivityRecord }>) {
  const content = (
    <div className="panel-subtle flex items-start gap-3 px-3.5 py-3 transition hover:border-white/[0.18]">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-500"><ActivityIcon kind={record.kind} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-300">{record.title}</p>
        <p className="mt-1 truncate text-[10px] text-slate-600">{record.summary} · {formatDate(record.occurredAt)}</p>
      </div>
    </div>
  );

  return record.url ? <a href={record.url} target="_blank" rel="noreferrer">{content}</a> : content;
}

function ActivityIcon({ kind }: Readonly<{ kind: ActivityRecord["kind"] }>) {
  if (kind === "commit") return <GitCommitHorizontal size={14} />;
  if (kind === "pull-request") return <GitPullRequest size={14} />;
  if (kind === "issue") return <CircleDot size={14} />;
  return <GitBranch size={14} />;
}

function BuildStatus({ status }: Readonly<{ status: BuildRecord["status"] }>) {
  const label = status === "in-progress" ? "In progress" : status;
  const tone = status === "success" ? "text-emerald-200/80 bg-emerald-200/[0.07]" : status === "failure" ? "text-rose-200/80 bg-rose-200/[0.07]" : "text-amber-100/75 bg-amber-200/[0.07]";
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone}`}>{label}</span>;
}

function formatDate(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
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
