import Link from "next/link";
import { Activity, AlertTriangle, Bot, Boxes, Clock3, GitCommitHorizontal, ShieldCheck, Workflow } from "lucide-react";

import { Distribution, TokenTrend } from "@/components/dashboard/analytics-ui";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { compactNumber, measuredValue, selectTrend, selectUsage, type DashboardRange } from "@/lib/dashboard/analytics";
import type { getCodexPageData, getGitHubPageData } from "@/lib/dashboard/queries";
import type { CodexActivityRecord, DataResult, IssueRecord, PullRequestRecord } from "@/lib/providers/types";

type CodexData = Awaited<ReturnType<typeof getCodexPageData>>;
type GitHubData = Awaited<ReturnType<typeof getGitHubPageData>>;

export function CodexCommandPage({ data, section }: Readonly<{ data: CodexData; section?: string }>) {
  const telemetry = data.snapshot;
  const usageResult = selectUsage(telemetry, data.range);
  const trend = selectTrend(telemetry, data.range);
  const usage = usageResult.status === "connected" ? usageResult.data : undefined;
  const summary = telemetry.rollupSummaries?.[data.range];
  const latest = telemetry.sessions.status === "connected" ? telemetry.sessions.data[0] : undefined;
  const detailOpen = (name: string) => section === name;
  return <div className="command-page fade-in-up">
    <header className="command-hero">
      <div><p className="eyebrow">Private operational telemetry</p><h1>Codex</h1><p>What Codex is doing, whether the pipeline is healthy, and the few measurements that matter.</p></div>
      <div className="command-actions"><RangeLinks range={data.range} /><RefreshButton /></div>
    </header>
    <section className="command-health-strip">
      <StatusPill status={telemetry.health.status} />
      <span><span className="status-dot text-emerald-300" /> Snapshot reads only</span>
      <span>Last telemetry: {formatAge(telemetry.lastReceivedAt)}</span>
      <span>Snapshot: {summary?.generatedAt ? formatAge(summary.generatedAt) : "Unavailable"}</span>
      <span className="ml-auto"><ShieldCheck size={13} /> Privacy-filtered</span>
    </section>

    {usageResult.status === "unavailable" ? <EmptyState title="Rollup analytics unavailable" description={usageResult.reason} /> : <>
      <section className="command-stat-grid">
        <Metric label="Sessions" value={summary?.sessions} />
        <Metric label="Input tokens" value={measuredValue(usage?.inputTokens)} />
        <Metric label="Output tokens" value={measuredValue(usage?.outputTokens)} />
        <Metric label="Cached / read" value={measuredValue(usage?.cachedInputTokens)} />
        <Metric label="Reasoning" value={measuredValue(usage?.reasoningTokens)} />
        <Metric label="Tool tokens" value={measuredValue(usage?.toolTokens)} />
      </section>

      <section className="command-primary-grid">
        <Panel title="Activity" icon={Activity} note={data.range.toUpperCase()}><TokenTrend result={trend} /></Panel>
        <Panel title="Current / latest" icon={Bot}>
          <dl className="command-facts">
            <Fact label="Model" value={latest?.models[0] ?? "Unavailable"} />
            <Fact label="Reasoning" value={latest?.reasoningEfforts[0] ?? "Unavailable"} />
            <Fact label="Last session" value={latest ? formatAge(latest.lastSeenAt) : "No session"} />
            <Fact label="Events" value={summary?.events.toLocaleString() ?? "Unavailable"} />
          </dl>
        </Panel>
        <Panel title="Performance" icon={Clock3}>
          <dl className="command-facts">
            <Fact label="Average TTFT" value={duration(summary?.averageTtftMs)} />
            <Fact label="Completed tools" value={compactNumber(summary?.completedTools)} />
            <Fact label="Failed tools" value={compactNumber(summary?.failedTools)} warning={Boolean(summary?.failedTools)} />
            <Fact label="Errors" value={compactNumber(summary?.errors)} warning={Boolean(summary?.errors)} />
          </dl>
        </Panel>
      </section>

      <section className="command-distribution-grid">
        <Panel title="Model distribution" icon={Bot}><Distribution result={telemetry.models} /></Panel>
        <Panel title="Reasoning effort" icon={Boxes}><Distribution result={telemetry.reasoningEfforts} /></Panel>
        <Panel title="Latest session" icon={Activity}>
          {latest ? <div className="latest-session"><strong>{latest.models[0] ?? "Model unavailable"}</strong><span>{latest.reasoningEfforts[0] ?? "Effort unavailable"}</span><p>{latest.eventCount.toLocaleString()} events · {latest.toolExecutions.toLocaleString()} tools · {latest.errorCount.toLocaleString()} errors</p><small>{formatDate(latest.firstSeenAt)} → {formatDate(latest.lastSeenAt)}</small></div> : <EmptyState compact title="No session summary" description="No materialized session summary is available in this range." />}
        </Panel>
      </section>
    </>}

    <div className="command-details">
      <Detail title="Usage & performance" open={detailOpen("usage")}>
        <div className="detail-grid"><Fact label="Cache writes" value={usage ? metricLabel(usage.cacheWriteTokens) : "Unavailable"} /><Fact label="Average duration" value={duration(summary?.averageDurationMs)} /><Fact label="Approvals" value={compactNumber(summary?.approvals)} /><Fact label="Warnings" value={compactNumber(summary?.warnings)} /></div>
      </Detail>
      <Detail title="Sessions" open={detailOpen("sessions")}>
        {telemetry.sessions.status === "unavailable" ? <EmptyState compact description={telemetry.sessions.reason} /> : telemetry.sessions.data.length ? <div className="compact-list">{telemetry.sessions.data.slice(0, 20).map((session) => <div key={session.sessionId}><span><b>{session.models[0] ?? "Unknown model"}</b><small>{session.reasoningEfforts[0] ?? "effort unavailable"}</small></span><span>{session.eventCount} events · {session.toolExecutions} tools</span><time>{formatAge(session.lastSeenAt)}</time></div>)}</div> : <EmptyState compact title="No sessions" description="No sessions fall in this materialized range." />}
      </Detail>
      <Detail title="Tools" open={detailOpen("tools")}>
        <div className="detail-grid"><Fact label="Completed" value={compactNumber(summary?.completedTools)} /><Fact label="Failed" value={compactNumber(summary?.failedTools)} warning={Boolean(summary?.failedTools)} /><Fact label="Tool tokens" value={usage ? metricLabel(usage.toolTokens) : "Unavailable"} /><Fact label="Average duration" value={duration(summary?.averageDurationMs)} /></div>
      </Detail>
      <Detail title="Forensics" open={detailOpen("forensics") || Boolean(data.forensics)}>
        {data.forensics ? <Forensics result={data.forensics} /> : <div className="forensics-gate"><ShieldCheck size={18} /><div><b>Raw telemetry is not loaded by default.</b><p>This explicit action runs the bounded 30-day forensic query path. Normal page and overlay reads never use it.</p></div><Link href={`/?range=${data.range}&section=forensics&forensics=1`}>Load forensics</Link></div>}
      </Detail>
      <Detail title="Data health" open={detailOpen("data-health")}>
        <div className="detail-grid"><Fact label="D1 summary" value={telemetry.health.status} /><Fact label="Storage" value={telemetry.health.configuredResource ?? "Unavailable"} /><Fact label="Raw retention" value={`${telemetry.retentionDays} days`} /><Fact label="Normal read path" value="3 snapshot rows maximum" /></div>
        <p className="detail-note">Ingest updates grouped hourly, model, reasoning, and session rollups. Materialized 24-hour snapshots refresh at most once per minute; 7- and 30-day snapshots refresh at most every 15 minutes. Raw events are retained for explicit forensics only.</p>
      </Detail>
    </div>
  </div>;
}

