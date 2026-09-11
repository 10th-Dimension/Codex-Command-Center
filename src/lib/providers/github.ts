import "server-only";

import type {
  ActivityRecord,
  ActivityTrendPoint,
  BranchRecord,
  BuildRecord,
  CommitRecord,
  DataResult,
  GitHubProvider,
  IssueRecord,
  PullRequestRecord,
  ProviderContext,
  ProviderHealth,
  ProviderErrorCode,
  RepositoryRecord,
} from "./types";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface GitHubTarget {
  owner: string;
  repository: string;
}

interface GitHubConfiguration {
  token: string;
  targets: GitHubTarget[];
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
  protected: boolean;
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
  status: "queued" | "in_progress" | "completed" | string;
  conclusion?: string | null;
  created_at?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
  html_url: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRunResponse[];
}

type ApiResult<T> =
  | {
      ok: true;
      data: T;
      fetchedAt: string;
      nextUrl?: string;
    }
  | {
      ok: false;
      reason: string;
      errorCode: ProviderErrorCode;
    };

function configuredResource(): string | undefined {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  return owner && repository ? `${owner}/${repository}` : undefined;
}

function getConfiguration(): GitHubConfiguration | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();

  if (!token || !owner || !repository) {
    return undefined;
  }

  return {
    token,
    targets: [{ owner, repository }],
  };
}

function repositoryPath(target: GitHubTarget, suffix = ""): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}${suffix}`;
}

function nextPageFromLink(linkHeader: string | null): string | undefined {
  const nextLink = linkHeader?.split(",").find((link) => link.includes('rel="next"'));
  return nextLink?.match(/<([^>]+)>/)?.[1];
}

function classifyFailure(status: number, rateLimitRemaining: string | null): { reason: string; errorCode: ProviderErrorCode } {
  if (status === 401) {
    return { reason: "GitHub authentication failed. Check the read-only token.", errorCode: "authentication" };
  }

  if (status === 429 || (status === 403 && rateLimitRemaining === "0")) {
    return { reason: "GitHub API rate limit reached. Try again later.", errorCode: "rate-limited" };
  }

  if (status === 403) {
    return { reason: "GitHub denied this request. Verify read access to the configured repository.", errorCode: "permission" };
  }

  if (status === 404) {
    return { reason: "GitHub could not find the configured repository or the token cannot access it.", errorCode: "permission" };
  }

  if (status >= 500) {
    return { reason: "GitHub returned a temporary server error.", errorCode: "api" };
  }

  return { reason: "GitHub API request failed.", errorCode: "api" };
}

async function requestJson<T>(
  configuration: GitHubConfiguration,
  urlOrPath: string,
  context: ProviderContext,
): Promise<ApiResult<T>> {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${GITHUB_API_URL}${urlOrPath}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${configuration.token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      next: {
        revalidate: 60,
        tags: [`github:${configuration.targets[0]?.owner}/${configuration.targets[0]?.repository}`],
      },
      signal: context.signal,
    });

    if (!response.ok) {
      return { ok: false, ...classifyFailure(response.status, response.headers.get("x-ratelimit-remaining")) };
    }

    const data = await response.json() as T;
    return {
      ok: true,
      data,
      fetchedAt: new Date().toISOString(),
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
): Promise<ApiResult<T[]>> {
  const values: T[] = [];
  let nextUrl: string | undefined = repositoryPath(target, path);
  let fetchedAt: string | undefined;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const result: ApiResult<T[]> = await requestJson<T[]>(configuration, nextUrl, context);

    if (!result.ok) {
      return result;
    }

    values.push(...result.data);
    fetchedAt = result.fetchedAt;
    nextUrl = result.nextUrl;
  }

  return { ok: true, data: values, fetchedAt: fetchedAt ?? new Date().toISOString() };
}

function unavailable(reason: string, errorCode: ProviderErrorCode = "api"): DataResult<never> {
  return { status: "unavailable", source: "github", reason, errorCode };
}

async function collectTargets<T, U>(
  configuration: GitHubConfiguration | undefined,
  context: ProviderContext,
  request: (configuration: GitHubConfiguration, target: GitHubTarget) => Promise<ApiResult<T>>,
  map: (data: T, target: GitHubTarget) => U[],
): Promise<DataResult<U[]>> {
  if (!configuration) {
    return unavailable("GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPOSITORY.", "not-configured");
  }

  const results = await Promise.all(configuration.targets.map(async (target) => {
    const result = await request(configuration, target);
    return { result, target };
  }));
  const failures = results.filter(({ result }) => !result.ok).map(({ result }) => result as Extract<ApiResult<T>, { ok: false }>);
  const successful = results.filter(({ result }) => result.ok) as Array<{ result: Extract<ApiResult<T>, { ok: true }>; target: GitHubTarget }>;

  if (successful.length === 0) {
    const failure = failures[0];
    return unavailable(failure?.reason ?? "GitHub API request failed.", failure?.errorCode ?? "api");
  }

  const mapped = successful.flatMap(({ result, target }) => map(result.data, target));
  const asOf = successful.map(({ result }) => result.fetchedAt).sort().at(-1);

  return { status: "connected", source: "github", data: mapped, asOf };
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

function mapActivityResult<T>(result: DataResult<T[]>, map: (data: T[]) => ActivityRecord[]): DataResult<ActivityRecord[]> {
  if (result.status === "unavailable") return result;
  return { ...result, data: map(result.data) };
}

function collectActivity(results: Array<DataResult<ActivityRecord[]>>): DataResult<ActivityRecord[]> {
  const connected = results.filter((result): result is Extract<DataResult<ActivityRecord[]>, { status: "connected" }> => result.status === "connected");
  if (connected.length === 0) {
    const firstFailure = results.find((result) => result.status === "unavailable");
    return unavailable(firstFailure?.reason ?? "GitHub activity is unavailable.", firstFailure?.errorCode ?? "api");
  }

  const data = connected.flatMap((result) => result.data).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 50);
  const asOf = connected.map((result) => result.asOf).filter((value): value is string => Boolean(value)).sort().at(-1);
  return { status: "connected", source: "github", data, asOf };
}

function activityFromCommits(commits: CommitRecord[]): ActivityRecord[] {
  return commits.map((commit) => ({
    id: `commit:${commit.id}`,
    repositoryId: commit.repositoryId,
    kind: "commit" as const,
    title: commit.message.split("\n")[0] ?? "Commit",
    summary: `${commit.author} committed to ${commit.repositoryId}`,
    occurredAt: commit.committedAt,
    author: commit.author,
    url: commit.url,
  }));
}

function activityFromPullRequests(pullRequests: PullRequestRecord[]): ActivityRecord[] {
  return pullRequests.map((pullRequest) => ({
    id: `pull-request:${pullRequest.id}`,
    repositoryId: pullRequest.repositoryId,
    kind: "pull-request" as const,
    title: pullRequest.title,
    summary: `Open pull request #${pullRequest.number} by ${pullRequest.author}`,
    occurredAt: pullRequest.updatedAt,
    author: pullRequest.author,
    url: pullRequest.url,
  }));
}

