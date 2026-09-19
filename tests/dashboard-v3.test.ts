import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bucketTrendPoints } from "../src/components/dashboard/analytics-ui";
import { averageTtft, distributionShares, latestSession, measuredLabel, parseDashboardRange, selectTrend, selectUsage } from "../src/lib/dashboard/analytics";
import { accountActivityBuckets, accountActivitySummary, formatAccountSeconds, formatBackendDate } from "../src/lib/dashboard/account-activity";
import type { DashboardSnapshot } from "../src/lib/dashboard/view-model";
import { defaultOverlaySettings, isSafeHexColor, parseOverlaySettings, resolveOverlayLayout } from "../src/lib/overlay/settings";
import { composeOverlaySnapshot } from "../src/lib/overlay/view-model";
import type { CodexTelemetrySnapshot } from "../src/lib/providers/types";
import { legacySectionRedirects, navigationItems } from "../src/lib/navigation";

const now = "2026-09-12T12:00:00.000Z";
const connected = <T>(data: T) => ({ status: "connected" as const, source: "codex" as const, data, asOf: now });
const codex = {
  usage: connected([
    { window: "24h", inputTokens: { availability: "available", value: 10, sampleCount: 1 }, outputTokens: { availability: "available", value: 0, sampleCount: 1 }, cachedInputTokens: { availability: "no-samples", sampleCount: 0 }, cacheWriteTokens: { availability: "unavailable", sampleCount: 0 }, reasoningTokens: { availability: "available", value: 3, sampleCount: 1 }, toolTokens: { availability: "available", value: 2, sampleCount: 1 }, eventsWithUsage: 1, sessionsWithUsage: 1, modelsWithUsage: 1, capturedAt: now },
    { window: "7d", inputTokens: { availability: "available", value: 70, sampleCount: 7 }, outputTokens: { availability: "available", value: 20, sampleCount: 7 }, cachedInputTokens: { availability: "available", value: 8, sampleCount: 2 }, cacheWriteTokens: { availability: "unavailable", sampleCount: 0 }, reasoningTokens: { availability: "available", value: 9, sampleCount: 3 }, toolTokens: { availability: "available", value: 4, sampleCount: 2 }, eventsWithUsage: 7, sessionsWithUsage: 4, modelsWithUsage: 2, capturedAt: now },
  ]),
  trends: { twentyFourHour: connected([{ label: "12:00", events: 2, errors: 1, toolExecutions: 3, inputTokens: 10 }]), sevenDay: connected([{ label: "Sep 12", events: 9, errors: 2, toolExecutions: 5, inputTokens: 70 }]), thirtyDay: connected([]) },
  sessions: connected([
    { sessionId: "older", models: ["gpt-old"], reasoningEfforts: ["low"], eventCount: 2, errorCount: 0, toolExecutions: 1, toolRelatedEvents: 1, usageEvents: 1, approvalEvents: 0, warningCount: 0, firstSeenAt: "2026-09-10T10:00:00.000Z", lastSeenAt: "2026-09-10T11:00:00.000Z" },
    { sessionId: "latest", models: ["gpt-future"], reasoningEfforts: ["ultra"], eventCount: 8, errorCount: 1, toolExecutions: 3, toolRelatedEvents: 4, usageEvents: 2, approvalEvents: 1, warningCount: 0, inputTokens: 10, outputTokens: 0, cachedTokens: 4, reasoningTokens: 3, toolTokens: 2, averageTtftMs: 250, firstSeenAt: "2026-09-12T11:00:00.000Z", lastSeenAt: now },
  ]),
  ttft: connected([{ label: "gpt-future", sampleCount: 2, averageMs: 250, minimumMs: 200, maximumMs: 300 }]),
  tools: connected([{ label: "exec", relatedEventCount: 4, completedExecutionCount: 3, successCount: 2, failureCount: 1, lastSeenAt: now }]),
  approvals: connected([{ label: "approved", count: 1 }]),
  health: { status: "connected", checkedAt: now, lastSuccessfulFetch: now, authentication: "authenticated", message: "healthy" },
  lastReceivedAt: now,
} as unknown as CodexTelemetrySnapshot;

