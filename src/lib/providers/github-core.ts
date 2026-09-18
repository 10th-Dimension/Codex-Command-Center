import type {
  ActivityRecord,
  ActivityTrendPoint,
  BranchRecord,
  BuildRecord,
  CommitRecord,
  DataResult,
  GitHubDataSnapshot,
  GitHubProvider,
  IssueRecord,
  ProviderContext,
  ProviderErrorCode,
  ProviderHealth,
  ProviderRetryMetadata,
  PullRequestRecord,
  RepositoryRecord,
  ResultBounds,
} from "./types";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
export const GITHUB_MAX_CONCURRENCY = 5;

export interface GitHubTarget {
  owner: string;
  repository: string;
}

export interface GitHubConfiguration {
  token: string;
  targets: GitHubTarget[];
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GitHubProviderOptions {
  getConfiguration: () => GitHubConfiguration | undefined;
  getConfiguredResource?: () => string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  cacheTtlMs?: number;
  maxConcurrency?: number;
}

interface GitHubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  visibility?: string | null;
  default_branch: string;
  updated_at: string;
  html_url: string;
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string | null; date?: string | null } | null;
    committer?: { date?: string | null } | null;
  };
  author?: { login?: string | null } | null;
  html_url: string;
}

interface GitHubBranchResponse {
  name: string;
  commit?: { sha?: string | null } | null;
}

interface GitHubPullRequestResponse {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  user?: { login?: string | null } | null;
  updated_at: string;
  html_url: string;
}

interface GitHubIssueResponse {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  user?: { login?: string | null } | null;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
}

interface GitHubWorkflowRunResponse {
  id: number;
  name?: string | null;
  status: string;
  conclusion?: string | null;
  created_at?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
  html_url: string;
}

interface GitHubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRunResponse[];
}

type ApiResult<T> =
  | {
      ok: true;
      data: T;
      fetchedAt: string;
      nextUrl?: string;
      truncated?: boolean;
    }
  | {
      ok: false;
      reason: string;
      errorCode: ProviderErrorCode;
      retry?: ProviderRetryMetadata;
    };

interface TargetResults {
  target: GitHubTarget;
  repository: ApiResult<GitHubRepositoryResponse>;
  commits: ApiResult<GitHubCommitResponse[]>;
  branches: ApiResult<GitHubBranchResponse[]>;
  pullRequests: ApiResult<GitHubPullRequestResponse[]>;
  issues: ApiResult<GitHubIssueResponse[]>;
  builds: ApiResult<GitHubWorkflowRunsResponse>;
}

interface CacheEntry {
  value: GitHubDataSnapshot;
  expiresAt: number;
}

