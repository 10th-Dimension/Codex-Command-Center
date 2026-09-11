import {
  Activity,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Clock3,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  KeyRound,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import type { DashboardSnapshot } from "@/lib/dashboard/queries";
import type {
  ActivityRecord,
  ActivityTrendPoint,
  BranchRecord,
  BuildRecord,
  DataResult,
  IssueRecord,
  PullRequestRecord,
  RepositoryRecord,
} from "@/lib/providers/types";

export function RepositoriesPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const repositories = snapshot.repositories;
  const branches = snapshot.branches;

  return (
    <PageFrame eyebrow="Inventory / Repositories" title="Repositories" description="A live inventory of the GitHub repository configured for this command center, with its metadata and branches kept separate from the presentation layer.">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1"><GitHubStatusIcon connected={snapshot.githubHealth.status === "connected"} /> GitHub</span>
        <span>·</span>
        <span>{snapshot.githubHealth.configuredResource ?? "Repository not configured"}</span>
        <Freshness value={repositories.status === "connected" ? repositories.asOf : undefined} />
      </div>
      {repositories.status === "unavailable" ? <EmptyState title="Data source not connected" description={repositories.reason} /> : repositories.data.length === 0 ? <EmptyState title="No repository returned" description="GitHub is reachable, but the configured repository returned no metadata." /> : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            {repositories.data.map((repository) => <RepositoryCard branches={branches} key={repository.id} repository={repository} />)}
          </div>
          <BranchPanel branches={branches} />
        </>
      )}
    </PageFrame>
  );
}

export function ActivityPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const activity = snapshot.activity;

  return (
    <PageFrame eyebrow="Signal stream / Activity" title="Activity" description="A chronology composed from real GitHub commits, open work items, and workflow runs. Each event retains its repository, timestamp, and source URL where available.">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/15 bg-emerald-200/[0.05] px-2.5 py-1 text-emerald-200/75"><CheckCircle2 size={12} /> GitHub activity</span>
        <Freshness value={activity.status === "connected" ? activity.asOf : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="panel p-5 sm:p-6">
          <PanelTitle icon={Activity} title="Recent development activity" />
          {activity.status === "unavailable" ? <EmptyState title="Data source not connected" description={activity.reason} compact /> : activity.data.length === 0 ? <EmptyState title="No recent activity" description="GitHub returned no recent commits, open work items, or workflow runs." compact /> : <div className="space-y-2">{activity.data.map((record) => <ActivityListRow key={record.id} record={record} />)}</div>}
        </section>
        <div className="space-y-4">
          <TrendCard label="7-day activity" result={snapshot.trends.sevenDay} />
          <TrendCard label="30-day activity" result={snapshot.trends.thirtyDay} />
        </div>
      </div>
    </PageFrame>
  );
}

export function PullRequestsIssuesPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  return (
    <PageFrame eyebrow="Work queue / Pull requests & Issues" title="Pull Requests & Issues" description="Open GitHub work queues for the configured repository. Closed and merged records are intentionally not mixed into these views.">
      <div className="grid gap-4 xl:grid-cols-2">
        <QueuePanel icon={GitPullRequest} title="Open pull requests" result={snapshot.pullRequests} emptyTitle="No open pull requests" emptyDescription="GitHub returned no open pull requests for the configured repository." itemLabel="PR" />
        <QueuePanel icon={CircleDot} title="Open issues" result={snapshot.issues} emptyTitle="No open issues" emptyDescription="GitHub returned no open issues for the configured repository." itemLabel="Issue" />
      </div>
    </PageFrame>
  );
}

export function BuildCIHealthPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const builds = snapshot.builds;
  const successful = builds.status === "connected" ? builds.data.filter((build) => build.status === "success").length : undefined;
  const failed = builds.status === "connected" ? builds.data.filter((build) => build.status === "failure").length : undefined;

  return (
    <PageFrame eyebrow="Delivery / Build & CI Health" title="Build / CI Health" description="Recent GitHub Actions workflow runs for the configured repository, with statuses mapped directly from GitHub’s run state and conclusion.">
      {builds.status === "unavailable" ? <EmptyState title="Data source not connected" description={builds.reason} /> : builds.data.length === 0 ? <EmptyState title="No workflow runs" description="GitHub Actions returned no recent workflow runs for the configured repository." /> : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <MiniStat label="Runs returned" value={builds.data.length} />
            <MiniStat label="Successful" value={successful ?? 0} tone="success" />
            <MiniStat label="Failed" value={failed ?? 0} tone={failed ? "failure" : "neutral"} />
          </div>
          <section className="panel p-5 sm:p-6">
            <PanelTitle icon={Workflow} title="Recent workflow runs" />
            <div className="space-y-2">{builds.data.map((build) => <BuildListRow build={build} key={build.id} />)}</div>
          </section>
        </>
      )}
    </PageFrame>
  );
}

