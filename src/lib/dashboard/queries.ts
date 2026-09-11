import { providerRegistry } from "@/lib/providers/registry";
import type {
  ActivityRecord,
  ActivityTrendPoint,
  AuthenticationState,
  BranchRecord,
  BuildRecord,
  CommitRecord,
  DataResult,
  IssueRecord,
  ProviderCapability,
  ProviderHealth,
  ProviderId,
  ProviderStatus,
  PullRequestRecord,
  RepositoryRecord,
} from "@/lib/providers/types";

export interface DashboardMetric {
  id: string;
  label: string;
  helper: string;
  result: DataResult<number>;
}

export type TrendPoint = ActivityTrendPoint;

export interface DashboardSnapshot {
  metrics: DashboardMetric[];
  repositories: DataResult<RepositoryRecord[]>;
  commits: DataResult<CommitRecord[]>;
  branches: DataResult<BranchRecord[]>;
  pullRequests: DataResult<PullRequestRecord[]>;
  issues: DataResult<IssueRecord[]>;
  builds: DataResult<BuildRecord[]>;
  activity: DataResult<ActivityRecord[]>;
  trends: {
    sevenDay: DataResult<TrendPoint[]>;
    thirtyDay: DataResult<TrendPoint[]>;
  };
  sources: DataSourceSummary[];
  githubHealth: ProviderHealth;
}

export interface DataSourceSummary {
  id: ProviderId;
  name: string;
  description: string;
  status: ProviderStatus;
  capabilities: readonly ProviderCapability[];
  configuredResource?: string;
  lastSuccessfulFetch?: string;
  authentication: AuthenticationState;
  message: string;
}

function countResult<T>(result: DataResult<T[]>, fallbackReason: string): DataResult<number> {
  if (result.status === "connected") {
    return {
      status: "connected",
      data: result.data.length,
      source: result.source,
      asOf: result.asOf,
    };
  }

  return {
    status: "unavailable",
    source: result.source,
    reason: result.reason || fallbackReason,
    errorCode: result.errorCode,
  };
}

function emptyProviderHealth(
  status: ProviderStatus,
  checkedAt: string,
  message: string,
  errorCode?: ProviderHealth["errorCode"],
): ProviderHealth {
  return {
    status,
    checkedAt,
    authentication: status === "connected" ? "authenticated" : "unknown",
    message,
    errorCode,
  };
}

function sourceSummary(
  descriptor: { id: ProviderId; name: string; description: string; capabilities: readonly ProviderCapability[] },
  health: ProviderHealth,
): DataSourceSummary {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    status: health.status,
    capabilities: descriptor.capabilities,
    configuredResource: health.configuredResource,
    lastSuccessfulFetch: health.lastSuccessfulFetch,
    authentication: health.authentication,
    message: health.message,
  };
}

function enrichGitHubHealth(health: ProviderHealth, results: Array<DataResult<unknown[]>>): ProviderHealth {
  if (health.status !== "connected") return health;

  const failures = results.filter((result): result is Extract<DataResult<unknown[]>, { status: "unavailable" }> => result.status === "unavailable");
  if (failures.length === 0) return health;

  const reasons = [...new Set(failures.map((failure) => failure.reason))].slice(0, 2);
  const hasAuthenticationFailure = failures.some((failure) => failure.errorCode === "authentication");
  const hasPermissionFailure = failures.some((failure) => failure.errorCode === "permission");

  return {
    ...health,
    authentication: hasAuthenticationFailure ? "unauthorized" : hasPermissionFailure ? "permission-denied" : health.authentication,
    message: `GitHub is connected, but some capabilities are unavailable. ${reasons.join(" ")}`,
    errorCode: failures[0]?.errorCode,
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const context = { requestedAt: new Date().toISOString() };
  const github = providerRegistry.github;
  const [githubHealth, repositories, commits, branches, pullRequests, issues, builds, activity, sevenDay, thirtyDay, codexActivity, projectTelemetry] = await Promise.all([
    github.getHealth(context),
    github.listRepositories(context),
    github.listCommits(context),
    github.listBranches(context),
    github.listPullRequests(context),
    github.listIssues(context),
    github.listBuilds(context),
    github.listActivity(context),
    github.listActivityTrend(context, 7),
    github.listActivityTrend(context, 30),
    providerRegistry.codexActivity.listCodexActivity(context),
    providerRegistry.projectTelemetry.listProjectTelemetry(context),
  ]);
  const effectiveGithubHealth = enrichGitHubHealth(githubHealth, [repositories, commits, branches, pullRequests, issues, builds, activity, sevenDay, thirtyDay]);
  const codexHealth = emptyProviderHealth(
    codexActivity.status,
    context.requestedAt,
    codexActivity.status === "connected" ? "Codex telemetry is available." : codexActivity.reason,
    codexActivity.status === "unavailable" ? codexActivity.errorCode : undefined,
  );
  const projectHealth = emptyProviderHealth(
    projectTelemetry.status,
    context.requestedAt,
    projectTelemetry.status === "connected" ? "Project telemetry is available." : projectTelemetry.reason,
    projectTelemetry.status === "unavailable" ? projectTelemetry.errorCode : undefined,
  );

  return {
    metrics: [
      {
        id: "repositories",
        label: "Active repositories",
        helper: "Tracked projects with recent activity",
        result: countResult(repositories, "Repository data is unavailable."),
      },
      {
        id: "commits",
        label: "Recent commits",
        helper: "Commit activity from connected repositories",
        result: countResult(commits, "Commit data is unavailable."),
      },
      {
        id: "pull-requests",
        label: "Open pull requests",
        helper: "Review queue across connected repositories",
        result: countResult(pullRequests, "Pull request data is unavailable."),
      },
      {
        id: "issues",
        label: "Open issues",
        helper: "Unresolved work across connected repositories",
        result: countResult(issues, "Issue data is unavailable."),
      },
      {
        id: "successful-builds",
        label: "Successful CI runs",
        helper: "Successful builds in the current view",
        result: builds.status === "connected"
          ? { ...builds, data: builds.data.filter((build) => build.status === "success").length }
          : builds,
      },
      {
        id: "failed-builds",
        label: "Failed CI runs",
        helper: "Builds needing attention in the current view",
        result: builds.status === "connected"
          ? { ...builds, data: builds.data.filter((build) => build.status === "failure").length }
          : builds,
      },
    ],
    repositories,
    commits,
    branches,
    pullRequests,
    issues,
    builds,
    activity,
    trends: { sevenDay, thirtyDay },
    githubHealth: effectiveGithubHealth,
    sources: [
      sourceSummary(github, githubHealth),
      sourceSummary(providerRegistry.codexActivity, codexHealth),
      sourceSummary(providerRegistry.projectTelemetry, projectHealth),
    ],
  };
}
