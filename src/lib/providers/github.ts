import "server-only";

import { createGitHubProvider } from "./github-core";
import type { GitHubConfiguration } from "./github-core";

function configuredResource(): string | undefined {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  return owner && repository ? `${owner}/${repository}` : undefined;
}

function getConfiguration(): GitHubConfiguration | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();

  if (!token || !owner || !repository) return undefined;
  return { token, targets: [{ owner, repository }] };
}

/**
 * Server-only composition wrapper. Local Next.js reads `.env.local`; a future
 * Worker receives the same names from encrypted Cloudflare bindings.
 */
export const realGitHubProvider = createGitHubProvider({
  getConfiguration,
  getConfiguredResource: configuredResource,
});
