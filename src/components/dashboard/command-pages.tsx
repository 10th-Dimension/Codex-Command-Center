import Link from "next/link";
import { Activity, AlertTriangle, Bot, Boxes, Clock3, GitCommitHorizontal, ShieldCheck, Workflow } from "lucide-react";

import { ActivityHeatmap, Distribution, TokenComposition, TokenTrend } from "@/components/dashboard/analytics-ui";
import { LocalCodexAccount } from "@/components/dashboard/local-codex-account";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { compactNumber, selectTrend, selectUsage, type DashboardRange } from "@/lib/dashboard/analytics";
import type { getCodexPageData, getGitHubPageData } from "@/lib/dashboard/queries";
import type { CodexActivityRecord, CodexTelemetrySessionSummary, CodexUsageSnapshot, DataResult, IssueRecord, PullRequestRecord } from "@/lib/providers/types";

type CodexData = Awaited<ReturnType<typeof getCodexPageData>>;
type GitHubData = Awaited<ReturnType<typeof getGitHubPageData>>;
type CodexSummary = NonNullable<NonNullable<CodexData["snapshot"]["rollupSummaries"]>["24h"]>;

export function CodexCommandPage({ data, section }: Readonly<{ data: CodexData; section?: string }>) {
  const telemetry = data.snapshot;
  const usageResult = selectUsage(telemetry, data.range);
  const trend = selectTrend(telemetry, data.range);
  const usage = usageResult.status === "connected" ? usageResult.data : undefined;
  const summary = telemetry.rollupSummaries?.[data.range];
  const latest = telemetry.sessions.status === "connected" ? telemetry.sessions.data[0] : undefined;
  const totalTokens = sumMeasured([usage?.inputTokens, usage?.outputTokens, usage?.cachedInputTokens, usage?.cacheWriteTokens, usage?.reasoningTokens, usage?.toolTokens]);
  const activeBuckets = trend.status === "connected" ? trend.data.filter((point) => point.events > 0).length : undefined;
  const peakEvents = trend.status === "connected" && trend.data.length ? Math.max(...trend.data.map((point) => point.events)) : undefined;
  const modelCount = telemetry.models.status === "connected" ? telemetry.models.data.length : undefined;
  const detailOpen = (name: string) => section === name;
  return <div className="command-page fade-in-up">
    <header className="command-hero command-hero-modern">
      <div className="command-hero-copy"><div className="command-kicker"><span className="command-kicker-mark"><Activity size={12} /></span><span>Workspace telemetry</span><span className="command-kicker-status"><span className="status-dot" /> bounded snapshot</span></div><h1>Codex, at a glance.</h1><p>Measured usage, live operational context, and delivery signal in one private workspace view.</p></div>
      <div className="command-actions"><RangeLinks range={data.range} /><Link className="command-secondary-action" href="/overlay">Open overlay</Link><RefreshButton /></div>
    </header>
    <section className="command-health-strip command-health-strip-modern">
      <StatusPill status={telemetry.health.status} />
      <span><span className="status-dot text-emerald-300" /> Snapshot reads only</span>
      <span>Last telemetry: {formatAge(telemetry.lastReceivedAt)}</span>
      <span>Snapshot: {summary?.generatedAt ? formatAge(summary.generatedAt) : "Unavailable"}</span>
      <span className="ml-auto"><ShieldCheck size={13} /> Privacy-filtered · no prompt content</span>
    </section>

    <LocalCodexAccount />

    <section className="command-stat-grid command-stat-grid-ribbon">
      <Metric href={`/?range=${data.range}&section=usage`} label="Events observed" value={summary?.events} note={`${data.range.toUpperCase()} window`} />
      <Metric href={`/?range=${data.range}&section=sessions`} label="Sessions" value={summary?.sessions} note="materialized summaries" />
      <Metric href={`/?range=${data.range}&section=usage`} label="Measured tokens" value={totalTokens} note="emitted samples only" />
      <Metric href={`/?range=${data.range}&section=usage`} label="Peak bucket" value={peakEvents} note="events in one bucket" />
      <Metric href={`/?range=${data.range}&section=usage`} label="Active buckets" value={activeBuckets} note="non-zero observations" />
      <Metric href={`/?range=${data.range}&section=usage`} label="Models" value={modelCount} note="bounded distribution" />
    </section>

    {usageResult.status === "unavailable" ? <section className="command-unavailable-panel"><EmptyState title="Rollup analytics unavailable" description={usageResult.reason} /></section> : null}

    <section className="command-overview-grid">
      <Panel className="overview-activity-panel" title="Token activity" icon={Activity} note={data.range.toUpperCase()}>
        <div className="overview-panel-intro"><span>Observed token movement</span><small>{summary?.events.toLocaleString() ?? "—"} events · no estimated cost</small></div>
        <TokenTrend result={trend} />
        <div className="activity-map-heading"><span>Activity density</span><small>Each cell is an observed time bucket</small></div>
        <ActivityHeatmap result={trend} />
      </Panel>
      <Panel className="overview-live-panel" title="Live operations" icon={Activity} note="observed state">
        <LiveOperations telemetry={telemetry} latest={latest} summary={summary} />
      </Panel>
      <Panel className="overview-composition-panel" title="Measured composition" icon={Boxes} note="token fields">
        <TokenComposition result={usageResult} />
      </Panel>
      <Panel className="overview-model-panel" title="Model mix" icon={Bot} note="top 5">
        <Distribution result={telemetry.models} />
      </Panel>
      <Panel className="overview-reasoning-panel" title="Reasoning effort" icon={Boxes} note="top 5">
        <Distribution result={telemetry.reasoningEfforts} />
      </Panel>
      <Panel className="overview-session-panel" title="Latest session" icon={Clock3} note={latest ? formatAge(latest.lastSeenAt) : "no session"}>
        {latest ? <div className="latest-session"><strong>{latest.models[0] ?? "Model unavailable"}</strong><span>{latest.reasoningEfforts[0] ?? "Effort unavailable"}</span><p>{latest.eventCount.toLocaleString()} events · {latest.toolExecutions.toLocaleString()} tools · {latest.errorCount.toLocaleString()} errors</p><small>{formatDate(latest.firstSeenAt)} → {formatDate(latest.lastSeenAt)}</small></div> : <EmptyState compact title="No session summary" description="No materialized session summary is available in this range." />}
      </Panel>
    </section>

    <MeasuredLedger result={usageResult} range={data.range} />

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
        {data.forensics ? <Forensics result={data.forensics} /> : <div className="forensics-gate"><ShieldCheck size={18} /><div><b>Raw telemetry is not loaded by default.</b><p>This explicit action runs the bounded 30-day forensic query path and refuses windows above 50,000 raw events. Normal page and overlay reads never use it.</p></div><Link href={`/?range=${data.range}&section=forensics&forensics=1`}>Load forensics</Link></div>}
      </Detail>
      <Detail title="Data health" open={detailOpen("data-health")}>
        <div className="detail-grid"><Fact label="D1 summary" value={telemetry.health.status} /><Fact label="Storage" value={telemetry.health.configuredResource ?? "Unavailable"} /><Fact label="Raw retention" value={`${telemetry.retentionDays} days`} /><Fact label="Normal read path" value="3 snapshot rows maximum" /><Fact label="Dashboard writes" value="None" /><Fact label="Duplicate retry path" value="Maintenance skipped" /></div>
        <p className="detail-note">Ingest updates grouped hourly, model, reasoning, and session rollups. Materialized 24-hour snapshots refresh at most once per minute; 7- and 30-day snapshots refresh at most every 15 minutes. Raw events are retained for explicit forensics only. Dashboard refreshes and overlay reads never write D1; duplicate-only ingest retries skip cleanup and snapshot maintenance.</p>
      </Detail>
    </div>
  </div>;
}

