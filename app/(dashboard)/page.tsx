import { CodexCommandPage } from "@/components/dashboard/command-pages";
import { parseDashboardRange } from "@/lib/dashboard/analytics";
import { getCodexPageData } from "@/lib/dashboard/queries";

export default async function CodexPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const range = parseDashboardRange(query.range);
  const section = typeof query.section === "string" ? query.section : undefined;
  const includeForensics = query.forensics === "1" && section === "forensics";
  return <CodexCommandPage data={await getCodexPageData(range, includeForensics)} section={section} />;
}
