export type OverlayRange = "24h" | "7d" | "30d";
export type OverlayProviderStatus = "connected" | "degraded" | "unavailable";
export type TelemetryBufferReplayState = "idle" | "buffering" | "replaying" | "degraded";

export interface TelemetryBufferHealth {
  queuedBatches: number;
  queuedBytes: number;
  oldestQueuedAgeSeconds?: number;
  lastSuccessfulReplayAt?: string;
  lastUpstreamFailureAt?: string;
  droppedBatches: number;
  replayState: TelemetryBufferReplayState;
}

export type CodexAccountStatus = "connected" | "stale" | "unavailable" | "error";
export type CodexAccountFreshness = "live" | "recent" | "stale" | "unavailable";

export interface CodexQuotaWindow {
  slot: "primary" | "secondary";
  kind: "5h" | "7d" | "other";
  label: string;
  durationMins?: number;
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number;
}

export interface CodexQuotaCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface CodexQuotaLimit {
  limitId?: string;
  limitName?: string;
  normalModelSlug?: string;
  windows: CodexQuotaWindow[];
  credits?: CodexQuotaCredits;
  individualLimit?: boolean;
  spendControlReached?: boolean;
  rateLimitReachedType?: string;
}

export interface CodexResetCreditDetail {
  status: string;
  grantedAt?: number;
  expiresAt?: number;
  title?: string;
}

export interface CodexAccountActivity {
  lifetimeTokens?: number;
  currentStreakDays?: number;
  longestStreakDays?: number;
  peakDailyTokens?: number;
  longestRunningTurnSec?: number;
  dailyUsageBuckets?: Array<{
    startDate: string;
    tokens: number;
  }>;
}

export interface CodexAccountSnapshot {
  status: CodexAccountStatus;
  freshness: CodexAccountFreshness;
  observedAt?: string;
  rateLimitsObservedAt?: string;
  activityObservedAt?: string;
  accountType?: string;
  planType?: string;
  ordinaryUsageAllowed?: boolean;
  limits: CodexQuotaLimit[];
  resetCredits?: {
    availableCount: number;
    expirations?: number[];
    details?: CodexResetCreditDetail[];
  };
  activity?: CodexAccountActivity;
}

export interface OverlayTrendPoint {
  label: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
}

export interface OverlayDistributionItem {
  label: string;
  count: number;
}

export interface OverlaySnapshot {
  generatedAt: string;
  range: OverlayRange;
  lastTelemetryAt?: string;
  health: {
    telemetry: OverlayProviderStatus;
    d1: OverlayProviderStatus;
    github: OverlayProviderStatus;
    ci: OverlayProviderStatus;
  };
  latestSession?: {
    model?: string;
    reasoningEffort?: string;
    startedAt: string;
    lastSeenAt: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
    toolTokens?: number;
    averageTtftMs?: number;
    completedTools: number;
    toolFailures?: number;
    approvals: number;
    errors: number;
  };
  windowSummary: {
    sessions?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
    toolTokens?: number;
    averageTtftMs?: number;
    completedTools?: number;
    failures?: number;
  };
  tokenTrend: OverlayTrendPoint[];
  modelDistribution: OverlayDistributionItem[];
  reasoningDistribution: OverlayDistributionItem[];
  delivery?: {
    repository?: string;
    latestBuild?: {
      name: string;
      status: "queued" | "in-progress" | "success" | "failure" | "cancelled";
      completedAt?: string;
    };
  };
  codexAccount?: CodexAccountSnapshot;
  telemetryBuffer?: TelemetryBufferHealth;
}