function repositoryPath(target: GitHubTarget, suffix = ""): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}${suffix}`;
}

function configuredResource(configuration: GitHubConfiguration | undefined): string | undefined {
  if (!configuration?.targets.length) return undefined;
  return configuration.targets.map((target) => `${target.owner}/${target.repository}`).join(", ");
}

function cacheKey(configuration: GitHubConfiguration): string {
  const repositories = configuration.targets
    .map((target) => `${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`)
    .sort()
    .join("|");
  return `github:v1:${repositories}`;
}

function nextPageFromLink(linkHeader: string | null): string | undefined {
  const nextLink = linkHeader?.split(",").find((link) => link.includes('rel="next"'));
  return nextLink?.match(/<([^>]+)>/)?.[1];
}

function retryMetadata(headers: Headers, now: Date): ProviderRetryMetadata | undefined {
  const retryAfter = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-reset");
  const metadata: ProviderRetryMetadata = {};

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      metadata.retryAfterSeconds = Math.ceil(seconds);
      metadata.retryAt = new Date(now.getTime() + seconds * 1000).toISOString();
    } else {
      const retryDate = new Date(retryAfter);
      if (!Number.isNaN(retryDate.getTime())) metadata.retryAt = retryDate.toISOString();
    }
  }

  if (!metadata.retryAt && reset) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      metadata.retryAt = new Date(resetSeconds * 1000).toISOString();
      metadata.retryAfterSeconds = Math.max(0, Math.ceil((resetSeconds * 1000 - now.getTime()) / 1000));
    }
  }

  return metadata.retryAt || metadata.retryAfterSeconds !== undefined ? metadata : undefined;
}

export function classifyGitHubFailure(
  status: number,
  headers: Headers,
  responseBody: string,
  now = new Date(),
): { reason: string; errorCode: ProviderErrorCode; retry?: ProviderRetryMetadata } {
  if (status === 401) {
    return { reason: "GitHub authentication failed. Check the read-only token.", errorCode: "authentication" };
  }

  const retry = retryMetadata(headers, now);
  const isPrimaryRateLimit = status === 403 && headers.get("x-ratelimit-remaining") === "0";
  const isSecondaryRateLimit = status === 403 && (Boolean(headers.get("retry-after")) || /secondary rate limit|abuse detection/i.test(responseBody));

  if (status === 429 || isPrimaryRateLimit || isSecondaryRateLimit) {
    return {
      reason: isSecondaryRateLimit
        ? "GitHub temporarily limited request frequency. Retry after the indicated delay."
        : "GitHub API rate limit reached. Retry after the indicated reset time.",
      errorCode: "rate-limited",
      retry,
    };
  }

  if (status === 403) {
    return { reason: "GitHub denied this request. Verify read access for this capability.", errorCode: "permission" };
  }

  if (status === 404) {
    return { reason: "GitHub could not find the configured repository or the token cannot access it.", errorCode: "permission" };
  }

  if (status >= 500) {
    return { reason: "GitHub returned a temporary server error.", errorCode: "api", retry };
  }

  return { reason: "GitHub API request failed.", errorCode: "api", retry };
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    queue.shift()?.();
  };

  return async function runLimited<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

async function requestJson<T>(
  configuration: GitHubConfiguration,
  urlOrPath: string,
  context: ProviderContext,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<ApiResult<T>> {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${GITHUB_API_URL}${urlOrPath}`;

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${configuration.token}`,
        "User-Agent": "Codex-Command-Center",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      signal: context.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, ...classifyGitHubFailure(response.status, response.headers, body, now()) };
    }

    return {
      ok: true,
      data: await response.json() as T,
      fetchedAt: now().toISOString(),
      nextUrl: nextPageFromLink(response.headers.get("link")),
    };
  } catch {
    return { ok: false, reason: "The network request to GitHub failed.", errorCode: "network" };
  }
}

async function requestPaged<T>(
  configuration: GitHubConfiguration,
  target: GitHubTarget,
  path: string,
  context: ProviderContext,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<ApiResult<T[]>> {
  const values: T[] = [];
  let nextUrl: string | undefined = repositoryPath(target, path);
  let fetchedAt: string | undefined;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const result: ApiResult<T[]> = await requestJson<T[]>(configuration, nextUrl, context, fetchImpl, now);
    if (!result.ok) return result;
    values.push(...result.data);
    fetchedAt = result.fetchedAt;
    nextUrl = result.nextUrl;
  }

  return {
    ok: true,
    data: values,
    fetchedAt: fetchedAt ?? now().toISOString(),
    truncated: Boolean(nextUrl),
  };
}

function unavailable<T>(failure: Extract<ApiResult<unknown>, { ok: false }>): DataResult<T> {
  return {
    status: "unavailable",
    source: "github",
    reason: failure.reason,
    errorCode: failure.errorCode,
    meta: failure.retry ? { retry: failure.retry } : undefined,
  };
}

function missingConfiguration<T>(): Extract<DataResult<T>, { status: "unavailable" }> {
  return {
    status: "unavailable",
    source: "github",
    reason: "GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPOSITORY.",
    errorCode: "not-configured",
  };
}

function bounds(description: string, limit: number, truncated: boolean): ResultBounds {
  return { description, limit, truncated };
}

function aggregate<T, U>(
  results: TargetResults[],
  select: (result: TargetResults) => ApiResult<T>,
  map: (data: T, target: GitHubTarget) => U[],
  resultBounds?: (successful: Array<Extract<ApiResult<T>, { ok: true }>>) => ResultBounds,
): DataResult<U[]> {
  const selected = results.map((result) => ({ result: select(result), target: result.target }));
  const successful = selected.filter((item): item is { result: Extract<ApiResult<T>, { ok: true }>; target: GitHubTarget } => item.result.ok);
  const failures = selected.filter((item): item is { result: Extract<ApiResult<T>, { ok: false }>; target: GitHubTarget } => !item.result.ok);

  if (successful.length === 0) return unavailable(failures[0]!.result);

  const asOf = successful.map(({ result }) => result.fetchedAt).sort().at(-1);
  const retry = failures.map(({ result }) => result.retry).find(Boolean);
  return {
    status: "connected",
    source: "github",
    data: successful.flatMap(({ result, target }) => map(result.data, target)),
    asOf,
    meta: {
      cacheState: "upstream",
      partial: failures.length > 0,
      bounds: resultBounds?.(successful.map(({ result }) => result)),
      retry,
    },
  };
}

function visibilityFor(repository: GitHubRepositoryResponse): RepositoryRecord["visibility"] {
  if (repository.visibility === "internal") return "internal";
  return repository.private ? "private" : "public";
}

function mapRepository(repository: GitHubRepositoryResponse): RepositoryRecord {
  return {
    id: String(repository.id),
    name: repository.name,
    fullName: repository.full_name,
    visibility: visibilityFor(repository),
    defaultBranch: repository.default_branch,
    updatedAt: repository.updated_at,
    url: repository.html_url,
  };
}

function mapCommit(commit: GitHubCommitResponse, target: GitHubTarget): CommitRecord {
  return {
    id: commit.sha,
    repositoryId: `${target.owner}/${target.repository}`,
    message: commit.commit.message,
    author: commit.author?.login ?? commit.commit.author?.name ?? "Unknown author",
    committedAt: commit.commit.author?.date ?? commit.commit.committer?.date ?? new Date(0).toISOString(),
    url: commit.html_url,
  };
}

function mapBranch(branch: GitHubBranchResponse, target: GitHubTarget, defaultBranch?: string): BranchRecord {
  return {
    id: `${target.owner}/${target.repository}:${branch.name}`,
    repositoryId: `${target.owner}/${target.repository}`,
    name: branch.name,
    isDefault: branch.name === defaultBranch,
    lastCommitId: branch.commit?.sha ?? undefined,
  };
}

function mapPullRequest(pullRequest: GitHubPullRequestResponse, target: GitHubTarget): PullRequestRecord {
  return {
    id: String(pullRequest.id),
    repositoryId: `${target.owner}/${target.repository}`,
    title: pullRequest.title,
    number: pullRequest.number,
    state: pullRequest.state,
    author: pullRequest.user?.login ?? "Unknown author",
    updatedAt: pullRequest.updated_at,
    url: pullRequest.html_url,
  };
}

function mapIssue(issue: GitHubIssueResponse, target: GitHubTarget): IssueRecord | undefined {
  if (issue.pull_request) return undefined;
  return {
    id: String(issue.id),
    repositoryId: `${target.owner}/${target.repository}`,
    title: issue.title,
    number: issue.number,
    state: issue.state,
    author: issue.user?.login ?? "Unknown author",
    updatedAt: issue.updated_at,
    url: issue.html_url,
  };
}

function buildStatus(run: GitHubWorkflowRunResponse): BuildRecord["status"] {
  if (run.status === "queued") return "queued";
  if (run.status === "in_progress") return "in-progress";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "cancelled" || run.conclusion === "skipped") return "cancelled";
  return "failure";
}

function mapBuild(run: GitHubWorkflowRunResponse, target: GitHubTarget): BuildRecord {
  return {
    id: String(run.id),
    repositoryId: `${target.owner}/${target.repository}`,
    name: run.name ?? "GitHub Actions workflow",
    status: buildStatus(run),
    startedAt: run.run_started_at ?? run.created_at ?? undefined,
    completedAt: run.status === "completed" ? run.updated_at ?? undefined : undefined,
    url: run.html_url,
  };
}

function activityFromResults(
  commits: DataResult<CommitRecord[]>,
  pullRequests: DataResult<PullRequestRecord[]>,
  issues: DataResult<IssueRecord[]>,
  builds: DataResult<BuildRecord[]>,
): DataResult<ActivityRecord[]> {
  const results = [commits, pullRequests, issues, builds];
  const connected = results.filter((result): result is Extract<typeof result, { status: "connected" }> => result.status === "connected");
  if (connected.length === 0) {
    const failure = results.find((result) => result.status === "unavailable")!;
    return { ...failure };
  }

  const records: ActivityRecord[] = [];
  if (commits.status === "connected") {
    records.push(...commits.data.map((commit) => ({
      id: `commit:${commit.id}`,
      repositoryId: commit.repositoryId,
      kind: "commit" as const,
      title: commit.message.split("\n")[0] ?? "Commit",
      summary: `${commit.author} committed to ${commit.repositoryId}`,
      occurredAt: commit.committedAt,
      author: commit.author,
      url: commit.url,
    })));
  }
  if (pullRequests.status === "connected") {
    records.push(...pullRequests.data.map((pullRequest) => ({
      id: `pull-request:${pullRequest.id}`,
      repositoryId: pullRequest.repositoryId,
      kind: "pull-request" as const,
      title: pullRequest.title,
      summary: `Open pull request #${pullRequest.number} by ${pullRequest.author}`,
      occurredAt: pullRequest.updatedAt,
      author: pullRequest.author,
      url: pullRequest.url,
    })));
  }
  if (issues.status === "connected") {
    records.push(...issues.data.map((issue) => ({
      id: `issue:${issue.id}`,
      repositoryId: issue.repositoryId,
      kind: "issue" as const,
      title: issue.title,
      summary: `Open issue #${issue.number} by ${issue.author}`,
      occurredAt: issue.updatedAt,
      author: issue.author,
      url: issue.url,
    })));
  }
  if (builds.status === "connected") {
    records.push(...builds.data.map((build) => ({
      id: `build:${build.id}`,
      repositoryId: build.repositoryId,
      kind: "build" as const,
      title: build.name,
      summary: `${build.status} workflow run`,
      occurredAt: build.completedAt ?? build.startedAt ?? new Date(0).toISOString(),
      url: build.url,
    })));
  }

  records.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const activityLimit = 50;
  const asOf = connected.map((result) => result.asOf).filter((value): value is string => Boolean(value)).sort().at(-1);
  return {
    status: "connected",
    source: "github",
    data: records.slice(0, activityLimit),
    asOf,
    meta: {
      cacheState: "upstream",
      partial: results.some((result) => result.status === "unavailable" || result.meta?.partial),
      bounds: bounds("Latest activity records composed from the bounded GitHub snapshot.", activityLimit, records.length > activityLimit),
    },
  };
}

