import { Overview } from "@/components/dashboard/overview";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";

export default async function OverviewPage() {
  const snapshot = await getDashboardSnapshot();

  return <Overview snapshot={snapshot} />;
}
