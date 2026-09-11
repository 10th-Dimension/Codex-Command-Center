import type {
  ActivityRecord,
  ActivityTrendPoint,
  AuthenticationState,
  BranchRecord,
  BuildRecord,
  CodexTelemetrySnapshot,
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
  codex: CodexTelemetrySnapshot;
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
  lastReceivedAt?: string;
  retentionDays?: number;
  eventCount?: number;
  oldestEventAt?: string;
  newestEventAt?: string;
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
  codex: CodexTelemetrySnapshot;
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

function telemetryTrendTotal(result: CodexTelemetrySnapshot["trends"]["sevenDay"]): DataResult<number> {
  if (result.status === "unavailable") return result;
  return { ...result, data: result.data.reduce((total, point) => total + point.events, 0) };
}

export function composeDashboardSnapshot(input: DashboardCompositionInput): DashboardSnapshot {
  const { github } = input;
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
      {
        id: "codex-events-7d",
        label: "Codex activity · 7 days",
        helper: "Operational telemetry events received in the last 7 days",
        result: telemetryTrendTotal(input.codex.trends.sevenDay),
      },
      {
        id: "codex-events-30d",
        label: "Codex activity · 30 days",
        helper: "Operational telemetry events received in the last 30 days",
        result: telemetryTrendTotal(input.codex.trends.thirtyDay),
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
    codex: input.codex,
    sources: [
      sourceSummary(input.githubDescriptor, github.health),
      {
        ...sourceSummary(input.codexDescriptor, input.codex.health),
        lastReceivedAt: input.codex.lastReceivedAt,
        retentionDays: input.codex.retentionDays,
        eventCount: input.codex.eventCount,
        oldestEventAt: input.codex.oldestEventAt,
        newestEventAt: input.codex.newestEventAt,
      },
      sourceSummary(input.projectDescriptor, projectHealth),
    ],
  };
}