const dashboard = {
  codex,
  githubHealth: { status: "connected", checkedAt: now, authentication: "authenticated", message: "healthy" },
  builds: { status: "connected", source: "github", data: [{ id: "build", repositoryId: "repo", name: "Verify", status: "success" }] },
} as unknown as DashboardSnapshot;

test("range selection maps only valid dashboard windows", () => {
  assert.equal(parseDashboardRange("7d"), "7d");
  assert.equal(parseDashboardRange("weekly"), "24h");
  const usage = selectUsage(codex, "7d");
  const trend = selectTrend(codex, "24h");
  assert.equal(usage.status === "connected" ? usage.data.sessionsWithUsage : -1, 4);
  assert.equal(trend.status === "connected" ? trend.data[0].toolExecutions : -1, 3);
});

test("trend display grouping preserves exact totals and activity counts", () => {
  const grouped = bucketTrendPoints([
    { label: "00:00", events: 1, errors: 0, toolExecutions: 1, inputTokens: 2 },
    { label: "01:00", events: 2, errors: 1, toolExecutions: 0, inputTokens: 3 },
    { label: "02:00", events: 4, errors: 0, toolExecutions: 2, outputTokens: 5 },
    { label: "03:00", events: 8, errors: 2, toolExecutions: 3, outputTokens: 7 },
  ], 2);
  assert.deepEqual(grouped, [
    { label: "00:00 – 01:00", events: 3, errors: 1, toolExecutions: 1, inputTokens: 5, outputTokens: undefined, cachedTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined, toolTokens: undefined },
    { label: "02:00 – 03:00", events: 12, errors: 2, toolExecutions: 5, inputTokens: undefined, outputTokens: 12, cachedTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined, toolTokens: undefined },
  ]);
});

test("metric semantics preserve zero, unavailable, and no samples", () => {
  assert.equal(measuredLabel({ availability: "available", value: 0, sampleCount: 1 }), "0");
  assert.equal(measuredLabel({ availability: "unavailable", sampleCount: 0 }), "Unavailable");
  assert.equal(measuredLabel({ availability: "no-samples", sampleCount: 0 }), "No samples");
});

test("latest session and weighted TTFT remain model-agnostic", () => {
  assert.equal(latestSession(codex)?.models[0], "gpt-future");
  assert.equal(latestSession(codex)?.reasoningEfforts[0], "ultra");
  assert.equal(averageTtft(codex), 250);
});

test("account activity keeps exact backend buckets and explicit time semantics", () => {
  const activity = {
    dailyUsageBuckets: [
      { startDate: "2026-09-17", tokens: 0 },
      { startDate: "2026-09-18", tokens: 120 },
      { startDate: "2026-09-19", tokens: 80 },
    ],
    currentStreakDays: 2,
  };
  assert.deepEqual(accountActivityBuckets(activity, 7), activity.dailyUsageBuckets);
  assert.deepEqual(accountActivitySummary(activity.dailyUsageBuckets), { totalTokens: 200, activeDays: 2, peak: { startDate: "2026-09-18", tokens: 120 } });
  assert.equal(formatBackendDate("2026-09-19"), "Sep 19");
  assert.equal(formatAccountSeconds(3_661), "1h 1m");
});

test("model and reasoning distributions accept future labels", () => {
  assert.deepEqual(distributionShares([{ label: "gpt-future", count: 3 }, { label: "gpt-next", count: 1 }]), [{ label: "gpt-future", count: 3, share: 75 }, { label: "gpt-next", count: 1, share: 25 }]);
  assert.deepEqual(distributionShares([{ label: "ultra", count: 2 }, { label: "future-tier", count: 2 }]).map((item) => item.share), [50, 50]);
});

