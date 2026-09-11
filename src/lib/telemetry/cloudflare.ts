import "server-only";

import type { D1DatabaseLike } from "@/lib/telemetry/database";

export const DEFAULT_TELEMETRY_RETENTION_DAYS = 30;

export interface TelemetryRuntimeBindings {
  database?: D1DatabaseLike;
  ingestKey?: string;
  retentionDays: number;
}

function retentionDays(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : DEFAULT_TELEMETRY_RETENTION_DAYS;
}

export async function getTelemetryRuntimeBindings(): Promise<TelemetryRuntimeBindings> {
  let runtimeEnv: typeof import("cloudflare:workers")["env"] | undefined;
  try {
    const moduleSpecifier = "cloudflare:workers";
    runtimeEnv = (await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleSpecifier)).env;
  } catch {
    runtimeEnv = undefined;
  }
  return {
    database: runtimeEnv?.CODEX_TELEMETRY_DB,
    ingestKey: runtimeEnv?.CODEX_TELEMETRY_INGEST_KEY,
    retentionDays: retentionDays(runtimeEnv?.CODEX_TELEMETRY_RETENTION_DAYS),
  };
}
