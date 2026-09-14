import { OverlayView } from "@/components/overlay/overlay-view";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";
import { composeOverlaySnapshot } from "@/lib/overlay/view-model";

export const dynamic = "force-dynamic";

export default async function OverlayPage() {
  const snapshot = await getDashboardSnapshot();
  return <OverlayView initialSnapshot={composeOverlaySnapshot(snapshot, "24h")} />;
}
