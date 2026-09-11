import type {
  ActivityRecord,
  ActivityTrendPoint,
  AuthenticationState,
  BranchRecord,
  BuildRecord,
  CodexActivityRecord,
  CommitRecord,
  DataResult,
  GitHubDataSnapshot,
  IssueRecord,
  ProjectTelemetryRecord,
  ProviderCapability,
  ProviderHealth,
  ProviderId,
  ProviderRetryMetadata,
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
  retry?: ProviderRetryMetadata;
}

interface Descriptor {
  id: ProviderId;
  name: string;
  description: string;
  capabilities: readonly ProviderCapability[];
}

export interface DashboardCompositionInput {
  requestedAt: string;
  github: GitHubDataSnapshot;
  githubDescriptor: Descriptor;
  codexActivity: DataResult<CodexActivityRecord[]>;
  codexDescriptor: Descriptor;
  projectTelemetry: DataResult<ProjectTelemetryRecord[]>;
  projectDescriptor: Descriptor;
}

function countResult<T>(result: DataResult<T[]>): DataResult<number> {
  if (result.status === "unavailable") return result;
  return { ...result, data: result.data.length };
}

function emptyProviderHealth(
  result: DataResult<unknown[]>,
  checkedAt: string,
  connectedMessage: string,
): ProviderHealth {
  return result.status === "connected"
    ? { status: "connected", checkedAt, authentication: "authenticated", message: connectedMessage }
    : {
        status: "unavailable",
        checkedAt,
        authentication: result.errorCode === "not-configured" ? "not-configured" : "unknown",
        message: result.reason,
        errorCode: result.errorCode,
        retry: result.meta?.retry,
      };
}

function sourceSummary(descriptor: Descriptor, health: ProviderHealth): DataSourceSummary {
  return {
    ...descriptor,
    status: health.status,
    configuredResource: health.configuredResource,
    lastSuccessfulFetch: health.lastSuccessfulFetch,
    authentication: health.authentication,
    message: health.message,
    retry: health.retry,
  };
}

function buildMetricResult(builds: DataResult<BuildRecord[]>, status: BuildRecord["status"]): DataResult<number> {
  if (builds.status === "unavailable") return builds;
  return { ...builds, data: builds.data.filter((build) => build.status === status).length };
}

export function composeDashboardSnapshot(input: DashboardCompositionInput): DashboardSnapshot {
  const { github } = input;
  const codexHealth = emptyProviderHealth(input.codexActivity, input.requestedAt, "Codex telemetry is available.");
  const projectHealth = emptyProviderHealth(input.projectTelemetry, input.requestedAt, "Project telemetry is available.");

  return {
    metrics: [
      {
        id: "repositories",
        label: "Configured repositories",
        helper: "Repositories returned by the current provider scope",
        result: countResult(github.repositories),
      },
      {
        id: "commits",
        label: "Recent commits",
        helper: "Commits in the bounded 30-day GitHub view",
        result: countResult(github.commits),
      },
      {
        id: "pull-requests",
        label: "Open pull requests",
        helper: "Open PRs in the bounded recent result",
        result: countResult(github.pullRequests),
      },
      {
        id: "issues",
        label: "Open issues",
        helper: "Open issues in the bounded recent result",
        result: countResult(github.issues),
      },
      {
        id: "successful-builds",
        label: "Successful CI runs",
        helper: "Successful runs in the bounded recent result",
        result: buildMetricResult(github.builds, "success"),
      },
      {
        id: "failed-builds",
        label: "Failed CI runs",
        helper: "Failed runs in the bounded recent result",
        result: buildMetricResult(github.builds, "failure"),
      },
    ],
    repositories: github.repositories,
    commits: github.commits,
    branches: github.branches,
    pullRequests: github.pullRequests,
    issues: github.issues,
    builds: github.builds,
    activity: github.activity,
    trends: github.trends,
    githubHealth: github.health,
    sources: [
      sourceSummary(input.githubDescriptor, github.health),
      sourceSummary(input.codexDescriptor, codexHealth),
      sourceSummary(input.projectDescriptor, projectHealth),
    ],
  };
}
