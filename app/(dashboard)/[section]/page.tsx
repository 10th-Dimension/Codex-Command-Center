import { notFound } from "next/navigation";

import { SectionPage } from "@/components/dashboard/section-page";
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

  return <SectionPage content={content} />;
}
