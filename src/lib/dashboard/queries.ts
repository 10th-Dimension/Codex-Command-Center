import { providerRegistry } from "@/lib/providers/registry";
import type { DataResult, ProviderCapability, ProviderStatus } from "@/lib/providers/types";

export interface DashboardMetric {
  id: string;
  label: string;
  helper: string;
  result: DataResult<number>;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface DashboardSnapshot {
  metrics: DashboardMetric[];
  trends: {
    sevenDay: DataResult<TrendPoint[]>;
    thirtyDay: DataResult<TrendPoint[]>;
  };
  recentActivity: DataResult<unknown[]>;
  buildHealth: DataResult<unknown[]>;
  sources: DataSourceSummary[];
}

export interface DataSourceSummary {
  id: string;
  name: string;
  description: string;
  status: ProviderStatus;
  capabilities: readonly ProviderCapability[];
  reason: string;
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
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const context = { requestedAt: new Date().toISOString() };
  const [repositories, commits, pullRequests, issues, builds, codexActivity, projectTelemetry] = await Promise.all([
    providerRegistry.repositories.listRepositories(context),
    providerRegistry.commits.listCommits(context),
    providerRegistry.pullRequests.listPullRequests(context),
    providerRegistry.issues.listIssues(context),
    providerRegistry.builds.listBuilds(context),
    providerRegistry.codexActivity.listCodexActivity(context),
    providerRegistry.projectTelemetry.listProjectTelemetry(context),
  ]);

  const githubProvider = providerRegistry.repositories;
  const codexProvider = providerRegistry.codexActivity;
  const projectProvider = providerRegistry.projectTelemetry;

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
    trends: {
      sevenDay: {
        status: "unavailable",
        source: projectTelemetry.source,
        reason: "A project telemetry provider is not connected.",
      },
      thirtyDay: {
        status: "unavailable",
        source: projectTelemetry.source,
        reason: "A project telemetry provider is not connected.",
      },
    },
    recentActivity: codexActivity.status === "connected" ? codexActivity : {
      status: "unavailable",
      source: githubProvider.id,
      reason: "No activity provider is connected.",
    },
    buildHealth: builds,
    sources: [
      {
        id: githubProvider.id,
        name: githubProvider.name,
        description: githubProvider.description,
        status: repositories.status,
        capabilities: githubProvider.capabilities,
        reason: repositories.status === "unavailable" ? repositories.reason : "Connected.",
      },
      {
        id: codexProvider.id,
        name: codexProvider.name,
        description: codexProvider.description,
        status: codexActivity.status,
        capabilities: codexProvider.capabilities,
        reason: codexActivity.status === "unavailable" ? codexActivity.reason : "Connected.",
      },
      {
        id: projectProvider.id,
        name: projectProvider.name,
        description: projectProvider.description,
        status: projectTelemetry.status,
        capabilities: projectProvider.capabilities,
        reason: projectTelemetry.status === "unavailable" ? projectTelemetry.reason : "Connected.",
      },
    ],
  };
}
