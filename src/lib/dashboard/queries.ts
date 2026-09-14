import "server-only";

import { composeDashboardSnapshot } from "@/lib/dashboard/view-model";
import { providerRegistry } from "@/lib/providers/registry";
import type { DashboardRange } from "@/lib/dashboard/analytics";

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

export async function getCodexPageData(range: DashboardRange, includeForensics = false) {
  const requestedAt = new Date().toISOString();
  const context = { requestedAt, telemetryRange: range };
  const snapshot = await providerRegistry.codex.getSnapshot(context);
  const forensics = includeForensics ? await providerRegistry.codex.getForensics(context) : undefined;
  return { snapshot, forensics, requestedAt, range };
}

export async function getGitHubPageData() {
  const requestedAt = new Date().toISOString();
  return { snapshot: await providerRegistry.github.getSnapshot({ requestedAt }), requestedAt };
}
