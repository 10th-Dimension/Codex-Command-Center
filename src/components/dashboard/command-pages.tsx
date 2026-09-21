import Link from "next/link";
import { Activity, AlertTriangle, BarChart3, Bot, Boxes, Clock3, GitCommitHorizontal, ListTree, ShieldCheck, Workflow } from "lucide-react";

import { ActivityHeatmap, Distribution, TokenComposition, TokenTrend } from "@/components/dashboard/analytics-ui";
import { LocalCodexAccount } from "@/components/dashboard/local-codex-account";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { compactNumber, selectTrend, selectUsage, type DashboardRange } from "@/lib/dashboard/analytics";
import { codexWorkspaceMode, type CodexWorkspaceMode } from "@/lib/navigation";
import type { getCodexPageData, getGitHubPageData } from "@/lib/dashboard/queries";
import type { CodexActivityRecord, CodexTelemetrySessionSummary, CodexUsageSnapshot, DataResult, IssueRecord, PullRequestRecord } from "@/lib/providers/types";
import type { CodexEquivalentPricing } from "@/lib/telemetry/pricing";

type CodexData = Awaited<ReturnType<typeof getCodexPageData>>;
type GitHubData = Awaited<ReturnType<typeof getGitHubPageData>>;
type CodexSummary = NonNullable<NonNullable<CodexData["snapshot"]["rollupSummaries"]>["24h"]>;

export function CodexCommandPage({ data, section }: Readonly<{ data: CodexData; section?: string }>) {
  const telemetry = data.snapshot;
  const usageResult = selectUsage(telemetry, data.range);
  const pricingResult: DataResult<CodexEquivalentPricing> = telemetry.pricing ?? { status: "unavailable", source: "codex", reason: "Pricing is not available in this snapshot yet." };
  const trend = selectTrend(telemetry, data.range);
  const usage = usageResult.status === "connected" ? usageResult.data : undefined;
  const summary = telemetry.rollupSummaries?.[data.range];
  const latest = telemetry.sessions.status === "connected" ? telemetry.sessions.data[0] : undefined;
  const totalTokens = sumMeasured([usage?.inputTokens, usage?.outputTokens, usage?.cachedInputTokens, usage?.cacheWriteTokens, usage?.reasoningTokens, usage?.toolTokens]);
  const activeBuckets = trend.status === "connected" ? trend.data.filter((point) => point.events > 0).length : undefined;
  const peakEvents = trend.status === "connected" && trend.data.length ? Math.max(...trend.data.map((point) => point.events)) : undefined;
  const modelCount = telemetry.models.status === "connected" ? telemetry.models.data.length : undefined;
  const mode = codexWorkspaceMode(section);
  const detailOpen = (name: string) => section === name;
  const rangeSection = mode === "overview" ? undefined : section ?? (mode === "usage" ? "usage" : "activity");
  return <div className="command-page fade-in-up">
    <header className="command-hero command-hero-modern">
      <CodexHeroCopy mode={mode} />
      <div className="command-actions"><RangeLinks range={data.range} section={rangeSection} /><Link className="command-secondary-action" href="/overlay">Open overlay</Link><RefreshButton /></div>
    </header>
    <section className="command-health-strip command-health-strip-modern">
      <StatusPill status={telemetry.health.status} />
      <span><span className="status-dot text-emerald-300" /> Snapshot reads only</span>
      <span>Last telemetry: {formatAge(telemetry.lastReceivedAt)}</span>
      <span>Snapshot: {summary?.generatedAt ? formatAge(summary.generatedAt) : "Unavailable"}</span>
      <span className="ml-auto"><ShieldCheck size={13} /> Privacy-filtered · no prompt content</span>
    </section>

    {mode === "overview" ? <OverviewWorkspace data={data} usageResult={usageResult} trend={trend} usage={usage} summary={summary} latest={latest} totalTokens={totalTokens} activeBuckets={activeBuckets} peakEvents={peakEvents} modelCount={modelCount} /> : null}
    {mode === "usage" ? <UsageWorkspace data={data} usageResult={usageResult} pricingResult={pricingResult} trend={trend} usage={usage} summary={summary} latest={latest} totalTokens={totalTokens} activeBuckets={activeBuckets} peakEvents={peakEvents} modelCount={modelCount} detailOpen={detailOpen} /> : null}
    {mode === "activity" ? <ActivityWorkspace data={data} usage={usage} summary={summary} latest={latest} detailOpen={detailOpen} /> : null}
  </div>;
}