function LiveOperations({ telemetry, latest, summary }: Readonly<{ telemetry: CodexData["snapshot"]; latest?: CodexTelemetrySessionSummary; summary?: CodexSummary }>) {
  const lastObserved = telemetry.lastReceivedAt ?? latest?.lastSeenAt;
  return <div className="live-operations">
    <div className={`live-observed-card ${telemetry.health.status}`}><span className="live-observed-dot" /><div><strong>{latest ? "Session observed" : "No session observed"}</strong><small>{latest ? `${latest.models[0] ?? "Model unavailable"} · ${latest.reasoningEfforts[0] ?? "effort unavailable"}` : "No bounded session summary was emitted."}</small></div><time>{formatAge(lastObserved)}</time></div>
    <dl className="live-facts"><Fact label="Telemetry" value={telemetry.health.status} /><Fact label="Latest events" value={summary?.events.toLocaleString() ?? "Unavailable"} /><Fact label="Approval events" value={compactNumber(summary?.approvals)} /><Fact label="Failed tools" value={compactNumber(summary?.failedTools)} warning={Boolean(summary?.failedTools)} /></dl>
    <div className="live-note"><ShieldCheck size={14} /><span>Privacy-safe live context only. Pending approvals, prompts, commands, and agent graph details are not emitted into this bounded surface.</span></div>
  </div>;
}