export function GitHubCommandPage({ data, section }: Readonly<{ data: GitHubData; section?: string }>) {
  const github = data.snapshot;
  const repository = github.repositories.status === "connected" ? github.repositories.data[0] : undefined;
  const commit = github.commits.status === "connected" ? github.commits.data[0] : undefined;
  const build = github.builds.status === "connected" ? github.builds.data[0] : undefined;
  const open = (name: string) => section === name;
  return <div className="command-page fade-in-up">
    <header className="command-hero"><div><p className="eyebrow">Repository operations</p><h1>GitHub</h1><p>Repository state, work queues, delivery health, and activity from the configured read-only provider.</p></div><RefreshButton /></header>
    <section className="command-health-strip"><StatusPill status={github.health.status} /><span>{github.health.configuredResource ?? "Repository not configured"}</span><span>Fetched: {formatAge(github.health.lastSuccessfulFetch)}</span><span className="ml-auto"><ShieldCheck size={13} /> Server-only token</span></section>
    <section className="command-stat-grid github">
      <Metric label="Repository" text={repository?.name ?? "Unavailable"} />
      <Metric label="Default branch" text={repository?.defaultBranch ?? "Unavailable"} />
      <Metric label="Open PRs" value={connectedLength(github.pullRequests)} />
      <Metric label="Open issues" value={connectedLength(github.issues)} />
      <Metric label="CI" text={build?.status ?? "Unavailable"} />
      <Metric label="Branches" value={connectedLength(github.branches)} />
    </section>
    <section className="command-primary-grid github">
      <Panel title="Latest commit" icon={GitCommitHorizontal}>{commit ? <Record title={commit.message} meta={`${commit.author} · ${formatAge(commit.committedAt)}`} /> : <EmptyState compact title="No commit returned" description="No recent commit is available." />}</Panel>
      <Panel title="Current delivery" icon={Workflow}>{build ? <Record title={build.name} meta={`${build.status} · ${formatAge(build.completedAt ?? build.startedAt)}`} /> : <EmptyState compact title="No workflow run" description="GitHub Actions returned no recent run." />}</Panel>
      <Panel title="Recent activity" icon={Activity}>{github.activity.status === "connected" && github.activity.data[0] ? <Record title={github.activity.data[0].title} meta={`${github.activity.data[0].kind} · ${formatAge(github.activity.data[0].occurredAt)}`} /> : <EmptyState compact title="No activity returned" description="No recent GitHub activity is available." />}</Panel>
    </section>
    <div className="command-details">
      <Detail title="Repository" open={open("repository")}><div className="detail-grid"><Fact label="Full name" value={repository?.fullName ?? "Unavailable"} /><Fact label="Visibility" value={repository?.visibility ?? "Unavailable"} /><Fact label="Default branch" value={repository?.defaultBranch ?? "Unavailable"} /><Fact label="Updated" value={repository ? formatDate(repository.updatedAt) : "Unavailable"} /></div></Detail>
      <Detail title="Pull requests" open={open("pull-requests")}><Queue result={github.pullRequests} kind="PR" /></Detail>
      <Detail title="Issues" open={open("issues")}><Queue result={github.issues} kind="Issue" /></Detail>
      <Detail title="Build / CI" open={open("build-ci")}><CompactRecords result={github.builds} select={(item) => ({ title: item.name, meta: `${item.status} · ${formatAge(item.completedAt ?? item.startedAt)}` })} /></Detail>
      <Detail title="Branches" open={open("branches")}><CompactRecords result={github.branches} select={(item) => ({ title: item.name, meta: item.isDefault ? "Default branch" : "Branch" })} /></Detail>
      <Detail title="Actions / activity" open={open("activity")}><CompactRecords result={github.activity} select={(item) => ({ title: item.title, meta: `${item.kind} · ${formatAge(item.occurredAt)}` })} /></Detail>
    </div>
  </div>;
}

