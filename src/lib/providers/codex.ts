import "server-only";

import { createCodexTelemetryProvider } from "@/lib/providers/codex-core";
import { getTelemetryRuntimeBindings } from "@/lib/telemetry/cloudflare";

export const realCodexTelemetryProvider = createCodexTelemetryProvider({
  getRuntime: getTelemetryRuntimeBindings,
});
