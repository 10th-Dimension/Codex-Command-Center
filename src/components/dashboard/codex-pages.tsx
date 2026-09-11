import { Activity, AlertTriangle, Bot, Braces, Clock3, Database, Gauge, Hammer, Layers3, ShieldCheck, Timer, Waypoints } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import type { DashboardSnapshot } from "@/lib/dashboard/queries";
import type { CodexActivityRecord, CodexTelemetryBreakdown, CodexTelemetryToolSummary, CodexTelemetryTrendPoint, DataResult } from "@/lib/providers/types";

export function CodexActivityPage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const telemetry = snapshot.codex;
  if (telemetry.activity.status === "unavailable") {
    return <Page title="Codex Activity" eyebrow="Agents / Codex Activity" description="Operational Codex telemetry from the private relay and D1 provider."><SourceBanner snapshot={snapshot} /><EmptyState description={telemetry.activity.reason} /></Page>;
  }

  const sevenDayEvents = total(telemetry.trends.sevenDay, "events");
  const thirtyDayEvents = total(telemetry.trends.thirtyDay, "events");
  const errors = total(telemetry.trends.thirtyDay, "errors");
  const tools = total(telemetry.trends.thirtyDay, "toolExecutions");
  const requests = telemetry.categories.status === "connected" ? telemetry.categories.data.find((item) => item.label === "api-request")?.count ?? 0 : undefined;
  const unknown = telemetry.activity.data.filter((event) => event.category === "unknown");
  const approvals = breakdownTotal(telemetry.approvals);
  const mcpCalls = telemetry.categories.status === "connected" ? telemetry.categories.data.find((item) => item.label === "mcp")?.count ?? 0 : undefined;
  const networkAllows = decisionCount(telemetry.networkDecisions, ["allow", "allowed"]);
  const networkDenies = decisionCount(telemetry.networkDecisions, ["deny", "denied", "blocked"]);

  return (
    <Page title="Codex Activity" eyebrow="Agents / Codex Activity" description="Privacy-filtered operational telemetry received from Codex. Counts reflect collected events, not account usage, billing, credits, or cost.">
      <SourceBanner snapshot={snapshot} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Stat label="Events today" value={telemetry.todayEventCount} />
        <Stat label="Sessions observed · 24 hours" value={telemetry.observedSessionCount24h} />
        <Stat label="Events · 7 days" value={sevenDayEvents} />
        <Stat label="Events · 30 days" value={thirtyDayEvents} />
        <Stat label="Tool executions · 30 days" value={tools} />
        <Stat label="Failed tool executions · 30 days" value={telemetry.failedToolCount30d} tone={telemetry.failedToolCount30d ? "warning" : "normal"} />
        <Stat label="API request events · 30 days" value={requests} />
        <Stat label="Approval decisions · 30 days" value={approvals} />
        <Stat label="MCP events · 30 days" value={mcpCalls} />
        <Stat label="Network allows · 30 days" value={networkAllows} />
        <Stat label="Network denies · 30 days" value={networkDenies} tone={networkDenies ? "warning" : "normal"} />
        <Stat label="Errors · 30 days" value={errors} tone={errors && errors > 0 ? "warning" : "normal"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel title="Recent event timeline" icon={Activity}>
          {telemetry.activity.data.length === 0 ? <EmptyState compact title="No telemetry received" description="The provider is connected, but D1 contains no Codex telemetry events." /> : <div className="space-y-2">{telemetry.activity.data.map((event) => <EventRow event={event} key={event.id} />)}</div>}
        </Panel>
        <div className="space-y-4">
          <TrendPanel title="24-hour event trend" result={telemetry.trends.twentyFourHour} />
          <TrendPanel title="7-day event trend" result={telemetry.trends.sevenDay} />
          <TrendPanel title="30-day event trend" result={telemetry.trends.thirtyDay} />
          <BreakdownPanel title="Event categories" icon={Layers3} result={telemetry.categories} />
          <BreakdownPanel title="Models observed" icon={Bot} result={telemetry.models} />
          <ToolPanel result={telemetry.tools} />
          <TimingPanel snapshot={snapshot} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BreakdownPanel title="Approval decisions" icon={ShieldCheck} result={telemetry.approvals} />
        <BreakdownPanel title="MCP servers" icon={Layers3} result={telemetry.mcpServers} />
        <BreakdownPanel title="MCP tools" icon={Hammer} result={telemetry.mcpTools} />
        <BreakdownPanel title="Network decisions" icon={ShieldCheck} result={telemetry.networkDecisions} />
        <BreakdownPanel title="Network hosts" icon={Waypoints} result={telemetry.networkHosts} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Sessions" icon={Waypoints}>
          {telemetry.sessions.status === "unavailable" ? <EmptyState compact description={telemetry.sessions.reason} /> : telemetry.sessions.data.length === 0 ? <EmptyState compact title="No session identifiers observed" description="Session grouping appears only when the exporter supplies a conversation or session identifier." /> : <div className="space-y-2">{telemetry.sessions.data.map((session) => <div className="panel-subtle p-3.5" key={session.sessionId}><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-medium text-slate-300">{session.sessionId}</p><span className="text-[10px] text-slate-600">{session.eventCount.toLocaleString()} events</span></div><p className="mt-1 text-[10px] text-slate-600">{session.model ?? "Model unavailable"} · {session.toolExecutions.toLocaleString()} tools · {session.errorCount.toLocaleString()} errors · last seen {formatDate(session.lastSeenAt)}</p></div>)}</div>}
        </Panel>
        <Panel title="Projects" icon={Database}>
          {telemetry.projects.status === "unavailable" ? <EmptyState compact description={telemetry.projects.reason} /> : telemetry.projects.data.length === 0 ? <EmptyState compact title="No project identifiers observed" description="Project grouping remains unavailable until telemetry includes an explicit project identifier." /> : <div className="space-y-2">{telemetry.projects.data.map((project) => <div className="panel-subtle p-3.5" key={project.projectId}><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-medium text-slate-300">{project.projectName ?? project.projectId}</p><span className="text-[10px] text-slate-600">{project.eventCount.toLocaleString()} events</span></div><p className="mt-1 text-[10px] text-slate-600">{project.sessionCount.toLocaleString()} sessions · last seen {formatDate(project.lastSeenAt)}</p></div>)}</div>}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Recent errors and warnings" icon={AlertTriangle}>
          {telemetry.recentErrors.status === "unavailable" ? <EmptyState compact description={telemetry.recentErrors.reason} /> : telemetry.recentErrors.data.length === 0 ? <EmptyState compact title="No errors or warnings observed" description="No error- or warning-classified telemetry appears in the current 30-day window." /> : <div className="space-y-2">{telemetry.recentErrors.data.map((event) => <EventRow event={event} key={event.id} />)}</div>}
        </Panel>
        <Panel title="Unknown-event inspector" icon={Braces}>
          {unknown.length === 0 ? <EmptyState compact title="No unknown recent events" description="Every recent event matched a known operational category." /> : <div className="space-y-2">{groupUnknownEvents(unknown).map((group) => <details className="panel-subtle p-3.5" key={group.eventName}><summary className="cursor-pointer text-xs font-medium text-slate-300">{group.eventName} · {group.count.toLocaleString()} events</summary><p className="mt-2 text-[10px] leading-5 text-slate-600">{group.keys.length.toLocaleString()} sanitized unknown attribute keys. Values are intentionally not stored or shown.</p>{group.keys.length ? <div className="mt-2 flex flex-wrap gap-1.5">{group.keys.map((key) => <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-slate-500" key={key}>{key}</span>)}</div> : null}</details>)}</div>}
        </Panel>
      </div>
    </Page>
  );
}

export function UsagePage({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const telemetry = snapshot.codex;
  const usage = telemetry.usage;
  return (
    <Page title="Usage" eyebrow="Capacity / Usage" description="Token fields legitimately emitted by Codex telemetry. This is not an account billing, credit, quota, or cost view.">
      <SourceBanner snapshot={snapshot} />
      {usage.status === "unavailable" ? <EmptyState description={usage.reason} /> : usage.data.every((window) => window.eventsWithUsage === 0) ? <EmptyState title="Usage fields not available" description="Telemetry is connected, but no token-usage fields have been received. Billing, credits, limits, and cost remain unavailable." /> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {usage.data.map((window) => <Panel title={`${window.window === "7d" ? "7-day" : "30-day"} emitted token fields`} icon={Gauge} key={window.window}><div className="grid gap-3 sm:grid-cols-2"><Stat label="Input tokens" value={window.inputTokens} /><Stat label="Output tokens" value={window.outputTokens} /><Stat label="Cached input tokens" value={window.cachedInputTokens} /><Stat label="Reasoning output tokens" value={window.reasoningOutputTokens} /></div><p className="mt-4 text-[11px] leading-5 text-slate-600">Derived from {window.eventsWithUsage.toLocaleString()} telemetry events containing legitimate usage fields. Values are not converted to price or account limits.</p></Panel>)}
        </div>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TrendPanel title="Operational activity · 30 days" result={telemetry.trends.thirtyDay} />
        <BreakdownPanel title="Model activity breakdown" icon={Bot} result={telemetry.models} />
      </div>
      <div className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.04] p-4 text-xs leading-5 text-amber-100/65">Account billing totals, credit balances, plan limits, rate-limit allocations, and dollar cost are unavailable from this telemetry pipeline and are intentionally not inferred.</div>
    </Page>
  );
}

function SourceBanner({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const telemetry = snapshot.codex;
  return <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3"><StatusPill status={telemetry.health.status} /><span className="text-xs text-slate-500">D1 retention: {telemetry.retentionDays} days</span><span className="text-xs text-slate-600">Last received: {telemetry.lastReceivedAt ? formatDate(telemetry.lastReceivedAt) : "No events received"}</span><span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-600"><ShieldCheck size={13} /> Values privacy-filtered server-side</span></div>;
}

function Page({ title, eyebrow, description, children }: Readonly<{ title: string; eyebrow: string; description: string; children: React.ReactNode }>) {
  return <div className="fade-in-up mx-auto max-w-[1280px]"><section className="mb-8"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">{eyebrow}</p><h1 className="page-title text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] text-slate-100">{title}</h1><p className="mt-4 max-w-3xl text-[15px] leading-7 text-slate-400">{description}</p></section>{children}</div>;
}

function Panel({ title, icon: Icon, children }: Readonly<{ title: string; icon: typeof Activity; children: React.ReactNode }>) {
  return <section className="panel p-5 sm:p-6"><div className="mb-5 flex items-center gap-2.5"><Icon size={15} className="text-slate-500" /><h2 className="text-sm font-semibold text-slate-300">{title}</h2></div>{children}</section>;
}

function Stat({ label, value, tone = "normal" }: Readonly<{ label: string; value?: number; tone?: "normal" | "warning" }>) {
  return <div className="panel p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</p><p className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-amber-100/90" : "text-slate-100"}`}>{value === undefined ? "Unavailable" : value.toLocaleString()}</p></div>;
}

function EventRow({ event }: Readonly<{ event: CodexActivityRecord }>) {
  const detail = [event.model, event.toolName, event.mcpServer, event.mcpTool, event.approvalDecision, event.networkHost, event.networkDecision, event.toolStatus, event.status, event.errorType, event.durationMs === undefined ? undefined : `${event.durationMs} ms`].filter(Boolean).join(" · ");
  return <div className="panel-subtle flex items-start gap-3 p-3.5"><div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035]"><Clock3 size={13} className="text-slate-500" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/60">{event.category}</span><span className="text-[10px] text-slate-600">{formatDate(event.occurredAt)}</span></div><p className="mt-1 truncate text-xs font-medium text-slate-300">{event.eventName}</p><p className="mt-1 truncate text-[10px] text-slate-600">{detail || event.sessionId || "No additional operational fields emitted"}</p></div></div>;
}

function TrendPanel({ title, result }: Readonly<{ title: string; result: DataResult<CodexTelemetryTrendPoint[]> }>) {
  if (result.status === "unavailable") return <Panel title={title} icon={Activity}><EmptyState compact description={result.reason} /></Panel>;
  if (result.data.length === 0) return <Panel title={title} icon={Activity}><EmptyState compact title="No events in this window" description="The connected provider returned no trend points." /></Panel>;
  const max = Math.max(1, ...result.data.map((point) => point.events));
  return <Panel title={title} icon={Activity}><div className="flex h-24 items-end gap-1 rounded-lg border border-white/[0.06] bg-black/10 px-2 pb-2 pt-3">{result.data.map((point) => <div className="flex h-full min-w-0 flex-1 items-end" key={point.label} title={`${point.label}: ${point.events} events`}><div className="w-full rounded-sm bg-cyan-200/65" style={{ height: `${point.events === 0 ? 3 : Math.max(10, Math.round(point.events / max * 100))}%` }} /></div>)}</div><p className="mt-3 text-[10px] text-slate-600">{result.data.reduce((sum, point) => sum + point.events, 0).toLocaleString()} operational events in this window.</p></Panel>;
}

function BreakdownPanel({ title, icon, result }: Readonly<{ title: string; icon: typeof Activity; result: DataResult<CodexTelemetryBreakdown[]> }>) {
  if (result.status === "unavailable") return <Panel title={title} icon={icon}><EmptyState compact description={result.reason} /></Panel>;
  if (result.data.length === 0) return <Panel title={title} icon={icon}><EmptyState compact title="No breakdown available" description="No matching fields were emitted in this window." /></Panel>;
  return <Panel title={title} icon={icon}><div className="space-y-2">{result.data.map((item) => <div className="flex items-center justify-between gap-3 text-xs" key={item.label}><span className="truncate text-slate-400">{item.label}</span><span className="text-slate-600">{item.count.toLocaleString()}</span></div>)}</div></Panel>;
}

function ToolPanel({ result }: Readonly<{ result: DataResult<CodexTelemetryToolSummary[]> }>) {
  if (result.status === "unavailable") return <Panel title="Tools observed" icon={Hammer}><EmptyState compact description={result.reason} /></Panel>;
  if (result.data.length === 0) return <Panel title="Tools observed" icon={Hammer}><EmptyState compact title="No tool fields observed" description="Tool breakdowns appear only when telemetry supplies a tool name." /></Panel>;
  return <Panel title="Tools observed" icon={Hammer}><div className="space-y-2">{result.data.map((tool) => <div className="panel-subtle p-3" key={tool.label}><div className="flex items-center justify-between gap-3"><span className="truncate text-xs text-slate-400">{tool.label}</span><span className="text-[10px] text-slate-600">{tool.count.toLocaleString()} calls</span></div><p className="mt-1 text-[10px] text-slate-600">{tool.failureCount.toLocaleString()} failures · {tool.averageDurationMs === undefined ? "duration unavailable" : `${tool.averageDurationMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms average`} · last seen {formatDate(tool.lastSeenAt)}</p></div>)}</div></Panel>;
}

function TimingPanel({ snapshot }: Readonly<{ snapshot: DashboardSnapshot }>) {
  const result = snapshot.codex.timings;
  if (result.status === "unavailable") return <Panel title="Duration by event category" icon={Timer}><EmptyState compact description={result.reason} /></Panel>;
  if (result.data.length === 0) return <Panel title="Duration by event category" icon={Timer}><EmptyState compact title="No duration fields observed" description="Timing remains unavailable until telemetry emits a legitimate duration field." /></Panel>;
  return <Panel title="Duration by event category" icon={Timer}><div className="space-y-2">{result.data.map((item) => <div className="panel-subtle p-3" key={item.label}><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-400">{item.label}</span><span className="text-[10px] text-slate-600">{item.sampleCount.toLocaleString()} samples</span></div><p className="mt-1 text-[10px] text-slate-600">Average {item.averageMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms · maximum {item.maximumMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms</p></div>)}</div></Panel>;
}

function total(result: DataResult<CodexTelemetryTrendPoint[]>, key: "events" | "errors" | "toolExecutions") {
  return result.status === "connected" ? result.data.reduce((sum, point) => sum + point[key], 0) : undefined;
}

function breakdownTotal(result: DataResult<CodexTelemetryBreakdown[]>) {
  return result.status === "connected" ? result.data.reduce((sum, item) => sum + item.count, 0) : undefined;
}

function decisionCount(result: DataResult<CodexTelemetryBreakdown[]>, labels: string[]) {
  return result.status === "connected" ? result.data.filter((item) => labels.includes(item.label.toLowerCase())).reduce((sum, item) => sum + item.count, 0) : undefined;
}

function groupUnknownEvents(events: CodexActivityRecord[]) {
  const groups = new Map<string, { eventName: string; count: number; keys: Set<string> }>();
  for (const event of events) {
    const group = groups.get(event.eventName) ?? { eventName: event.eventName, count: 0, keys: new Set<string>() };
    group.count += 1;
    for (const key of event.unknownAttributeKeys) group.keys.add(key);
    groups.set(event.eventName, group);
  }
  return [...groups.values()].map((group) => ({ ...group, keys: [...group.keys].sort() }));
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