function CodexHeroCopy({ mode }: Readonly<{ mode: CodexWorkspaceMode }>) {
  const copy = mode === "usage"
    ? { icon: BarChart3, kicker: "Usage analytics", title: "Measured usage, clearly explained.", description: "Daily account history, token composition, model mix, and API-equivalent math in one focused workspace." }
    : mode === "activity"
      ? { icon: ListTree, kicker: "Activity & diagnostics", title: "Operational activity, without the noise.", description: "Sessions, tools, health, and an explicit bounded forensic path—kept separate from everyday analytics." }
      : { icon: Activity, kicker: "Workspace overview", title: "Codex, at a glance.", description: "Current quota, measured telemetry, live operational context, and the latest session in a concise workspace view." };
  const Icon = copy.icon;
  return <div className="command-hero-copy"><div className="command-kicker"><span className="command-kicker-mark"><Icon size={12} /></span><span>{copy.kicker}</span><span className="command-kicker-status"><span className="status-dot" /> bounded snapshot</span></div><h1>{copy.title}</h1><p>{copy.description}</p></div>;
}

interface WorkspaceProps {
  data: CodexData;
  usageResult: DataResult<CodexUsageSnapshot>;
  trend: ReturnType<typeof selectTrend>;
  usage?: CodexUsageSnapshot;
  summary?: CodexSummary;
  latest?: CodexTelemetrySessionSummary;
  totalTokens?: number;
  activeBuckets?: number;
  peakEvents?: number;
  modelCount?: number;
}

function StatRibbon({ data, summary, totalTokens, activeBuckets, peakEvents, modelCount }: Readonly<Pick<WorkspaceProps, "data" | "summary" | "totalTokens" | "activeBuckets" | "peakEvents" | "modelCount">>) {
  return <section className="command-stat-grid command-stat-grid-ribbon">
    <Metric href={`/?range=${data.range}&section=usage`} label="Events observed" value={summary?.events} note={`${data.range.toUpperCase()} window`} />
    <Metric href={`/?range=${data.range}&section=sessions`} label="Sessions" value={summary?.sessions} note="materialized summaries" />
    <Metric href={`/?range=${data.range}&section=usage`} label="Measured tokens" value={totalTokens} note="emitted samples only" />
    <Metric href={`/?range=${data.range}&section=usage`} label="Peak bucket" value={peakEvents} note="events in one bucket" />
    <Metric href={`/?range=${data.range}&section=usage`} label="Active buckets" value={activeBuckets} note="non-zero observations" />
    <Metric href={`/?range=${data.range}&section=usage`} label="Models" value={modelCount} note="bounded distribution" />
  </section>;
}

function OverviewWorkspace(props: Readonly<WorkspaceProps>) {
  const { data, usageResult, trend, summary, latest } = props;
  const telemetry = data.snapshot;
  return <>
    <LocalCodexAccount showActivity={false} />
    <StatRibbon {...props} />
    {usageResult.status === "unavailable" ? <section className="command-unavailable-panel"><EmptyState title="Rollup analytics unavailable" description={usageResult.reason} /></section> : null}
    <section className="command-overview-grid">
      <Panel className="overview-activity-panel" title="Token activity" icon={Activity} note={data.range.toUpperCase()}>
        <div className="overview-panel-intro"><span>Measured tokens by time bucket</span><small>{summary?.events.toLocaleString() ?? "—"} events · open Usage for the full ledger</small></div>
        <TokenTrend compact interactive={false} result={trend} />
      </Panel>
      <Panel className="overview-live-panel" title="Live operations" icon={Activity} note="observed state"><LiveOperations telemetry={telemetry} latest={latest} summary={summary} /></Panel>
      <Panel className="overview-composition-panel" title="Measured composition" icon={Boxes} note="token fields"><TokenComposition result={usageResult} /></Panel>
      <Panel className="overview-model-panel" title="Model mix" icon={Bot} note="top 5"><Distribution result={telemetry.models} /></Panel>
      <Panel className="overview-reasoning-panel" title="Reasoning effort" icon={Boxes} note="top 5"><Distribution result={telemetry.reasoningEfforts} /></Panel>
      <Panel className="overview-session-panel" title="Latest session" icon={Clock3} note={latest ? formatAge(latest.lastSeenAt) : "no session"}><LatestSession latest={latest} /></Panel>
    </section>
  </>;
}