function Forensics({ result }: Readonly<{ result: NonNullable<CodexData["forensics"]> }>) {
  if (result.status === "unavailable") return <EmptyState compact title="Forensics unavailable" description={result.reason} />;
  return <><div className="forensics-loaded"><AlertTriangle size={14} /><span>Explicit raw read completed at {formatDate(result.data.loadedAt)}. It will not repeat unless this URL is loaded again.</span></div>{result.data.activity.length ? <div className="compact-list">{result.data.activity.slice(0, 25).map((event) => <EventRecord event={event} key={event.id} />)}</div> : <EmptyState compact title="No forensic events" description="No retained raw events were returned." />}</>;
}
function EventRecord({ event }: Readonly<{ event: CodexActivityRecord }>) { return <div><span><b>{event.eventName}</b><small>{event.category} · {event.model ?? "model unavailable"}</small></span><span>{event.toolName ?? event.status ?? "No additional safe dimension"}</span><time>{formatAge(event.occurredAt)}</time></div>; }
function RangeLinks({ range }: Readonly<{ range: DashboardRange }>) { return <div className="command-range">{(["24h", "7d", "30d"] as DashboardRange[]).map((item) => <Link className={range === item ? "active" : ""} href={`/?range=${item}`} key={item}>{item.toUpperCase()}</Link>)}</div>; }
function Metric({ label, value, text }: Readonly<{ label: string; value?: number; text?: string }>) { return <article className="command-metric"><span>{label}</span><strong>{text ?? compactNumber(value)}</strong></article>; }
function Panel({ title, icon: Icon, note, children }: Readonly<{ title: string; icon: typeof Activity; note?: string; children: React.ReactNode }>) { return <section className="panel command-panel"><header><span><Icon size={14} />{title}</span>{note ? <small>{note}</small> : null}</header>{children}</section>; }
function Fact({ label, value, warning }: Readonly<{ label: string; value: string; warning?: boolean }>) { return <div className={warning ? "warning" : ""}><dt>{label}</dt><dd>{value}</dd></div>; }
function Detail({ title, open, children }: Readonly<{ title: string; open?: boolean; children: React.ReactNode }>) { return <details className="command-detail" open={open}><summary>{title}<span>+</span></summary><div>{children}</div></details>; }
function Record({ title, meta }: Readonly<{ title: string; meta: string }>) { return <div className="command-record"><b>{title}</b><span>{meta}</span></div>; }
function Queue<T extends PullRequestRecord | IssueRecord>({ result, kind }: Readonly<{ result: DataResult<T[]>; kind: string }>) { return <CompactRecords result={result} select={(item) => ({ title: `${kind} #${item.number} · ${item.title}`, meta: `${item.author} · ${formatAge(item.updatedAt)}` })} />; }
function CompactRecords<T>({ result, select }: Readonly<{ result: DataResult<T[]>; select: (item: T) => { title: string; meta: string } }>) { if (result.status === "unavailable") return <EmptyState compact description={result.reason} />; if (!result.data.length) return <EmptyState compact title="Nothing open" description="The provider returned no records for this section." />; return <div className="compact-list">{result.data.slice(0, 20).map((item, index) => { const record = select(item); return <div key={index}><span><b>{record.title}</b><small>{record.meta}</small></span></div>; })}</div>; }
function connectedLength<T>(result: DataResult<T[]>) { return result.status === "connected" ? result.data.length : undefined; }
function metricLabel(metric: { availability: string; value?: number }) { return metric.availability === "available" ? compactNumber(metric.value) : metric.availability === "no-samples" ? "No samples" : "Unavailable"; }
function duration(value?: number) { return value === undefined ? "Unavailable" : value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`; }
function formatAge(value?: string) { if (!value) return "Unavailable"; const age = Date.now() - Date.parse(value); if (!Number.isFinite(age)) return "Unavailable"; if (age < 60_000) return `${Math.max(0, Math.round(age / 1_000))}s ago`; if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`; return `${Math.round(age / 86_400_000)}d ago`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
