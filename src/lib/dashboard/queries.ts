import "server-only";

import { composeDashboardSnapshot } from "@/lib/dashboard/view-model";
import { providerRegistry } from "@/lib/providers/registry";

export type {
  DashboardMetric,
  DashboardSnapshot,
  DataSourceSummary,
  TrendPoint,
} from "@/lib/dashboard/view-model";

export async function getDashboardSnapshot() {
  const requestedAt = new Date().toISOString();
  const context = { requestedAt };
  const githubProvider = providerRegistry.github;

  const [github, codexActivity, projectTelemetry] = await Promise.all([
    githubProvider.getSnapshot(context),
    providerRegistry.codexActivity.listCodexActivity(context),
    providerRegistry.projectTelemetry.listProjectTelemetry(context),
  ]);

  return composeDashboardSnapshot({
    requestedAt,
    github,
    githubDescriptor: githubProvider,
    codexActivity,
    codexDescriptor: providerRegistry.codexActivity,
    projectTelemetry,
    projectDescriptor: providerRegistry.projectTelemetry,
  });
}