function MeasuredLedger({ result, range }: Readonly<{ result: DataResult<CodexUsageSnapshot>; range: DashboardRange }>) {
  const fields: Array<{ key: "inputTokens" | "outputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "reasoningTokens" | "toolTokens"; label: string }> = [
    { key: "inputTokens", label: "Input" },
    { key: "outputTokens", label: "Output" },
    { key: "cachedInputTokens", label: "Cached" },
    { key: "cacheWriteTokens", label: "Cache write" },
    { key: "reasoningTokens", label: "Reasoning" },
    { key: "toolTokens", label: "Tool" },
  ];
  return <section className="panel usage-ledger">
    <header><div><span>Measured token ledger</span><small>{range.toUpperCase()} · exact emitted fields</small></div><span className="ledger-badge">No fabricated cost</span></header>
    <div className="usage-ledger-body">
      <div className="usage-table-wrap"><table><thead><tr><th>Field</th><th>Exact tokens</th><th>Sample state</th></tr></thead><tbody>{fields.map((field) => {
        const metric = result.status === "connected" ? result.data[field.key] : undefined;
        return <tr key={field.key}><th scope="row">{field.label}</th><td>{metric ? metricLabel(metric) : "Unavailable"}</td><td>{metric?.availability === "available" ? `${metric.sampleCount.toLocaleString()} samples` : metric?.availability === "no-samples" ? "No samples" : "Unavailable"}</td></tr>;
      })}</tbody></table></div>
      <aside className="ledger-note"><span>Billing equivalent</span><strong>Unavailable</strong><p>No pricing source is configured. The dashboard reports measured token counts exactly and does not turn operational telemetry into a bill.</p></aside>
    </div>
  </section>;
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
function Metric({ label, value, text, note, href, tooltip }: Readonly<{ label: string; value?: number; text?: string; note?: string; href?: string; tooltip?: string }>) {
  const exact = text ?? (value === undefined ? "Unavailable" : value.toLocaleString("en-US"));
  const body = <><span>{label}</span><strong>{text ?? compactNumber(value)}</strong>{note ? <small>{note}</small> : null}</>;
  const props = { className: `command-metric ${href ? "command-metric-link" : ""}`, "data-tooltip": tooltip ?? `${label}: ${exact}`, title: tooltip ?? `${label}: ${exact}` };
  return href ? <Link {...props} href={href}>{body}</Link> : <article {...props}>{body}</article>;
}
function Panel({ title, icon: Icon, note, className, children }: Readonly<{ title: string; icon: typeof Activity; note?: string; className?: string; children: React.ReactNode }>) { return <section className={`panel command-panel ${className ?? ""}`}><header><span><Icon size={14} />{title}</span>{note ? <small>{note}</small> : null}</header>{children}</section>; }
function Fact({ label, value, warning }: Readonly<{ label: string; value: string; warning?: boolean }>) { return <div className={warning ? "warning" : ""}><dt>{label}</dt><dd>{value}</dd></div>; }
function Detail({ title, open, children }: Readonly<{ title: string; open?: boolean; children: React.ReactNode }>) { return <details className="command-detail" open={open}><summary>{title}<span>+</span></summary><div>{children}</div></details>; }
function Record({ title, meta }: Readonly<{ title: string; meta: string }>) { return <div className="command-record"><b>{title}</b><span>{meta}</span></div>; }
function Queue<T extends PullRequestRecord | IssueRecord>({ result, kind }: Readonly<{ result: DataResult<T[]>; kind: string }>) { return <CompactRecords result={result} select={(item) => ({ title: `${kind} #${item.number} · ${item.title}`, meta: `${item.author} · ${formatAge(item.updatedAt)}` })} />; }
function CompactRecords<T>({ result, select }: Readonly<{ result: DataResult<T[]>; select: (item: T) => { title: string; meta: string } }>) { if (result.status === "unavailable") return <EmptyState compact description={result.reason} />; if (!result.data.length) return <EmptyState compact title="Nothing open" description="The provider returned no records for this section." />; return <div className="compact-list">{result.data.slice(0, 20).map((item, index) => { const record = select(item); return <div key={index}><span><b>{record.title}</b><small>{record.meta}</small></span></div>; })}</div>; }
function connectedLength<T>(result: DataResult<T[]>) { return result.status === "connected" ? result.data.length : undefined; }
function metricLabel(metric: { availability: string; value?: number }) { return metric.availability === "available" ? compactNumber(metric.value) : metric.availability === "no-samples" ? "No samples" : "Unavailable"; }
function sumMeasured(metrics: Array<{ availability: string; value?: number } | undefined>) { const values = metrics.flatMap((metric) => metric?.availability === "available" && metric.value !== undefined ? [metric.value] : []); return values.length ? values.reduce((total, value) => total + value, 0) : undefined; }
function duration(value?: number) { return value === undefined ? "Unavailable" : value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`; }
function formatAge(value?: string) { if (!value) return "Unavailable"; const age = Date.now() - Date.parse(value); if (!Number.isFinite(age)) return "Unavailable"; if (age < 60_000) return `${Math.max(0, Math.round(age / 1_000))}s ago`; if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`; return `${Math.round(age / 86_400_000)}d ago`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
