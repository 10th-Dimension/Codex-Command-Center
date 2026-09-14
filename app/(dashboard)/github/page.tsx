import { GitHubCommandPage } from "@/components/dashboard/command-pages";
import { getGitHubPageData } from "@/lib/dashboard/queries";

export default async function GitHubPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const section = typeof query.section === "string" ? query.section : undefined;
  return <GitHubCommandPage data={await getGitHubPageData()} section={section} />;
}
