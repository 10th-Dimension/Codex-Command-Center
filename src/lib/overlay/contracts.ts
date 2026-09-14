export type OverlayRange = "24h" | "7d" | "30d";
export type OverlayProviderStatus = "connected" | "degraded" | "unavailable";

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
}
