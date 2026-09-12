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
  | "telemetry-ingest"
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
  eventName: string;
  eventKind?: string;
  category: CodexTelemetryCategory;
  taskId?: string;
  sessionId?: string;
  threadId?: string;
  projectId?: string;
  projectName?: string;
  repositoryId?: string;
  workspaceId?: string;
  environment?: string;
  model?: string;
  reasoningEffort?: string;
  toolName?: string;
  toolType?: string;
  toolStatus?: string;
  toolNamespace?: string;
  toolExecutionState?: CodexToolExecutionState;
  decision?: string;
  approvalDecision?: string;
  approvalPolicy?: string;
  sandboxPolicy?: string;
  mcpServer?: string;
  mcpTool?: string;
  mcpServerOrigin?: string;
  networkHost?: string;
  networkDecision?: string;
  agentName?: string;
  providerName?: string;
  originator?: string;
  appVersion?: string;
  serviceName?: string;
  serviceVersion?: string;
  startupPhase?: string;
  startupStatus?: string;
  terminalType?: string;
  success?: boolean;
  errorType?: string;
  status?: string;
  severity?: string;
  durationMs?: number;
  ttftMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  safeAttributeKeys: string[];
  unknownAttributeKeys: string[];
  occurredAt: string;
  receivedAt: string;
  source: "openai-codex-otel";
  schemaVersion: 1 | 2;
}

export type CodexMetricAvailability = "available" | "unavailable" | "no-samples";

export interface CodexMeasuredValue {
  availability: CodexMetricAvailability;
  value?: number;
  sampleCount: number;
}

export interface CodexUsageSnapshot {
  window: "24h" | "7d" | "30d";
  inputTokens: CodexMeasuredValue;
  outputTokens: CodexMeasuredValue;
  cachedInputTokens: CodexMeasuredValue;
  cacheWriteTokens: CodexMeasuredValue;
  reasoningTokens: CodexMeasuredValue;
  toolTokens: CodexMeasuredValue;
  eventsWithUsage: number;
  sessionsWithUsage: number;
  modelsWithUsage: number;
  capturedAt: string;
}

export type CodexTelemetryCategory =
  | "startup"
  | "session"
  | "model"
  | "api-request"
  | "tool"
  | "mcp"
  | "network"
  | "approval"
  | "decision"
  | "error"
  | "warning"
  | "usage"
  | "unknown";

export type CodexToolExecutionState = "started" | "succeeded" | "failed" | "related";

export interface CodexTelemetryTrendPoint {
  label: string;
  events: number;
  errors: number;
  toolExecutions: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
}

export interface CodexTelemetryBreakdown {
  label: string;
  count: number;
}

export interface CodexTelemetryTimingBreakdown {
  label: string;
  sampleCount: number;
  averageMs: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  minimumMs: number;
  maximumMs: number;
}

export interface CodexTelemetryToolSummary {
  label: string;
  relatedEventCount: number;
  completedExecutionCount: number;
  successCount: number;
  failureCount: number;
  failureRate?: number;
  averageDurationMs?: number;
  p50DurationMs?: number;
  p95DurationMs?: number;
  toolTokens?: number;
  lastSeenAt: string;
}

export interface CodexTelemetrySessionSummary {
  sessionId: string;
  projectName?: string;
  models: string[];
  reasoningEfforts: string[];
  eventCount: number;
  errorCount: number;
  toolExecutions: number;
  toolRelatedEvents: number;
  usageEvents: number;
  approvalEvents: number;
  warningCount: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  averageTtftMs?: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CodexTelemetryModelSummary {
  model: string;
  eventCount: number;
  sessionCount: number;
  usageEventCount: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  averageTtftMs?: number;
  p50TtftMs?: number;
  p95TtftMs?: number;
  averageDurationMs?: number;
  toolExecutions: number;
  toolFailures: number;
  approvalEvents: number;
}

export interface CodexTelemetryReasoningSummary {
  reasoningEffort: string;
  eventCount: number;
  sessionCount: number;
  usageEventCount: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  toolExecutions: number;
  averageTtftMs?: number;
  averageDurationMs?: number;
}

export interface CodexTelemetryCorrelation {
  dimension: string;
  label: string;
  count: number;
}

export interface CodexTelemetryProjectSummary {
  projectId: string;
  projectName?: string;
  eventCount: number;
  sessionCount: number;
  lastSeenAt: string;
}

export interface CodexTelemetrySnapshot {
  activity: DataResult<CodexActivityRecord[]>;
  trends: {
    twentyFourHour: DataResult<CodexTelemetryTrendPoint[]>;
    sevenDay: DataResult<CodexTelemetryTrendPoint[]>;
    thirtyDay: DataResult<CodexTelemetryTrendPoint[]>;
  };
  usage: DataResult<CodexUsageSnapshot[]>;
  categories: DataResult<CodexTelemetryBreakdown[]>;
  models: DataResult<CodexTelemetryBreakdown[]>;
  modelAnalytics: DataResult<CodexTelemetryModelSummary[]>;
  reasoningEfforts: DataResult<CodexTelemetryBreakdown[]>;
  reasoningAnalytics: DataResult<CodexTelemetryReasoningSummary[]>;
  correlations: DataResult<CodexTelemetryCorrelation[]>;
  tools: DataResult<CodexTelemetryToolSummary[]>;
  timings: DataResult<CodexTelemetryTimingBreakdown[]>;
  approvals: DataResult<CodexTelemetryBreakdown[]>;
  approvalPolicies: DataResult<CodexTelemetryBreakdown[]>;
  sandboxPolicies: DataResult<CodexTelemetryBreakdown[]>;
  mcpServers: DataResult<CodexTelemetryBreakdown[]>;
  mcpTools: DataResult<CodexTelemetryBreakdown[]>;
  mcpOrigins: DataResult<CodexTelemetryBreakdown[]>;
  toolNamespaces: DataResult<CodexTelemetryBreakdown[]>;
  agents: DataResult<CodexTelemetryBreakdown[]>;
  providers: DataResult<CodexTelemetryBreakdown[]>;
  originators: DataResult<CodexTelemetryBreakdown[]>;
  appVersions: DataResult<CodexTelemetryBreakdown[]>;
  serviceVersions: DataResult<CodexTelemetryBreakdown[]>;
  startupStatuses: DataResult<CodexTelemetryBreakdown[]>;
  terminalTypes: DataResult<CodexTelemetryBreakdown[]>;
  ttft: DataResult<CodexTelemetryTimingBreakdown[]>;
  networkDecisions: DataResult<CodexTelemetryBreakdown[]>;
  networkHosts: DataResult<CodexTelemetryBreakdown[]>;
  sessions: DataResult<CodexTelemetrySessionSummary[]>;
  projects: DataResult<CodexTelemetryProjectSummary[]>;
  recentErrors: DataResult<CodexActivityRecord[]>;
  health: ProviderHealth;
  lastReceivedAt?: string;
  oldestEventAt?: string;
  newestEventAt?: string;
  eventCount?: number;
  todayEventCount?: number;
  observedSessionCount24h?: number;
  failedToolCount30d?: number;
  retentionDays: number;
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

export interface CodexTelemetryProvider extends CodexActivityProvider, CodexUsageProvider {
  getSnapshot(context: ProviderContext): Promise<CodexTelemetrySnapshot>;
  getHealth(context: ProviderContext): Promise<ProviderHealth>;
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
  codex: CodexTelemetryProvider;
  codexActivity: CodexActivityProvider;
  codexUsage: CodexUsageProvider;
  projectTelemetry: ProjectTelemetryProvider;
}
