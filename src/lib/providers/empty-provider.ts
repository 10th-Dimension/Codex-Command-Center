import type {
  BranchProvider,
  BuildProvider,
  CodexActivityProvider,
  CodexUsageProvider,
  CommitProvider,
  IssueProvider,
  ProjectTelemetryProvider,
  ProviderId,
  PullRequestProvider,
  RepositoryProvider,
} from "./types";

const unavailable = (source: ProviderId, reason: string) => ({
  status: "unavailable" as const,
  source,
  reason,
});

const githubDescriptor = {
  id: "github" as const,
  name: "GitHub",
  description: "Repositories, code activity, work queues, and Actions evidence.",
  capabilities: ["repositories", "commits", "branches", "pull-requests", "issues", "builds"] as const,
};

export const emptyRepositoryProvider: RepositoryProvider = {
  ...githubDescriptor,
  async listRepositories() {
    return unavailable("github", "GitHub is not connected.");
  },
};

export const emptyCommitProvider: CommitProvider = {
  ...githubDescriptor,
  async listCommits() {
    return unavailable("github", "GitHub is not connected.");
  },
};

export const emptyBranchProvider: BranchProvider = {
  ...githubDescriptor,
  async listBranches() {
    return unavailable("github", "GitHub is not connected.");
  },
};

export const emptyPullRequestProvider: PullRequestProvider = {
  ...githubDescriptor,
  async listPullRequests() {
    return unavailable("github", "GitHub is not connected.");
  },
};

export const emptyIssueProvider: IssueProvider = {
  ...githubDescriptor,
  async listIssues() {
    return unavailable("github", "GitHub is not connected.");
  },
};

export const emptyBuildProvider: BuildProvider = {
  ...githubDescriptor,
  async listBuilds() {
    return unavailable("github", "GitHub Actions is not connected.");
  },
};

const codexDescriptor = {
  id: "codex" as const,
  name: "Codex telemetry",
  description: "Task activity and usage signals where supported and authorized.",
  capabilities: ["codex-activity", "codex-usage"] as const,
};

export const emptyCodexActivityProvider: CodexActivityProvider = {
  ...codexDescriptor,
  async listCodexActivity() {
    return unavailable("codex", "Codex activity telemetry is not connected.");
  },
};

export const emptyCodexUsageProvider: CodexUsageProvider = {
  ...codexDescriptor,
  async getCodexUsage() {
    return unavailable("codex", "Codex usage telemetry is not connected.");
  },
};

export const emptyProjectTelemetryProvider: ProjectTelemetryProvider = {
  id: "project-telemetry",
  name: "Project telemetry",
  description: "Signals from project systems and future workspace integrations.",
  capabilities: ["project-telemetry"],
  async listProjectTelemetry() {
    return unavailable("project-telemetry", "Project telemetry is not connected.");
  },
};