function trendFromCommits(commits: DataResult<CommitRecord[]>, days: 7 | 30, requestedAt: string): DataResult<ActivityTrendPoint[]> {
  if (commits.status === "unavailable") return commits;
  const end = new Date(requestedAt);
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date),
      value: 0,
    };
  });
  const pointByDate = new Map(points.map((point) => [point.key, point]));
  for (const commit of commits.data) {
    const point = pointByDate.get(commit.committedAt.slice(0, 10));
    if (point) point.value += 1;
  }
  return {
    status: "connected",
    source: "github",
    data: points.map(({ label, value }) => ({ label, value })),
    asOf: commits.asOf,
    meta: {
      ...commits.meta,
      bounds: commits.meta?.bounds?.truncated
        ? bounds(`Derived from a capped ${days}-day commit result and may be incomplete.`, commits.meta.bounds.limit, true)
        : undefined,
    },
  };
}

function healthFromResults(
  configuration: GitHubConfiguration,
  requestedAt: string,
  results: Array<DataResult<unknown[]>>,
): ProviderHealth {
  const repositories = results[0]!;
  const resource = configuredResource(configuration);
  if (repositories.status === "unavailable") {
    return {
      status: "unavailable",
      checkedAt: requestedAt,
      configuredResource: resource,
      authentication: repositories.errorCode === "authentication" ? "unauthorized" : repositories.errorCode === "permission" ? "permission-denied" : "unknown",
      message: repositories.reason,
      errorCode: repositories.errorCode,
      retry: repositories.meta?.retry,
    };
  }

  const failures = results.filter((result) => result.status === "unavailable" || result.meta?.partial);
  const unavailableResults = failures.filter((result): result is Extract<DataResult<unknown[]>, { status: "unavailable" }> => result.status === "unavailable");
  const asOf = results
    .filter((result): result is Extract<DataResult<unknown[]>, { status: "connected" }> => result.status === "connected")
    .map((result) => result.asOf)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  if (failures.length > 0) {
    const first = unavailableResults[0];
    const authentication = unavailableResults.some((result) => result.errorCode === "authentication")
      ? "unauthorized"
      : unavailableResults.some((result) => result.errorCode === "permission")
        ? "permission-denied"
        : "authenticated";
    return {
      status: "degraded",
      checkedAt: requestedAt,
      configuredResource: resource,
      lastSuccessfulFetch: asOf,
      authentication,
      message: `GitHub repository access is connected, but ${failures.length} capability result${failures.length === 1 ? " is" : "s are"} partial or unavailable.${first ? ` ${first.reason}` : ""}`,
      errorCode: first?.errorCode,
      retry: first?.meta?.retry,
    };
  }

  return {
    status: "connected",
    checkedAt: requestedAt,
    configuredResource: resource,
    lastSuccessfulFetch: asOf,
    authentication: "authenticated",
    message: "Read-only GitHub access is healthy.",
  };
}

