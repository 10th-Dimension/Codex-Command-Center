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
  | "codex-activity"
  | "codex-usage"
  | "project-telemetry";

export type ProviderStatus = "connected" | "unavailable";

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

export type DataResult<T> =
  | {
      status: "connected";
      data: T;
      source: ProviderId;
      asOf?: string;
    }
  | {
      status: "unavailable";
      source: ProviderId;
      reason: string;
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

export interface CodexActivityProvider extends ProviderDescriptor {
  listCodexActivity(context: ProviderContext): Promise<DataResult<CodexActivityRecord[]>>;
}

export interface CodexUsageProvider extends ProviderDescriptor {
  getCodexUsage(context: ProviderContext): Promise<DataResult<CodexUsageSnapshot[]>>;
}

export interface ProjectTelemetryProvider extends ProviderDescriptor {
  listProjectTelemetry(context: ProviderContext): Promise<DataResult<ProjectTelemetryRecord[]>>;
}

export interface ProviderRegistry {
  repositories: RepositoryProvider;
  commits: CommitProvider;
  branches: BranchProvider;
  pullRequests: PullRequestProvider;
  issues: IssueProvider;
  builds: BuildProvider;
  codexActivity: CodexActivityProvider;
  codexUsage: CodexUsageProvider;
  projectTelemetry: ProjectTelemetryProvider;
}