test("overlay snapshot exposes only the bounded operational contract", () => {
  const overlay = composeOverlaySnapshot(dashboard, "24h", now);
  assert.equal(overlay.latestSession?.model, "gpt-future");
  assert.equal(overlay.latestSession?.reasoningEffort, "ultra");
  assert.equal(overlay.latestSession?.toolFailures, undefined);
  assert.equal(overlay.windowSummary.outputTokens, 0);
  assert.equal(overlay.windowSummary.completedTools, 3);
  const serialized = JSON.stringify(overlay);
  for (const forbidden of ["prompt", "command", "arguments", "stdout", "stderr", "toolOutput", "reasoningText", "accountId", "email", "hostname", "credential", "secret"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("overlay settings are bounded and invalid colors fall back", () => {
  const parsed = parseOverlaySettings({ backgroundOpacity: 1, fontScale: 999, layout: "giant", accentColor: "red", customTextColor: "#112233" });
  assert.equal(parsed.backgroundOpacity, 20);
  assert.equal(parsed.fontScale, 150);
  assert.equal(parsed.layout, defaultOverlaySettings.layout);
  assert.equal(parsed.accentColor, defaultOverlaySettings.accentColor);
  assert.equal(parsed.customTextColor, "#112233");
  assert.equal(isSafeHexColor("#abcdef"), true);
  assert.equal(isSafeHexColor("rgba(0,0,0,1)"), false);
});

test("responsive overlay helper selects compact, expanded, and strip geometries", () => {
  assert.equal(resolveOverlayLayout(340, 220, "expanded"), "compact");
  assert.equal(resolveOverlayLayout(420, 520, "expanded"), "expanded");
  assert.equal(resolveOverlayLayout(600, 90, "expanded"), "strip");
});

test("future subscription seam contains no fabricated implementation", async () => {
  const source = await readFile(new URL("../src/lib/providers/subscription.ts", import.meta.url), "utf8");
  assert.match(source, /interface SubscriptionUsage/);
  assert.match(source, /Promise<SubscriptionUsage \| undefined>/);
  assert.doesNotMatch(source, /return\s*\{[^}]*fiveHourUsed/s);
});

test("dashboard exposes exactly two top-level destinations and maps legacy routes", () => {
  assert.deepEqual(navigationItems.map((item) => [item.label, item.href]), [["Codex", "/"], ["GitHub", "/github"]]);
  assert.equal(legacySectionRedirects.usage, "/?section=usage");
  assert.equal(legacySectionRedirects["codex-activity"], "/?section=forensics");
  assert.equal(legacySectionRedirects.repositories, "/github?section=repository");
  assert.equal(legacySectionRedirects["pull-requests-issues"], "/github?section=pull-requests");
  assert.equal(legacySectionRedirects["build-ci-health"], "/github?section=build-ci");
});

test("Codex page gates raw forensics and keeps the overview bounded", async () => {
  const [source, analytics] = await Promise.all([
    readFile(new URL("../src/components/dashboard/command-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/dashboard/analytics-ui.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /Load forensics/);
  assert.match(source, /forensics=1/);
  assert.match(source, /<details className="command-detail"/);
  assert.match(source, /Usage & performance/);
  assert.match(source, /Data health/);
  assert.match(source, /LiveOperations/);
  assert.match(source, /MeasuredLedger/);
  assert.match(source, /command-metric-link/);
  assert.match(source, /API-equivalent usage/);
  assert.match(source, /standard rates below/);
  assert.match(source, /Dashboard writes/);
  assert.match(analytics, /ActivityHeatmap/);
  assert.match(analytics, /TokenComposition/);
  assert.match(analytics, /data-tooltip/);
  assert.match(analytics, /chart-point/);
  assert.match(source, /Measured tokens by time bucket/);
  assert.match(analytics, /Measured token activity by time bucket/);
  assert.match(analytics, /exact returned time bucket/);
  assert.doesNotMatch(source, /subscription|plan limit|remaining credits/i);
});

test("workspace navigation reflects query sections and returns to the overview", async () => {
  const source = await readFile(new URL("../src/components/dashboard/topbar.tsx", import.meta.url), "utf8");
  assert.match(source, /useSearchParams/);
  assert.match(source, /overviewActive/);
  assert.match(source, /usageActive/);
  assert.match(source, /activityActive/);
  assert.match(source, /aria-current/);
  assert.match(source, /sectionHref\(\)/);
});
