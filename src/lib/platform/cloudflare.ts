import "server-only";

import type { PlatformIntelligenceStore } from "@/lib/platform/intelligence";

export async function getPlatformIntelligenceStore(): Promise<PlatformIntelligenceStore | undefined> {
  let runtimeEnv: typeof import("cloudflare:workers")["env"] | undefined;
  try {
    const moduleSpecifier = "cloudflare:workers";
    runtimeEnv = (await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleSpecifier)).env;
  } catch {
    runtimeEnv = undefined;
  }
  return runtimeEnv?.PLATFORM_INTELLIGENCE;
}