function UsageWorkspace(props: Readonly<WorkspaceProps & { pricingResult: DataResult<CodexEquivalentPricing>; detailOpen: (name: string) => boolean }>) {
  const { data, usageResult, pricingResult, trend, usage, summary, detailOpen } = props;
  const telemetry = data.snapshot;
  return <>
    <LocalCodexAccount />
    <StatRibbon {...props} />
    {usageResult.status === "unavailable" ? <section className="command-unavailable-panel"><EmptyState title="Rollup analytics unavailable" description={usageResult.reason} /></section> : null}
    <section className="command-overview-grid command-usage-grid">
      <Panel className="usage-activity-panel" title="Measured token trend" icon={BarChart3} note={data.range.toUpperCase()}>
        <div className="overview-panel-intro"><span>Exact measured fields by time bucket</span><small>{summary?.events.toLocaleString() ?? "—"} events · hover or focus for values</small></div>
        <TokenTrend result={trend} />
        <div className="activity-map-heading"><span>Activity density</span><small>Each cell is an observed time bucket</small></div>
        <ActivityHeatmap result={trend} />
      </Panel>
      <Panel className="usage-composition-panel" title="Token composition" icon={Boxes} note="exact ratios"><TokenComposition result={usageResult} /></Panel>
      <Panel className="usage-model-panel" title="Model mix" icon={Bot} note="top 5"><Distribution result={telemetry.models} /></Panel>
      <Panel className="usage-reasoning-panel" title="Reasoning effort" icon={Boxes} note="top 5"><Distribution result={telemetry.reasoningEfforts} /></Panel>
    </section>
    <MeasuredLedger result={usageResult} pricing={pricingResult} range={data.range} />
    <div className="command-details">
      <Detail title="Usage & performance" open={detailOpen("usage")}><div className="detail-grid"><Fact label="Cache writes" value={usage ? metricLabel(usage.cacheWriteTokens) : "Unavailable"} /><Fact label="Average duration" value={duration(summary?.averageDurationMs)} /><Fact label="Approvals" value={compactNumber(summary?.approvals)} /><Fact label="Warnings" value={compactNumber(summary?.warnings)} /></div><p className="detail-note">Sessions, tools, forensics, and data health are grouped on the Activity page so this workspace stays focused on usage. <Link className="detail-link" href={`/?range=${data.range}&section=activity`}>Open Activity</Link></p></Detail>
    </div>
  </>;
}

