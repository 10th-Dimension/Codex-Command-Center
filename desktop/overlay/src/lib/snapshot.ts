import type { OverlaySnapshot } from "../../../../src/lib/overlay/contracts";

/**
 * D1/telemetry outages are returned as valid JSON envelopes so the UI can
 * render an honest unavailable state. They must not erase an already usable
 * snapshot for the same range during a transient poll failure.
 */
export function isUsableOverlaySnapshot(snapshot: OverlaySnapshot): boolean {
  return snapshot.health.telemetry === "connected" && snapshot.health.d1 === "connected";
}

export function shouldReplaceOverlaySnapshot(previous: OverlaySnapshot | undefined, next: OverlaySnapshot): boolean {
  if (!previous || previous.range !== next.range || !isUsableOverlaySnapshot(previous)) return true;
  return isUsableOverlaySnapshot(next);
}