function missingSnapshot(requestedAt: string, resource?: string): GitHubDataSnapshot {
  const result = missingConfiguration<never>();
  return {
    repositories: result,
    commits: result,
    branches: result,
    pullRequests: result,
    issues: result,
    builds: result,
    activity: result,
    trends: { sevenDay: result, thirtyDay: result },
    health: {
      status: "unavailable",
      checkedAt: requestedAt,
      configuredResource: resource,
      authentication: "not-configured",
      message: result.reason,
      errorCode: "not-configured",
    },
  };
}

function setCacheState<T>(result: DataResult<T>, cacheState: "fresh-cache" | "stale-cache", retry?: ProviderRetryMetadata): DataResult<T> {
  return {
    ...result,
    meta: { ...result.meta, cacheState, retry: retry ?? result.meta?.retry },
  };
}

function snapshotWithCacheState(
  snapshot: GitHubDataSnapshot,
  cacheState: "fresh-cache" | "stale-cache",
  failedRefresh?: ProviderHealth,
): GitHubDataSnapshot {
  const retry = failedRefresh?.retry;
  return {
    repositories: setCacheState(snapshot.repositories, cacheState, retry),
    commits: setCacheState(snapshot.commits, cacheState, retry),
    branches: setCacheState(snapshot.branches, cacheState, retry),
    pullRequests: setCacheState(snapshot.pullRequests, cacheState, retry),
    issues: setCacheState(snapshot.issues, cacheState, retry),
    builds: setCacheState(snapshot.builds, cacheState, retry),
    activity: setCacheState(snapshot.activity, cacheState, retry),
    trends: {
      sevenDay: setCacheState(snapshot.trends.sevenDay, cacheState, retry),
      thirtyDay: setCacheState(snapshot.trends.thirtyDay, cacheState, retry),
    },
    health: failedRefresh
      ? {
          ...snapshot.health,
          status: "degraded",
          checkedAt: failedRefresh.checkedAt,
          message: `Showing safe cached GitHub data because refresh failed. ${failedRefresh.message}`,
          errorCode: failedRefresh.errorCode,
          retry,
        }
      : snapshot.health,
  };
}

