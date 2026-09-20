import {
  BarChart3,
  GitBranch,
  LayoutDashboard,
  ListTree,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const navigationItems: NavigationItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Usage", href: "/?section=usage", icon: BarChart3 },
  { label: "Activity", href: "/?section=activity", icon: ListTree },
  { label: "GitHub", href: "/github", icon: GitBranch },
];

export type CodexWorkspaceMode = "overview" | "usage" | "activity";

const usageSections = new Set(["usage", "sessions", "tools", "data-health"]);
const activitySections = new Set(["activity", "forensics"]);

export function codexWorkspaceMode(section?: string): CodexWorkspaceMode {
  if (section && usageSections.has(section)) return "usage";
  if (section && activitySections.has(section)) return "activity";
  return "overview";
}

export const legacySectionRedirects: Record<string, string> = {
  usage: "/?section=usage",
  "codex-activity": "/?section=activity",
  "data-sources": "/?section=data-health",
  repositories: "/github?section=repository",
  activity: "/github?section=activity",
  "pull-requests-issues": "/github?section=pull-requests",
  "build-ci-health": "/github?section=build-ci",
  settings: "/",
};
