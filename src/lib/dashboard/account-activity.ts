import type { CodexAccountActivity } from "@/lib/overlay/contracts";

export type AccountActivityRange = 7 | 30;

export function accountActivityBuckets(activity: CodexAccountActivity | undefined, range: AccountActivityRange) {
  return activity?.dailyUsageBuckets?.slice(-range) ?? [];
}

export function accountActivitySummary(buckets: ReadonlyArray<{ startDate: string; tokens: number }>) {
  const totalTokens = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  const activeDays = buckets.filter((bucket) => bucket.tokens > 0).length;
  const peak = buckets.reduce<{ startDate: string; tokens: number } | undefined>((current, bucket) => {
    if (!current || bucket.tokens > current.tokens) return bucket;
    return current;
  }, undefined);
  return { totalTokens, activeDays, peak };
}

export function formatBackendDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function formatAccountSeconds(seconds: number | undefined) {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