async function fetchSnapshot(
  configuration: GitHubConfiguration,
  context: ProviderContext,
  fetchImpl: FetchLike,
  now: () => Date,
  maxConcurrency: number,
): Promise<GitHubDataSnapshot> {
  const runLimited = createLimiter(maxConcurrency);
  const since = new Date(context.requestedAt);
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);

  const targetResults = await Promise.all(configuration.targets.map(async (target): Promise<TargetResults> => {
    const [repository, commits, branches, pullRequests, issues, builds] = await Promise.all([
      runLimited(() => requestJson<GitHubRepositoryResponse>(configuration, repositoryPath(target), context, fetchImpl, now)),
      runLimited(() => requestPaged<GitHubCommitResponse>(configuration, target, `/commits?per_page=${PAGE_SIZE}&since=${encodeURIComponent(since.toISOString())}`, context, fetchImpl, now)),
      runLimited(() => requestPaged<GitHubBranchResponse>(configuration, target, `/branches?per_page=${PAGE_SIZE}`, context, fetchImpl, now)),
      runLimited(() => requestJson<GitHubPullRequestResponse[]>(configuration, repositoryPath(target, `/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`), context, fetchImpl, now)),
      runLimited(() => requestJson<GitHubIssueResponse[]>(configuration, repositoryPath(target, `/issues?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`), context, fetchImpl, now)),
      runLimited(() => requestJson<GitHubWorkflowRunsResponse>(configuration, repositoryPath(target, `/actions/runs?per_page=${PAGE_SIZE}`), context, fetchImpl, now)),
    ]);
    return { target, repository, commits, branches, pullRequests, issues, builds };
  }));

  const repositories = aggregate(targetResults, (result) => result.repository, (data) => [mapRepository(data)]);
  const defaultBranches = new Map(repositories.status === "connected" ? repositories.data.map((repository) => [repository.fullName, repository.defaultBranch]) : []);
  const commits = aggregate(
    targetResults,
    (result) => result.commits,
    (data, target) => data.map((commit) => mapCommit(commit, target)),
    (successful) => bounds("Commits from the latest 30-day window, capped per configured repository.", PAGE_SIZE * MAX_PAGES * successful.length, successful.some((result) => Boolean(result.truncated))),
  );
  const branches = aggregate(
    targetResults,
    (result) => result.branches,
    (data, target) => data.map((branch) => mapBranch(branch, target, defaultBranches.get(`${target.owner}/${target.repository}`))),
    (successful) => bounds("Branches returned by a bounded GitHub query.", PAGE_SIZE * MAX_PAGES * successful.length, successful.some((result) => Boolean(result.truncated))),
  );
  const pullRequests = aggregate(
    targetResults,
    (result) => result.pullRequests,
    (data, target) => data.map((pullRequest) => mapPullRequest(pullRequest, target)),
    (successful) => bounds("Latest open pull requests returned by GitHub.", PAGE_SIZE * successful.length, successful.some((result) => Boolean(result.nextUrl))),
  );
  const issues = aggregate(
    targetResults,
    (result) => result.issues,
    (data, target) => data.flatMap((issue) => {
      const mapped = mapIssue(issue, target);
      return mapped ? [mapped] : [];
    }),
    (successful) => bounds("Latest open issue records returned by GitHub; pull requests are excluded after retrieval.", PAGE_SIZE * successful.length, successful.some((result) => Boolean(result.nextUrl))),
  );
  const builds = aggregate(
    targetResults,
    (result) => result.builds,
    (data, target) => data.workflow_runs.map((run) => mapBuild(run, target)),
    (successful) => bounds(
      "Latest GitHub Actions workflow runs returned by GitHub.",
      PAGE_SIZE * successful.length,
      successful.some((result) => Boolean(result.nextUrl) || result.data.total_count > result.data.workflow_runs.length),
    ),
  );
  const activity = activityFromResults(commits, pullRequests, issues, builds);
  const sevenDay = trendFromCommits(commits, 7, context.requestedAt);
  const thirtyDay = trendFromCommits(commits, 30, context.requestedAt);
  const health = healthFromResults(configuration, now().toISOString(), [repositories, commits, branches, pullRequests, issues, builds]);

  return { repositories, commits, branches, pullRequests, issues, builds, activity, trends: { sevenDay, thirtyDay }, health };
}

