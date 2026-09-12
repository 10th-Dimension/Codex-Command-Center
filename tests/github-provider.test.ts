import assert from "node:assert/strict";
import test from "node:test";

import { composeDashboardSnapshot } from "../src/lib/dashboard/view-model";
import { createGitHubProvider, GITHUB_MAX_CONCURRENCY } from "../src/lib/providers/github-core";
import type { GitHubConfiguration, GitHubTarget } from "../src/lib/providers/github-core";

const target: GitHubTarget = { owner: "example-owner", repository: "example-repository" };
const configuration: GitHubConfiguration = { token: "test-read-only-token", targets: [target] };
const requestedAt = "2026-09-10T12:00:00.000Z";

const repository = {
  id: 1,
  name: target.repository,
  full_name: `${target.owner}/${target.repository}`,
  private: true,
  visibility: "private",
  default_branch: "main",
  updated_at: requestedAt,
  html_url: "https://github.com/example-owner/example-repository",
};

function jsonResponse(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function successFor(url: string) {
  if (url.includes("/actions/runs")) return jsonResponse({ total_count: 0, workflow_runs: [] });
  if (url.includes("/commits") || url.includes("/branches") || url.includes("/pulls") || url.includes("/issues")) return jsonResponse([]);
  return jsonResponse(repository);
}

function providerWith(fetchImpl: typeof fetch, overrides: Partial<{ now: () => Date; cacheTtlMs: number }> = {}) {
  return createGitHubProvider({
    getConfiguration: () => configuration,
    getConfiguredResource: () => `${target.owner}/${target.repository}`,
    fetchImpl,
    ...overrides,
  });
}

test("missing configuration returns safe unavailable results without fetching", async () => {
  let calls = 0;
  const provider = createGitHubProvider({
    getConfiguration: () => undefined,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(calls, 0);
  assert.equal(snapshot.health.status, "unavailable");
  assert.equal(snapshot.health.errorCode, "not-configured");
  assert.equal(snapshot.repositories.status, "unavailable");
});

test("401 responses are classified as authentication failures", async () => {
  const provider = providerWith(async () => jsonResponse({ message: "Bad credentials" }, 401));
  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(snapshot.health.status, "unavailable");
  assert.equal(snapshot.health.authentication, "unauthorized");
  assert.equal(snapshot.health.errorCode, "authentication");
});

test("403 responses without rate headers are permission failures", async () => {
  const provider = providerWith(async () => jsonResponse({ message: "Resource not accessible" }, 403));
  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(snapshot.health.status, "unavailable");
  assert.equal(snapshot.health.authentication, "permission-denied");
  assert.equal(snapshot.health.errorCode, "permission");
});

test("primary rate limits expose a safe reset time", async () => {
  const reset = Math.floor(new Date(requestedAt).getTime() / 1000) + 90;
  const provider = providerWith(
    async () => jsonResponse({ message: "rate limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }),
    { now: () => new Date(requestedAt) },
  );
  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(snapshot.health.errorCode, "rate-limited");
  assert.equal(snapshot.health.retry?.retryAfterSeconds, 90);
  assert.equal(snapshot.health.retry?.retryAt, new Date(reset * 1000).toISOString());
});

test("secondary rate limits honor Retry-After", async () => {
  const provider = providerWith(
    async () => jsonResponse({ message: "You have exceeded a secondary rate limit" }, 403, { "retry-after": "45" }),
    { now: () => new Date(requestedAt) },
  );
  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(snapshot.health.errorCode, "rate-limited");
  assert.equal(snapshot.health.retry?.retryAfterSeconds, 45);
  assert.equal(snapshot.health.retry?.retryAt, "2026-09-10T12:00:45.000Z");
});

test("empty GitHub collections remain connected empty results", async () => {
  const provider = providerWith(async (input) => successFor(String(input)));
  const snapshot = await provider.getSnapshot({ requestedAt });
  assert.equal(snapshot.health.status, "connected");
  assert.deepEqual(snapshot.commits.status === "connected" ? snapshot.commits.data : null, []);
  assert.deepEqual(snapshot.pullRequests.status === "connected" ? snapshot.pullRequests.data : null, []);
  assert.deepEqual(snapshot.issues.status === "connected" ? snapshot.issues.data : null, []);
  assert.deepEqual(snapshot.builds.status === "connected" ? snapshot.builds.data : null, []);
});

test("partial capability failure degrades the Data Sources health", async () => {
  const provider = providerWith(async (input) => {
    const url = String(input);
    if (url.includes("/actions/runs")) return jsonResponse({ message: "Actions permission required" }, 403);
    return successFor(url);
  });
  const github = await provider.getSnapshot({ requestedAt });
  assert.equal(github.repositories.status, "connected");
  assert.equal(github.builds.status, "unavailable");
  assert.equal(github.health.status, "degraded");

  const unavailable = { status: "unavailable" as const, source: "codex" as const, reason: "Not configured", errorCode: "not-configured" as const };
  const codexHealth = { status: "unavailable" as const, checkedAt: requestedAt, authentication: "not-configured" as const, message: "Not configured", errorCode: "not-configured" as const };
  const dashboard = composeDashboardSnapshot({
    requestedAt,
    github,
    githubDescriptor: provider,
    codex: {
      activity: unavailable,
      trends: { twentyFourHour: unavailable, sevenDay: unavailable, thirtyDay: unavailable },
      usage: unavailable,
      categories: unavailable,
      models: unavailable,
      modelAnalytics: unavailable,
      reasoningEfforts: unavailable,
      reasoningAnalytics: unavailable,
      correlations: unavailable,
      tools: unavailable,
      timings: unavailable,
      ttft: unavailable,
      approvals: unavailable,
      approvalPolicies: unavailable,
      sandboxPolicies: unavailable,
      mcpServers: unavailable,
      mcpTools: unavailable,
      mcpOrigins: unavailable,
      toolNamespaces: unavailable,
      agents: unavailable,
      providers: unavailable,
      originators: unavailable,
      appVersions: unavailable,
      serviceVersions: unavailable,
      startupStatuses: unavailable,
      terminalTypes: unavailable,
      networkDecisions: unavailable,
      networkHosts: unavailable,
      sessions: unavailable,
      projects: unavailable,
      recentErrors: unavailable,
      health: codexHealth,
      retentionDays: 30,
    },
    codexDescriptor: { id: "codex", name: "Codex", description: "Codex", capabilities: ["codex-activity"] },
    projectTelemetry: { ...unavailable, source: "project-telemetry" },
    projectDescriptor: { id: "project-telemetry", name: "Projects", description: "Projects", capabilities: ["project-telemetry"] },
  });
  assert.equal(dashboard.sources.find((source) => source.id === "github")?.status, "degraded");
});

test("one dashboard snapshot deduplicates capability fetches and caps outbound concurrency", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const provider = providerWith(async (input) => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return successFor(String(input));
  });
  const context = { requestedAt };

  await Promise.all([
    provider.getSnapshot(context),
    provider.listRepositories(context),
    provider.listCommits(context),
    provider.listBranches(context),
    provider.listPullRequests(context),
    provider.listIssues(context),
    provider.listBuilds(context),
    provider.listActivity(context),
    provider.listActivityTrend(context, 7),
    provider.listActivityTrend(context, 30),
    provider.getHealth(context),
  ]);

  assert.equal(calls, 6);
  assert.ok(maximumActive <= GITHUB_MAX_CONCURRENCY);
  assert.equal(maximumActive, GITHUB_MAX_CONCURRENCY);
});

test("temporary refresh failure serves stale cached data with retry metadata", async () => {
  let currentTime = new Date(requestedAt);
  let limited = false;
  const provider = providerWith(
    async (input) => limited
      ? jsonResponse({ message: "rate limit" }, 429, { "retry-after": "30" })
      : successFor(String(input)),
    { now: () => currentTime, cacheTtlMs: 60_000 },
  );

  const first = await provider.getSnapshot({ requestedAt });
  assert.equal(first.health.status, "connected");
  currentTime = new Date(currentTime.getTime() + 61_000);
  limited = true;
  const stale = await provider.getSnapshot({ requestedAt: currentTime.toISOString() });
  assert.equal(stale.health.status, "degraded");
  assert.equal(stale.health.errorCode, "rate-limited");
  assert.equal(stale.repositories.status, "connected");
  assert.equal(stale.repositories.meta?.cacheState, "stale-cache");
  const repeated = await provider.getSnapshot({ requestedAt: currentTime.toISOString() });
  assert.equal(repeated.repositories.meta?.cacheState, "stale-cache");
});
