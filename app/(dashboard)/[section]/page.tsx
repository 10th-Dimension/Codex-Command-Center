import { notFound } from "next/navigation";

import {
  ActivityPage,
  BuildCIHealthPage,
  DataSourcesPage,
  PullRequestsIssuesPage,
  RepositoriesPage,
} from "@/components/dashboard/operational-pages";
import { SectionPage } from "@/components/dashboard/section-page";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";
import { navigationItems, sectionContent } from "@/lib/navigation";

export function generateStaticParams() {
  return navigationItems.filter((item) => item.href !== "/").map((item) => ({ section: item.href.slice(1) }));
}

export default async function SectionRoute({
  params,
}: Readonly<{ params: Promise<{ section: string }> }>) {
  const { section } = await params;
  const content = sectionContent[section];

  if (!content) {
    notFound();
  }

  if (section === "repositories" || section === "activity" || section === "pull-requests-issues" || section === "build-ci-health" || section === "data-sources") {
    const snapshot = await getDashboardSnapshot();
    if (section === "repositories") return <RepositoriesPage snapshot={snapshot} />;
    if (section === "activity") return <ActivityPage snapshot={snapshot} />;
    if (section === "pull-requests-issues") return <PullRequestsIssuesPage snapshot={snapshot} />;
    if (section === "build-ci-health") return <BuildCIHealthPage snapshot={snapshot} />;
    return <DataSourcesPage snapshot={snapshot} />;
  }

  return <SectionPage content={content} />;
}
