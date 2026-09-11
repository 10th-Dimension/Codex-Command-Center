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

  const [github, codex, projectTelemetry] = await Promise.all([
    githubProvider.getSnapshot(context),
    providerRegistry.codex.getSnapshot(context),
    providerRegistry.projectTelemetry.listProjectTelemetry(context),
  ]);

  return composeDashboardSnapshot({
    requestedAt,
    github,
    githubDescriptor: githubProvider,
    codex,
    codexDescriptor: providerRegistry.codex,
    projectTelemetry,
    projectDescriptor: providerRegistry.projectTelemetry,
  });
}