function ActivityWorkspace({ data, usage, summary, latest, detailOpen }: Readonly<Pick<WorkspaceProps, "data" | "usage" | "summary" | "latest"> & { detailOpen: (name: string) => boolean }>) {
  const telemetry = data.snapshot;
  return <>
    <section className="command-stat-grid command-stat-grid-ribbon activity-stat-ribbon">
      <Metric label="Events" value={summary?.events} note={`${data.range.toUpperCase()} window`} />
      <Metric label="Sessions" value={summary?.sessions} note="bounded summaries" />
      <Metric label="Completed tools" value={summary?.completedTools} note="terminal events" />
      <Metric label="Failed tools" value={summary?.failedTools} note="observed failures" />
      <Metric label="Approvals" value={summary?.approvals} note="decision events" />
      <Metric label="Warnings" value={summary?.warnings} note="observed warnings" />
    </section>
    <section className="command-overview-grid command-activity-grid">
      <Panel className="activity-live-panel" title="Live operations" icon={Activity} note="privacy-safe"><LiveOperations telemetry={telemetry} latest={latest} summary={summary} /></Panel>
      <Panel className="activity-session-panel" title="Latest session" icon={Clock3} note={latest ? formatAge(latest.lastSeenAt) : "no session"}><LatestSession latest={latest} /></Panel>
    </section>
    <div className="command-details">
      <SessionsDetail open={detailOpen("sessions")} telemetry={telemetry} />
      <ToolsDetail open={detailOpen("tools")} summary={summary} usage={usage} />
      <Detail title="Forensics" open={detailOpen("forensics") || Boolean(data.forensics)}>{data.forensics ? <Forensics result={data.forensics} /> : <div className="forensics-gate"><ShieldCheck size={18} /><div><b>Raw telemetry is not loaded by default.</b><p>This explicit action runs the bounded 30-day forensic query path and refuses windows above 50,000 raw events. Normal page and overlay reads never use it.</p></div><Link href={`/?range=${data.range}&section=forensics&forensics=1`}>Load forensics</Link></div>}</Detail>
      <DataHealthDetail open={detailOpen("data-health")} telemetry={telemetry} />
    </div>
  </>;
}

function LatestSession({ latest }: Readonly<{ latest?: CodexTelemetrySessionSummary }>) {
  return latest ? <div className="latest-session"><strong>{latest.models[0] ?? "Model unavailable"}</strong><span>{latest.reasoningEfforts[0] ?? "Effort unavailable"}</span><p>{latest.eventCount.toLocaleString()} events · {latest.toolExecutions.toLocaleString()} tools · {latest.errorCount.toLocaleString()} errors</p><small>{formatDate(latest.firstSeenAt)} → {formatDate(latest.lastSeenAt)}</small></div> : <EmptyState compact title="No session summary" description="No materialized session summary is available in this range." />;
}

function SessionsDetail({ open, telemetry }: Readonly<{ open?: boolean; telemetry: CodexData["snapshot"] }>) {
  return <Detail title="Sessions" open={open}>{telemetry.sessions.status === "unavailable" ? <EmptyState compact description={telemetry.sessions.reason} /> : telemetry.sessions.data.length ? <div className="compact-list">{telemetry.sessions.data.slice(0, 20).map((session) => <div key={session.sessionId}><span><b>{session.models[0] ?? "Unknown model"}</b><small>{session.reasoningEfforts[0] ?? "effort unavailable"}</small></span><span>{session.eventCount} events · {session.toolExecutions} tools</span><time>{formatAge(session.lastSeenAt)}</time></div>)}</div> : <EmptyState compact title="No sessions" description="No sessions fall in this materialized range." />}</Detail>;
}

function ToolsDetail({ open, summary, usage }: Readonly<{ open?: boolean; summary?: CodexSummary; usage?: CodexUsageSnapshot }>) {
  return <Detail title="Tools" open={open}><div className="detail-grid"><Fact label="Completed" value={compactNumber(summary?.completedTools)} /><Fact label="Failed" value={compactNumber(summary?.failedTools)} warning={Boolean(summary?.failedTools)} /><Fact label="Tool tokens" value={usage ? metricLabel(usage.toolTokens) : "Unavailable"} /><Fact label="Average duration" value={duration(summary?.averageDurationMs)} /></div></Detail>;
}

function DataHealthDetail({ open, telemetry }: Readonly<{ open?: boolean; telemetry: CodexData["snapshot"] }>) {
  return <Detail title="Data health" open={open}><div className="detail-grid"><Fact label="D1 summary" value={telemetry.health.status} /><Fact label="Storage" value={telemetry.health.configuredResource ?? "Unavailable"} /><Fact label="Raw retention" value={`${telemetry.retentionDays} days`} /><Fact label="Normal read path" value="3 snapshot rows maximum" /><Fact label="Dashboard writes" value="None" /><Fact label="Duplicate retry path" value="Maintenance skipped" /></div><p className="detail-note">Ingest updates grouped hourly, model, reasoning, and session rollups. Materialized 24-hour snapshots refresh at most once per minute; 7- and 30-day snapshots refresh at most every 15 minutes. Raw events are retained for explicit forensics only. Dashboard refreshes and overlay reads never write D1; duplicate-only ingest retries skip cleanup and snapshot maintenance.</p></Detail>;
}

