import {
  Activity,
  BarChart3,
  GitBranch,
  GitPullRequest,
  GitFork,
  LayoutDashboard,
  ListChecks,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const navigationItems: NavigationItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Repositories", href: "/repositories", icon: GitFork },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Pull Requests & Issues", href: "/pull-requests-issues", icon: GitPullRequest },
  { label: "Build / CI Health", href: "/build-ci-health", icon: GitBranch },
  { label: "Codex Activity", href: "/codex-activity", icon: ListChecks },
  { label: "Usage", href: "/usage", icon: BarChart3 },
  { label: "Data Sources", href: "/data-sources", icon: SlidersHorizontal },
  { label: "Settings", href: "/settings", icon: Settings },
];

export interface SectionContent {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  capabilities: string[];
}

export const sectionContent: Record<string, SectionContent> = {
  repositories: {
    eyebrow: "Inventory / Repositories",
    title: "Repositories",
    description: "A focused inventory of the projects and branches that matter to your workspace.",
    note: "Repository metadata is read from the configured GitHub repository when the source is connected.",
    capabilities: ["Repository metadata and visibility", "Default branches and branch health", "Recent release and ownership context"],
  },
  activity: {
    eyebrow: "Signal stream / Activity",
    title: "Activity",
    description: "A single chronology for commits, reviews, issues, builds, and project events.",
    note: "The activity stream is composed from the configured GitHub repository when the source is connected.",
    capabilities: ["Cross-provider event chronology", "Commit and review context", "Project-level activity filters"],
  },
  "pull-requests-issues": {
    eyebrow: "Work queue / Pull requests & Issues",
    title: "Pull Requests & Issues",
    description: "See work in motion and the decisions still needed across connected repositories.",
    note: "Pull request and issue records are shown directly from GitHub when the source is connected.",
    capabilities: ["Open pull requests and review state", "Issue queues and labels", "Repository and ownership filters"],
  },
  "build-ci-health": {
    eyebrow: "Delivery / Build & CI Health",
    title: "Build / CI Health",
    description: "A durable place for build outcomes, workflow health, and failure context.",
    note: "Build and workflow evidence is read from GitHub Actions when the source is connected.",
    capabilities: ["Workflow and build status", "Failure context and recency", "Repository-level delivery trends"],
  },
  "codex-activity": {
    eyebrow: "Agents / Codex Activity",
    title: "Codex Activity",
    description: "A future view into trusted Codex task activity and the work it produces.",
    note: "Codex telemetry availability depends on the supported integration surface and permissions.",
    capabilities: ["Task activity where obtainable", "Project and task relationships", "Provider freshness and provenance"],
  },
  usage: {
    eyebrow: "Capacity / Usage",
    title: "Usage",
    description: "A private, provenance-aware surface for model and usage telemetry.",
    note: "No usage values are displayed until an authorized usage provider is connected.",
    capabilities: ["Model and usage telemetry where obtainable", "Time-window comparisons", "Explicit freshness and source context"],
  },
  "data-sources": {
    eyebrow: "Trust layer / Data Sources",
    title: "Data Sources",
    description: "Control which providers can contribute data to your command center.",
    note: "GitHub is the initial live provider; future sources remain explicitly unavailable until connected.",
    capabilities: ["Provider connection status", "Capability and freshness visibility", "Server-only credential boundaries"],
  },
  settings: {
    eyebrow: "Workspace / Settings",
    title: "Settings",
    description: "Shape the private workspace without coupling preferences to any provider.",
    note: "Settings are intentionally read-only in this initial architecture pass.",
    capabilities: ["Workspace display preferences", "Provider refresh policy", "Privacy and retention controls"],
  },
};
