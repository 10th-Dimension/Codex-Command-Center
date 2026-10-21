declare module "cloudflare:workers" {
  import type { D1DatabaseLike } from "@/lib/telemetry/database";
  import type { PlatformIntelligenceStore } from "@/lib/platform/intelligence";

  export const env: {
    CODEX_TELEMETRY_DB?: D1DatabaseLike;
    CODEX_TELEMETRY_INGEST_KEY?: string;
    CODEX_TELEMETRY_RETENTION_DAYS?: string;
    PLATFORM_INTELLIGENCE?: PlatformIntelligenceStore;
  };
}
