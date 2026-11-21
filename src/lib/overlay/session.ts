import type { CodexTelemetrySessionSummary } from "@/lib/providers/types";

/** Select from the bounded session summaries already in the snapshot. */
export function selectOverlaySession(sessions: readonly CodexTelemetrySessionSummary[]): CodexTelemetrySessionSummary | undefined {
  let latest: CodexTelemetrySessionSummary | undefined;
  let latestWithIdentity: CodexTelemetrySessionSummary | undefined;
  for (const session of sessions) {
    if (!latest || session.lastSeenAt > latest.lastSeenAt) latest = session;
    if (!session.models[0] && !session.reasoningEfforts[0]) continue;
    if (!latestWithIdentity || session.lastSeenAt > latestWithIdentity.lastSeenAt) latestWithIdentity = session;
  }
  return latestWithIdentity ?? latest;
}