export function DataSourcesPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const github = snapshot.sources.find((source) => source.id === "github");

  return (
    <PageFrame eyebrow="Trust layer / Data Sources" title="Data Sources" description="Provider health, configuration scope, freshness, and safe failure states. Secrets stay on the server and never appear in this view.">
      {github ? <section className="panel overflow-hidden">
        <div className="border-b border-white/[0.08] p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.08] text-cyan-100/80"><GitFork size={18} /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-slate-200">{github.name}</h2><StatusPill connected={github.status === "connected"} /></div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{github.description}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600"><ShieldCheck size={13} /> Server-only access</span>
          </div>
        </div>
        <div className="grid gap-px bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-4">
          <HealthFact icon={Server} label="Provider health" value={github.status === "connected" ? "Healthy" : "Unavailable"} tone={github.status === "connected" ? "success" : "warning"} />
          <HealthFact icon={GitFork} label="Configured repository" value={github.configuredResource ?? "Not configured"} />
          <HealthFact icon={Clock3} label="Last successful fetch" value={github.lastSuccessfulFetch ? formatDate(github.lastSuccessfulFetch) : "Not available"} />
          <HealthFact icon={KeyRound} label="Authentication" value={authenticationLabel(github.authentication)} tone={github.authentication === "authenticated" ? "success" : "warning"} />
        </div>
        <div className="p-5 sm:p-6">
          <div className={`flex items-start gap-3 rounded-xl border p-4 ${github.status === "connected" ? "border-emerald-200/15 bg-emerald-200/[0.045]" : "border-amber-200/15 bg-amber-200/[0.045]"}`}>
            {github.status === "connected" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-200/80" size={16} /> : <CircleAlert className="mt-0.5 shrink-0 text-amber-100/80" size={16} />}
            <div><p className="text-sm font-medium text-slate-300">{github.message}</p><p className="mt-1 text-xs leading-5 text-slate-500">Safe provider status only. Authorization headers and token values are never exposed.</p></div>
          </div>
          <div className="mt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">Capabilities</p>
            <div className="flex flex-wrap gap-2">{github.capabilities.map((capability) => <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[11px] text-slate-400" key={capability}>{capabilityLabel(capability)}</span>)}</div>
          </div>
        </div>
      </section> : <EmptyState title="GitHub source unavailable" description="The provider registry did not return a GitHub source descriptor." />}

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        {snapshot.sources.filter((source) => source.id !== "github").map((source) => <section className="panel p-5" key={source.id}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-300">{source.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{source.description}</p></div><StatusPill connected={source.status === "connected"} /></div><p className="mt-4 text-xs leading-5 text-slate-600">{source.message}</p></section>)}
      </section>
    </PageFrame>
  );
}

function PageFrame({ eyebrow, title, description, children }: Readonly<{ eyebrow: string; title: string; description: string; children: React.ReactNode }>) {
  return <div className="fade-in-up mx-auto max-w-[1280px]"><section className="mb-8"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">{eyebrow}</p><h1 className="page-title text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-slate-100">{title}</h1><p className="mt-4 max-w-3xl text-[15px] leading-7 text-slate-400">{description}</p></section>{children}</div>;
}

function RepositoryCard({ repository, branches }: Readonly<{ repository: RepositoryRecord; branches: DataResult<BranchRecord[]> }>) {
  const repositoryBranches = branches.status === "connected" ? branches.data.filter((branch) => branch.repositoryId === repository.fullName) : [];
  return <section className="panel p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.08] text-cyan-100/80"><GitFork size={18} /></div><div className="min-w-0"><p className="truncate text-base font-semibold text-slate-200">{repository.fullName}</p><p className="mt-1 text-xs text-slate-500">{repository.visibility} repository · updated {formatDate(repository.updatedAt)}</p></div></div>{repository.url ? <ExternalLinkLink href={repository.url} label="Open repository" /> : null}</div><dl className="mt-6 grid gap-3 sm:grid-cols-2"><InfoCell label="Repository name" value={repository.name} /><InfoCell label="Default branch" value={repository.defaultBranch} /><InfoCell label="Branches returned" value={repositoryBranches.length.toLocaleString()} /><InfoCell label="Source" value="GitHub REST API" /></dl></section>;
}

function BranchPanel({ branches }: Readonly<{ branches: DataResult<BranchRecord[]> }>) {
  return <section className="panel mt-4 p-5 sm:p-6"><PanelTitle icon={GitBranch} title="Branches" />{branches.status === "unavailable" ? <EmptyState title="Branch data not available" description={branches.reason} compact /> : branches.data.length === 0 ? <EmptyState title="No branches returned" description="GitHub returned no branches for the configured repository." compact /> : <div className="grid gap-2 md:grid-cols-2">{branches.data.map((branch) => <div className="panel-subtle flex items-center justify-between gap-3 px-3.5 py-3" key={branch.id}><div className="flex min-w-0 items-center gap-2.5"><GitBranch size={14} className="shrink-0 text-slate-500" /><span className="truncate text-xs text-slate-300">{branch.name}</span></div>{branch.isDefault ? <span className="shrink-0 rounded-full bg-cyan-200/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/75">Default</span> : null}</div>)}</div>}</section>;
}

function QueuePanel<T extends PullRequestRecord | IssueRecord>({ icon: Icon, title, result, emptyTitle, emptyDescription, itemLabel }: Readonly<{ icon: LucideIcon; title: string; result: DataResult<T[]>; emptyTitle: string; emptyDescription: string; itemLabel: string }>) {
  return <section className="panel p-5 sm:p-6"><PanelTitle icon={Icon} title={title} /><QueueResult result={result} emptyTitle={emptyTitle} emptyDescription={emptyDescription} itemLabel={itemLabel} /></section>;
}

function QueueResult<T extends PullRequestRecord | IssueRecord>({ result, emptyTitle, emptyDescription, itemLabel }: Readonly<{ result: DataResult<T[]>; emptyTitle: string; emptyDescription: string; itemLabel: string }>) {
  if (result.status === "unavailable") return <EmptyState title="Data source not connected" description={result.reason} compact />;
  if (result.data.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  return <div className="space-y-2">{result.data.map((item) => <div className="panel-subtle flex items-start gap-3 px-3.5 py-3" key={item.id}><div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-500"><GitCommitHorizontal size={14} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/60">{itemLabel} #{item.number}</span><span className="text-[10px] text-slate-600">{item.repositoryId}</span></div><p className="mt-1 truncate text-xs font-medium text-slate-300">{item.title}</p><p className="mt-1 text-[10px] text-slate-600">Updated {formatDate(item.updatedAt)} by {item.author}</p></div>{item.url ? <ExternalLinkLink href={item.url} label={`Open ${itemLabel}`} /> : null}</div>)}</div>;
}

function ActivityListRow({ record }: Readonly<{ record: ActivityRecord }>) {
  const row = <div className="panel-subtle flex items-start gap-3 px-3.5 py-3 transition hover:border-white/[0.18]"><div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-500"><ActivityIcon kind={record.kind} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/60">{record.kind}</span><span className="text-[10px] text-slate-600">{record.repositoryId}</span></div><p className="mt-1 truncate text-xs font-medium text-slate-300">{record.title}</p><p className="mt-1 truncate text-[10px] text-slate-600">{record.summary} · {formatDate(record.occurredAt)}</p></div></div>;
  return record.url ? <a href={record.url} target="_blank" rel="noreferrer">{row}</a> : row;
}

function BuildListRow({ build }: Readonly<{ build: BuildRecord }>) {
  const label = build.status === "in-progress" ? "In progress" : build.status;
  const tone = build.status === "success" ? "text-emerald-200/80 bg-emerald-200/[0.07]" : build.status === "failure" ? "text-rose-200/80 bg-rose-200/[0.07]" : "text-amber-100/75 bg-amber-200/[0.07]";
  const row = <div className="panel-subtle flex items-center gap-3 px-3.5 py-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-500"><Workflow size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-300">{build.name}</p><p className="mt-1 truncate text-[10px] text-slate-600">{build.repositoryId} · {formatDate(build.completedAt ?? build.startedAt)}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone}`}>{label}</span></div>;
  return build.url ? <a href={build.url} target="_blank" rel="noreferrer">{row}</a> : row;
}

function TrendCard({ label, result }: Readonly<{ label: string; result: DataResult<ActivityTrendPoint[]> }>) {
  if (result.status === "unavailable") return <section className="panel p-5"><PanelTitle icon={Activity} title={label} /><EmptyState title="Data source not connected" description={result.reason} compact /></section>;
  if (result.data.length === 0) return <section className="panel p-5"><PanelTitle icon={Activity} title={label} /><EmptyState title="No trend data returned" description="GitHub returned no points for this period." compact /></section>;
  const max = Math.max(...result.data.map((point) => point.value), 1);
  const total = result.data.reduce((sum, point) => sum + point.value, 0);
  return <section className="panel p-5"><div className="mb-5 flex items-center justify-between gap-3"><PanelTitle icon={Activity} title={label} /><span className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/70">Live</span></div><div className="flex h-24 items-end gap-1 rounded-lg border border-white/[0.06] bg-black/10 px-2 pb-2 pt-3">{result.data.map((point) => <div className="group flex h-full min-w-0 flex-1 items-end" key={`${point.label}-${point.value}`} title={`${point.label}: ${point.value} commits`}><div className="w-full rounded-sm bg-cyan-200/65 transition group-hover:bg-cyan-100" style={{ height: `${point.value === 0 ? 3 : Math.max(10, Math.round((point.value / max) * 100))}%` }} /></div>)}</div><div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-600"><span>{result.data[0]?.label}</span><span className="text-slate-500">{total.toLocaleString()} commits</span><span>{result.data.at(-1)?.label}</span></div></section>;
}

function PanelTitle({ icon: Icon, title }: Readonly<{ icon: LucideIcon; title: string }>) {
  return <div className="mb-5 flex items-center gap-2.5"><Icon size={15} className="text-slate-500" /><h2 className="text-sm font-semibold text-slate-300">{title}</h2></div>;
}

function MiniStat({ label, value, tone = "neutral" }: Readonly<{ label: string; value: number; tone?: "success" | "failure" | "neutral" }>) {
  const valueTone = tone === "success" ? "text-emerald-200/90" : tone === "failure" ? "text-rose-200/90" : "text-slate-100";
  return <div className="panel p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</p><p className={`mt-2 text-2xl font-semibold tracking-[-0.04em] ${valueTone}`}>{value.toLocaleString()}</p><p className="mt-1 text-[11px] text-slate-600">GitHub Actions runs</p></div>;
}

function HealthFact({ icon: Icon, label, value, tone = "neutral" }: Readonly<{ icon: LucideIcon; label: string; value: string; tone?: "success" | "warning" | "neutral" }>) {
  const valueTone = tone === "success" ? "text-emerald-200/85" : tone === "warning" ? "text-amber-100/80" : "text-slate-300";
  return <div className="bg-[#151b22] p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-600"><Icon size={12} /> {label}</div><p className={`mt-2 truncate text-sm font-medium ${valueTone}`} title={value}>{value}</p></div>;
}

function InfoCell({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3"><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-600">{label}</dt><dd className="mt-1.5 truncate text-xs font-medium text-slate-300">{value}</dd></div>;
}

function Freshness({ value }: Readonly<{ value?: string }>) {
  return <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-slate-600"><Clock3 size={12} /> {value ? `Fetched ${formatDate(value)}` : "Fetch time unavailable"}</span>;
}

function ExternalLinkLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return <a className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-cyan-100/70 transition hover:text-cyan-50" href={href} target="_blank" rel="noreferrer">{label} <ExternalLink size={12} /></a>;
}

function GitHubStatusIcon({ connected }: Readonly<{ connected: boolean }>) {
  return connected ? <CheckCircle2 size={12} className="text-emerald-200/80" /> : <CircleAlert size={12} className="text-amber-100/70" />;
}

function ActivityIcon({ kind }: Readonly<{ kind: ActivityRecord["kind"] }>) {
  if (kind === "commit") return <GitCommitHorizontal size={14} />;
  if (kind === "pull-request") return <GitPullRequest size={14} />;
  if (kind === "issue") return <CircleDot size={14} />;
  return <GitBranch size={14} />;
}

function authenticationLabel(value: string) {
  if (value === "authenticated") return "Authenticated";
  if (value === "unauthorized") return "Unauthorized";
  if (value === "permission-denied") return "Permission denied";
  if (value === "not-configured") return "Not configured";
  return "Unknown";
}

function capabilityLabel(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
