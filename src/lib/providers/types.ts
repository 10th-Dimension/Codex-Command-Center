export type ProviderId =
  | "github"
  | "codex"
  | "project-telemetry"
  | "liquidation-terminal";

export type ProviderCapability =
  | "repositories"
  | "commits"
  | "branches"
  | "pull-requests"
  | "issues"
  | "builds"
  | "activity"
  | "codex-activity"
  | "codex-usage"
  | "project-telemetry";

export type ProviderStatus = "connected" | "degraded" | "unavailable";

export type ProviderErrorCode =
  | "not-configured"
  | "authentication"
  | "permission"
  | "rate-limited"
  | "network"
  | "api"
  | "empty";

export type AuthenticationState = "not-configured" | "authenticated" | "unauthorized" | "permission-denied" | "unknown";

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  description: string;
  capabilities: readonly ProviderCapability[];
}

export interface ProviderContext {
  requestedAt: string;
  signal?: AbortSignal;
}

export interface ProviderHealth {
  status: ProviderStatus;
  checkedAt: string;
  configuredResource?: string;
  lastSuccessfulFetch?: string;
  authentication: AuthenticationState;
  message: string;
  errorCode?: ProviderErrorCode;
  retry?: ProviderRetryMetadata;
}

export interface ProviderRetryMetadata {
  retryAfterSeconds?: number;
  retryAt?: string;
}

export interface ResultBounds {
  description: string;
  limit: number;
  truncated: boolean;
}

export interface ProviderResultMetadata {
  bounds?: ResultBounds;
  cacheState?: "upstream" | "fresh-cache" | "stale-cache";
  partial?: boolean;
  retry?: ProviderRetryMetadata;
}

export type DataResult<T> =
  | {
      status: "connected";
      data: T;
      source: ProviderId;
      asOf?: string;
      meta?: ProviderResultMetadata;
    }
  | {
      status: "unavailable";
      source: ProviderId;
      reason: string;
      errorCode?: ProviderErrorCode;
      meta?: ProviderResultMetadata;
    };

export interface RepositoryRecord {
  id: string;
  name: string;
  fullName: string;
  visibility: "private" | "public" | "internal";
  defaultBranch: string;
  updatedAt: string;
  url?: string;
}

export interface CommitRecord {
  id: string;
  repositoryId: string;
  message: string;
  author: string;
  committedAt: string;
  url?: string;
}

export interface BranchRecord {
  id: string;
  repositoryId: string;
  name: string;
  isDefault: boolean;
  lastCommitId?: string;
  updatedAt?: string;
}

export interface PullRequestRecord {
  id: string;
  repositoryId: string;
  title: string;
  number: number;
  state: "open" | "closed" | "merged";
  author: string;
  updatedAt: string;
  url?: string;
}

export interface IssueRecord {
  id: string;
  repositoryId: string;
  title: string;
  number: number;
  state: "open" | "closed";
  author: string;
  updatedAt: string;
  url?: string;
}

export interface BuildRecord {
  id: string;
  repositoryId: string;
  name: string;
  status: "queued" | "in-progress" | "success" | "failure" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  url?: string;
}

export interface ActivityRecord {
  id: string;
  repositoryId: string;
  kind: "commit" | "pull-request" | "issue" | "build";
  title: string;
  summary: string;
  occurredAt: string;
  author?: string;
  url?: string;
}

export interface ActivityTrendPoint {
  label: string;
  value: number;
}

export interface GitHubDataSnapshot {
  repositories: DataResult<RepositoryRecord[]>;
  commits: DataResult<CommitRecord[]>;
  branches: DataResult<BranchRecord[]>;
  pullRequests: DataResult<PullRequestRecord[]>;
  issues: DataResult<IssueRecord[]>;
  builds: DataResult<BuildRecord[]>;
  activity: DataResult<ActivityRecord[]>;
  trends: {
    sevenDay: DataResult<ActivityTrendPoint[]>;
    thirtyDay: DataResult<ActivityTrendPoint[]>;
  };
  health: ProviderHealth;
}

export interface CodexActivityRecord {
  id: string;
  taskId: string;
  projectId?: string;
  summary: string;
  status: "running" | "completed" | "blocked" | "failed";
  occurredAt: string;
}

export interface CodexUsageSnapshot {
  window: "7d" | "30d";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  requests?: number;
  capturedAt: string;
}

export interface ProjectTelemetryRecord {
  id: string;
  projectId: string;
  event: string;
  occurredAt: string;
  metadata?: Record<string, string>;
}

export interface RepositoryProvider extends ProviderDescriptor {
  listRepositories(context: ProviderContext): Promise<DataResult<RepositoryRecord[]>>;
}

export interface CommitProvider extends ProviderDescriptor {
  listCommits(context: ProviderContext): Promise<DataResult<CommitRecord[]>>;
}

export interface BranchProvider extends ProviderDescriptor {
  listBranches(context: ProviderContext): Promise<DataResult<BranchRecord[]>>;
}

export interface PullRequestProvider extends ProviderDescriptor {
  listPullRequests(context: ProviderContext): Promise<DataResult<PullRequestRecord[]>>;
}

export interface IssueProvider extends ProviderDescriptor {
  listIssues(context: ProviderContext): Promise<DataResult<IssueRecord[]>>;
}

export interface BuildProvider extends ProviderDescriptor {
  listBuilds(context: ProviderContext): Promise<DataResult<BuildRecord[]>>;
}

export interface ActivityProvider extends ProviderDescriptor {
  listActivity(context: ProviderContext): Promise<DataResult<ActivityRecord[]>>;
  listActivityTrend(context: ProviderContext, days: 7 | 30): Promise<DataResult<ActivityTrendPoint[]>>;
}

export interface CodexActivityProvider extends ProviderDescriptor {
  listCodexActivity(context: ProviderContext): Promise<DataResult<CodexActivityRecord[]>>;
}

export interface CodexUsageProvider extends ProviderDescriptor {
  getCodexUsage(context: ProviderContext): Promise<DataResult<CodexUsageSnapshot[]>>;
}

export interface ProjectTelemetryProvider extends ProviderDescriptor {
  listProjectTelemetry(context: ProviderContext): Promise<DataResult<ProjectTelemetryRecord[]>>;
}

export interface GitHubProvider extends
  RepositoryProvider,
  CommitProvider,
  BranchProvider,
  PullRequestProvider,
  IssueProvider,
  BuildProvider,
  ActivityProvider {
  getSnapshot(context: ProviderContext): Promise<GitHubDataSnapshot>;
  getHealth(context: ProviderContext): Promise<ProviderHealth>;
}

export interface ProviderRegistry {
  github: GitHubProvider;
  repositories: RepositoryProvider;
  commits: CommitProvider;
  branches: BranchProvider;
  pullRequests: PullRequestProvider;
  issues: IssueProvider;
  builds: BuildProvider;
  activity: ActivityProvider;
  codexActivity: CodexActivityProvider;
  codexUsage: CodexUsageProvider;
  projectTelemetry: ProjectTelemetryProvider;
}