function LiveOperations({ telemetry, latest, summary }: Readonly<{ telemetry: CodexData["snapshot"]; latest?: CodexTelemetrySessionSummary; summary?: CodexSummary }>) {
  const lastObserved = telemetry.lastReceivedAt ?? latest?.lastSeenAt;
  return <div className="live-operations">
    <div className={`live-observed-card ${telemetry.health.status}`}><span className="live-observed-dot" /><div><strong>{latest ? "Session observed" : "No session observed"}</strong><small>{latest ? `${latest.models[0] ?? "Model unavailable"} · ${latest.reasoningEfforts[0] ?? "effort unavailable"}` : "No bounded session summary was emitted."}</small></div><time>{formatAge(lastObserved)}</time></div>
    <dl className="live-facts"><Fact label="Telemetry" value={telemetry.health.status} /><Fact label="Latest events" value={summary?.events.toLocaleString() ?? "Unavailable"} /><Fact label="Approval events" value={compactNumber(summary?.approvals)} /><Fact label="Failed tools" value={compactNumber(summary?.failedTools)} warning={Boolean(summary?.failedTools)} /></dl>
    <div className="live-note"><ShieldCheck size={14} /><span>Privacy-safe live context only. Pending approvals, prompts, commands, and agent graph details are not emitted into this bounded surface.</span></div>
  </div>;
}

function MeasuredLedger({ result, pricing, range }: Readonly<{ result: DataResult<CodexUsageSnapshot>; pricing: DataResult<CodexEquivalentPricing>; range: DashboardRange }>) {
  const fields: Array<{ key: "inputTokens" | "outputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "reasoningTokens" | "toolTokens"; label: string }> = [
    { key: "inputTokens", label: "Input" },
    { key: "outputTokens", label: "Output" },
    { key: "cachedInputTokens", label: "Cached" },
    { key: "cacheWriteTokens", label: "Cache write" },
    { key: "reasoningTokens", label: "Reasoning" },
    { key: "toolTokens", label: "Tool" },
  ];
  return <section className="panel usage-ledger">
    <header><div><span>Measured token ledger</span><small>{range.toUpperCase()} · exact emitted fields</small></div><span className="ledger-badge">Official token rates</span></header>
    <div className="usage-ledger-body">
      <div className="usage-table-wrap"><table><thead><tr><th>Field</th><th>Exact tokens</th><th>Sample state</th></tr></thead><tbody>{fields.map((field) => {
        const metric = result.status === "connected" ? result.data[field.key] : undefined;
        return <tr key={field.key}><th scope="row">{field.label}</th><td>{metric ? metricLabel(metric) : "Unavailable"}</td><td>{metric?.availability === "available" ? `${metric.sampleCount.toLocaleString()} samples` : metric?.availability === "no-samples" ? "No samples" : "Unavailable"}</td></tr>;
      })}</tbody></table></div>
      <ApiEquivalentCard result={pricing} />
    </div>
  </section>;
}

