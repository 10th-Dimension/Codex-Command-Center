import handler from "vinext/server/fetch-handler";
import { refreshPlatformIntelligence, type PlatformIntelligenceStore } from "@/lib/platform/intelligence";

interface WorkerEnvironment {
  PLATFORM_INTELLIGENCE?: PlatformIntelligenceStore;
}

interface ScheduledContext {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  fetch(request: Request, env: WorkerEnvironment, context: unknown) {
    return handler.fetch(request, env, context);
  },

  scheduled(_controller: unknown, env: WorkerEnvironment, context: ScheduledContext) {
    if (!env.PLATFORM_INTELLIGENCE) return;
    context.waitUntil(refreshPlatformIntelligence(env.PLATFORM_INTELLIGENCE));
  },
};

export default worker;