function isTemporaryFailure(health: ProviderHealth): boolean {
  return health.errorCode === "rate-limited" || health.errorCode === "network" || health.errorCode === "api";
}

export function createGitHubProvider(options: GitHubProviderOptions): GitHubProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const concurrency = Math.max(1, Math.min(GITHUB_MAX_CONCURRENCY, options.maxConcurrency ?? GITHUB_MAX_CONCURRENCY));
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<GitHubDataSnapshot>>();

  const getSnapshot = async (context: ProviderContext): Promise<GitHubDataSnapshot> => {
    const configuration = options.getConfiguration();
    const resource = options.getConfiguredResource?.() ?? configuredResource(configuration);
    if (!configuration?.token || configuration.targets.length === 0) return missingSnapshot(context.requestedAt, resource);

    const key = cacheKey(configuration);
    const existing = cache.get(key);
    const currentTime = now().getTime();
    if (existing && existing.expiresAt > currentTime) {
      const state = existing.value.repositories.meta?.cacheState === "stale-cache" ? "stale-cache" : "fresh-cache";
      return snapshotWithCacheState(existing.value, state);
    }

    const pending = inFlight.get(key);
    if (pending) return pending;

    const refresh = fetchSnapshot(configuration, context, fetchImpl, now, concurrency).then((snapshot) => {
      if (existing && snapshot.health.status === "unavailable" && isTemporaryFailure(snapshot.health)) {
        const stale = snapshotWithCacheState(existing.value, "stale-cache", snapshot.health);
        cache.set(key, { value: stale, expiresAt: now().getTime() + ttl });
        return stale;
      }
      if (snapshot.health.status !== "unavailable") cache.set(key, { value: snapshot, expiresAt: now().getTime() + ttl });
      return snapshot;
    }).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, refresh);
    return refresh;
  };

  const provider: GitHubProvider = {
    id: "github",
    name: "GitHub",
    description: "Repositories, code activity, work queues, and Actions evidence.",
    capabilities: ["repositories", "commits", "branches", "pull-requests", "issues", "builds", "activity"],
    getSnapshot,
    async getHealth(context) { return (await getSnapshot(context)).health; },
    async listRepositories(context) { return (await getSnapshot(context)).repositories; },
    async listCommits(context) { return (await getSnapshot(context)).commits; },
    async listBranches(context) { return (await getSnapshot(context)).branches; },
    async listPullRequests(context) { return (await getSnapshot(context)).pullRequests; },
    async listIssues(context) { return (await getSnapshot(context)).issues; },
    async listBuilds(context) { return (await getSnapshot(context)).builds; },
    async listActivity(context) { return (await getSnapshot(context)).activity; },
    async listActivityTrend(context, days) {
      const snapshot = await getSnapshot(context);
      return days === 7 ? snapshot.trends.sevenDay : snapshot.trends.thirtyDay;
    },
  };

  return provider;
}
