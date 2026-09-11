import "server-only";

import {
  emptyBranchProvider,
  emptyBuildProvider,
  emptyCodexActivityProvider,
  emptyCodexUsageProvider,
  emptyCommitProvider,
  emptyIssueProvider,
  emptyProjectTelemetryProvider,
  emptyPullRequestProvider,
  emptyRepositoryProvider,
} from "./empty-provider";
import type { ProviderRegistry } from "./types";

/**
 * Composition boundary for all external data.
 *
 * Replace individual empty adapters with server-only integrations as providers
 * become available. Presentation code should depend on this registry's typed
 * contracts, never on a provider SDK or credential.
 */
export const providerRegistry: ProviderRegistry = {
  repositories: emptyRepositoryProvider,
  commits: emptyCommitProvider,
  branches: emptyBranchProvider,
  pullRequests: emptyPullRequestProvider,
  issues: emptyIssueProvider,
  builds: emptyBuildProvider,
  codexActivity: emptyCodexActivityProvider,
  codexUsage: emptyCodexUsageProvider,
  projectTelemetry: emptyProjectTelemetryProvider,
};
