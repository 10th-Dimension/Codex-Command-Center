import { getPlatformIntelligenceStore } from "@/lib/platform/cloudflare";
import { readPlatformIntelligence, refreshPlatformIntelligence } from "@/lib/platform/intelligence";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export async function GET() {
  const store = await getPlatformIntelligenceStore();
  if (!store) return Response.json({ available: false, reason: "storage_unavailable" }, { status: 503, headers: privateHeaders });

  let snapshot = await readPlatformIntelligence(store);
  if (!snapshot) snapshot = await refreshPlatformIntelligence(store);
  return Response.json({ available: true, snapshot }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ available: false, reason: "same_origin_required" }, { status: 403, headers: privateHeaders });
  }

  const store = await getPlatformIntelligenceStore();
  if (!store) return Response.json({ available: false, reason: "storage_unavailable" }, { status: 503, headers: privateHeaders });

  const snapshot = await refreshPlatformIntelligence(store);
  return Response.json({ available: true, snapshot }, { headers: privateHeaders });
}
