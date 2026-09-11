import "server-only";

import {
  emptyProjectTelemetryProvider,
} from "./empty-provider";
import { realCodexTelemetryProvider } from "./codex";
import { realGitHubProvider } from "./github";
import type { ProviderRegistry } from "./types";

/**
 * Composition boundary for all external data.
 *
 * Presentation code depends on this registry's typed contracts, never on a
 * provider SDK or credential. GitHub is the first live adapter; future sources
 * can be added here without coupling them to dashboard components.
 */
export const providerRegistry: ProviderRegistry = {
  github: realGitHubProvider,
  repositories: realGitHubProvider,
  commits: realGitHubProvider,
  branches: realGitHubProvider,
  pullRequests: realGitHubProvider,
  issues: realGitHubProvider,
  builds: realGitHubProvider,
  activity: realGitHubProvider,
  codex: realCodexTelemetryProvider,
  codexActivity: realCodexTelemetryProvider,
  codexUsage: realCodexTelemetryProvider,
  projectTelemetry: emptyProjectTelemetryProvider,
};
