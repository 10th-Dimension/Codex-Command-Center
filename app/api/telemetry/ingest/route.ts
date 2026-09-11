import { getTelemetryRuntimeBindings } from "@/lib/telemetry/cloudflare";
import { handleTelemetryIngest } from "@/lib/telemetry/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleTelemetryIngest(request, await getTelemetryRuntimeBindings());
}