function activityFromIssues(issues: IssueRecord[]): ActivityRecord[] {
  return issues.map((issue) => ({
    id: `issue:${issue.id}`,
    repositoryId: issue.repositoryId,
    kind: "issue" as const,
    title: issue.title,
    summary: `Open issue #${issue.number} by ${issue.author}`,
    occurredAt: issue.updatedAt,
    author: issue.author,
    url: issue.url,
  }));
}

function activityFromBuilds(builds: BuildRecord[]): ActivityRecord[] {
  return builds.map((build) => ({
    id: `build:${build.id}`,
    repositoryId: build.repositoryId,
    kind: "build" as const,
    title: build.name,
    summary: `${build.status} workflow run`,
    occurredAt: build.completedAt ?? build.startedAt ?? new Date(0).toISOString(),
    url: build.url,
  }));
}

function trendFromCommits(commits: CommitRecord[], days: 7 | 30, requestedAt: string): ActivityTrendPoint[] {
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

  for (const commit of commits) {
    const point = pointByDate.get(commit.committedAt.slice(0, 10));
    if (point) point.value += 1;
  }

  return points.map(({ label, value }) => ({ label, value }));
}

const githubProvider: GitHubProvider = {
  id: "github",
  name: "GitHub",
  description: "Repositories, code activity, work queues, and Actions evidence.",
  capabilities: ["repositories", "commits", "branches", "pull-requests", "issues", "builds", "activity"],

  async listRepositories(context) {
    return collectTargets<GitHubRepositoryResponse, RepositoryRecord>(getConfiguration(), context, (configuration, target) => requestJson(configuration, repositoryPath(target), context), (data) => [mapRepository(data)]);
  },

  async listCommits(context) {
    return collectTargets<GitHubCommitResponse[], CommitRecord>(getConfiguration(), context, (configuration, target) => requestPaged<GitHubCommitResponse>(configuration, target, `/commits?per_page=${PAGE_SIZE}&sort=committer-date&direction=desc`, context), (data, target) => data.map((commit) => mapCommit(commit, target)));
  },

  async listBranches(context) {
    const repositories = await githubProvider.listRepositories(context);
    const defaultBranches = new Map(repositories.status === "connected" ? repositories.data.map((repository) => [repository.fullName, repository.defaultBranch]) : []);
    return collectTargets<GitHubBranchResponse[], BranchRecord>(getConfiguration(), context, (configuration, target) => requestPaged<GitHubBranchResponse>(configuration, target, `/branches?per_page=${PAGE_SIZE}`, context), (data, target) => data.map((branch) => mapBranch(branch, target, defaultBranches.get(`${target.owner}/${target.repository}`))));
  },

  async listPullRequests(context) {
    return collectTargets<GitHubPullRequestResponse[], PullRequestRecord>(getConfiguration(), context, (configuration, target) => requestJson(configuration, repositoryPath(target, `/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`), context), (data, target) => data.map((pullRequest) => mapPullRequest(pullRequest, target)));
  },

  async listIssues(context) {
    return collectTargets<GitHubIssueResponse[], IssueRecord>(getConfiguration(), context, (configuration, target) => requestJson(configuration, repositoryPath(target, `/issues?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`), context), (data, target) => data.flatMap((issue) => { const mapped = mapIssue(issue, target); return mapped ? [mapped] : []; }));
  },

  async listBuilds(context) {
    return collectTargets<GitHubWorkflowRunsResponse, BuildRecord>(getConfiguration(), context, (configuration, target) => requestJson(configuration, repositoryPath(target, `/actions/runs?per_page=${PAGE_SIZE}`), context), (data, target) => data.workflow_runs.map((run) => mapBuild(run, target)));
  },

  async listActivity(context) {
    const [commits, pullRequests, issues, builds] = await Promise.all([
      githubProvider.listCommits(context),
      githubProvider.listPullRequests(context),
      githubProvider.listIssues(context),
      githubProvider.listBuilds(context),
    ]);
    return collectActivity([
      mapActivityResult(commits, activityFromCommits),
      mapActivityResult(pullRequests, activityFromPullRequests),
      mapActivityResult(issues, activityFromIssues),
      mapActivityResult(builds, activityFromBuilds),
    ]);
  },

  async listActivityTrend(context, days) {
    const configuration = getConfiguration();
    if (!configuration) {
      return unavailable("GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPOSITORY.", "not-configured");
    }

    const since = new Date(context.requestedAt);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);
    const commits = await Promise.all(configuration.targets.map((target) => requestPaged<GitHubCommitResponse>(configuration, target, `/commits?per_page=${PAGE_SIZE}&since=${encodeURIComponent(since.toISOString())}`, context)));
    const failures = commits.filter((result): result is Extract<ApiResult<GitHubCommitResponse[]>, { ok: false }> => !result.ok);
    const successful = commits.filter((result): result is Extract<ApiResult<GitHubCommitResponse[]>, { ok: true }> => result.ok);

    if (successful.length === 0) {
      const failure = failures[0];
      return unavailable(failure?.reason ?? "GitHub activity trend is unavailable.", failure?.errorCode ?? "api");
    }

    const records = successful.flatMap((result, index) => result.data.map((commit) => mapCommit(commit, configuration.targets[index]!)));
    const asOf = successful.map((result) => result.fetchedAt).sort().at(-1);
    return { status: "connected", source: "github", data: trendFromCommits(records, days, context.requestedAt), asOf };
  },

  async getHealth(context): Promise<ProviderHealth> {
    const resource = configuredResource();
    if (!getConfiguration()) {
      return {
        status: "unavailable",
        checkedAt: context.requestedAt,
        configuredResource: resource,
        authentication: "not-configured",
        message: "GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPOSITORY.",
        errorCode: "not-configured",
      };
    }

    const result = await githubProvider.listRepositories(context);
    if (result.status === "connected") {
      return {
        status: "connected",
        checkedAt: context.requestedAt,
        configuredResource: resource,
        lastSuccessfulFetch: result.asOf,
        authentication: "authenticated",
        message: "Read-only GitHub access is healthy.",
      };
    }

    return {
      status: "unavailable",
      checkedAt: context.requestedAt,
      configuredResource: resource,
      authentication: result.errorCode === "authentication" ? "unauthorized" : "unknown",
      message: result.reason,
      errorCode: result.errorCode,
    };
  },
};

export const realGitHubProvider: GitHubProvider = githubProvider;
