import { parseDashboardRange } from "@/lib/dashboard/analytics";
import { getOverlaySnapshot } from "@/lib/overlay/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const range = parseDashboardRange(new URL(request.url).searchParams.get("range"));
  const snapshot = await getOverlaySnapshot(range);
  return Response.json(snapshot, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
