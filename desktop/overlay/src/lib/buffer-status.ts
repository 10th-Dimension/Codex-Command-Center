import type { TelemetryBufferHealth } from "../../../../src/lib/overlay/contracts";

export function telemetryBufferStatus(buffer: TelemetryBufferHealth) {
  const state = buffer.replayState === "degraded" ? "degraded" : buffer.replayState === "replaying" ? "replaying" : buffer.queuedBatches ? "buffering" : "connected";
  const delivery = state === "degraded" ? "degraded" : state === "replaying" ? "replaying" : state === "buffering" ? "buffered" : "live";
  const history = buffer.droppedBatches ? ` · ${buffer.droppedBatches} dropped historically` : "";
  const label = `OTel delivery ${delivery}${buffer.queuedBatches ? ` · ${buffer.queuedBatches} queued` : ""}${history}`;
  const title = `${buffer.queuedBatches} queued batch${buffer.queuedBatches === 1 ? "" : "es"}${buffer.oldestQueuedAgeSeconds === undefined ? "" : ` · oldest ${buffer.oldestQueuedAgeSeconds}s`}${history}${buffer.droppedBatches ? " · Cumulative saved batch count; loss dates and causes are unavailable. History may be incomplete." : ""}`;
  return { state, label, title };
}