function ApiEquivalentCard({ result }: Readonly<{ result: DataResult<CodexEquivalentPricing> }>) {
  if (result.status === "unavailable") {
    return <aside className="ledger-note pricing-card pricing-unavailable"><span>API-equivalent usage</span><strong>Unavailable</strong><p>{result.reason}</p></aside>;
  }
  const pricing = result.data;
  const statusLabel = pricing.status === "available" ? "Complete coverage" : "Partial coverage";
  return <aside className={`ledger-note pricing-card pricing-${pricing.status}`}>
    <div className="pricing-card-heading"><span>API-equivalent usage</span><b>{statusLabel}</b></div>
    <div className="pricing-primary"><div><small>USD equivalent</small><strong>{pricing.usdEquivalent === undefined ? "Unavailable" : `$${pricing.usdEquivalent}`}</strong></div><div><small>Codex credits</small><strong>{pricing.apiCredits === undefined ? "Unavailable" : pricing.apiCredits}</strong></div></div>
    <div className="pricing-meta"><span>Coverage <b>{pricing.coveragePercent === undefined ? "—" : `${pricing.coveragePercent}%`}</b></span><span>Models <b>{pricing.modelCount}</b></span></div>
    {pricing.byModel.length ? <details className="pricing-breakdown"><summary>Inspect model math <span>+</span></summary><div>{pricing.byModel.map((model) => <div className="pricing-model-row" key={model.model}><span><b>{model.displayName}</b><small>{model.model} · {model.eventCount.toLocaleString()} events</small></span><strong>{model.status === "priced" ? `$${model.usdEquivalent}` : "Unpriced"}</strong></div>)}</div></details> : null}
    <p>{pricing.note} This is a token-rate comparison, not a live account balance or invoice.</p>
  </aside>;
}

export function GitHubCommandPage({ data, section }: Readonly<{ data: GitHubData; section?: string }>) {
  const github = data.snapshot;
  const repository = github.repositories.status === "connected" ? github.repositories.data[0] : undefined;
  const commit = github.commits.status === "connected" ? github.commits.data[0] : undefined;
  const build = github.builds.status === "connected" ? github.builds.data[0] : undefined;
  const open = (name: string) => section === name;
  return <div className="command-page fade-in-up">
    <header className="command-hero"><div><p className="eyebrow">Repository operations</p><h1>GitHub</h1><p>Repository state, work queues, delivery health, and activity from the configured read-only provider.</p></div><RefreshButton /></header>
    <GitHubSectionNav section={section} />
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

function GitHubSectionNav({ section }: Readonly<{ section?: string }>) {
  const items = [
    { label: "Overview", section: undefined },
    { label: "Repository", section: "repository" },
    { label: "Pull requests", section: "pull-requests" },
    { label: "Issues", section: "issues" },
    { label: "Build / CI", section: "build-ci" },
    { label: "Activity", section: "activity" },
  ];
  return <nav aria-label="GitHub sections" className="command-subnav">{items.map((item) => {
    const active = item.section ? section === item.section : !section;
    const href = item.section ? `/github?section=${item.section}` : "/github";
    return <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={href} key={item.label}>{item.label}</Link>;
  })}</nav>;
}

function Forensics({ result }: Readonly<{ result: NonNullable<CodexData["forensics"]> }>) {
  if (result.status === "unavailable") return <EmptyState compact title="Forensics unavailable" description={result.reason} />;
  return <><div className="forensics-loaded"><AlertTriangle size={14} /><span>Explicit raw read completed at {formatDate(result.data.loadedAt)}. It will not repeat unless this URL is loaded again.</span></div>{result.data.activity.length ? <div className="compact-list">{result.data.activity.slice(0, 25).map((event) => <EventRecord event={event} key={event.id} />)}</div> : <EmptyState compact title="No forensic events" description="No retained raw events were returned." />}</>;
}
function EventRecord({ event }: Readonly<{ event: CodexActivityRecord }>) { return <div><span><b>{event.eventName}</b><small>{event.category} · {event.model ?? "model unavailable"}</small></span><span>{event.toolName ?? event.status ?? "No additional safe dimension"}</span><time>{formatAge(event.occurredAt)}</time></div>; }
function RangeLinks({ range, section }: Readonly<{ range: DashboardRange; section?: string }>) { return <div className="command-range">{(["24h", "7d", "30d"] as DashboardRange[]).map((item) => {
  const query = new URLSearchParams({ range: item });
  if (section) query.set("section", section);
  return <Link className={range === item ? "active" : ""} href={`/?${query.toString()}`} key={item}>{item.toUpperCase()}</Link>;
})}</div>; }
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
