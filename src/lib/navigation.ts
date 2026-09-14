import {
  Activity,
  GitBranch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const navigationItems: NavigationItem[] = [
  { label: "Codex", href: "/", icon: Activity },
  { label: "GitHub", href: "/github", icon: GitBranch },
];

export const legacySectionRedirects: Record<string, string> = {
  usage: "/?section=usage",
  "codex-activity": "/?section=forensics",
  "data-sources": "/?section=data-health",
  repositories: "/github?section=repository",
  activity: "/github?section=activity",
  "pull-requests-issues": "/github?section=pull-requests",
  "build-ci-health": "/github?section=build-ci",
  settings: "/",
};
