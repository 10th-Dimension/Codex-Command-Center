import assert from "node:assert/strict";
import test from "node:test";
import { telemetryBufferStatus } from "../desktop/overlay/src/lib/buffer-status";
import type { TelemetryBufferHealth } from "../src/lib/overlay/contracts";

test("recovered delivery keeps historical loss visible without claiming a current failure", () => {
  const status = telemetryBufferStatus({ queuedBatches: 0, queuedBytes: 0, droppedBatches: 26211, replayState: "idle" });
  assert.equal(status.state, "connected");
  assert.equal(status.label, "OTel delivery live · 26211 dropped historically");
  assert.match(status.title, /History may be incomplete/);
});

test("current failures, buffering and replay remain visible with or without historical drops", () => {
  for (const droppedBatches of [0, 26211]) {
    const base: TelemetryBufferHealth = { queuedBatches: 2, queuedBytes: 100, droppedBatches, replayState: "degraded" };
    assert.match(telemetryBufferStatus(base).label, /^OTel delivery degraded · 2 queued/);
    assert.equal(telemetryBufferStatus(base).state, "degraded");
    assert.equal(telemetryBufferStatus({ ...base, queuedBatches: 0 }).state, "degraded");
    assert.match(telemetryBufferStatus({ ...base, replayState: "buffering" }).label, /^OTel delivery buffered/);
    assert.match(telemetryBufferStatus({ ...base, replayState: "replaying" }).label, /^OTel delivery replaying/);
  }
  assert.equal(telemetryBufferStatus({ queuedBatches: 0, queuedBytes: 0, droppedBatches: 0, replayState: "idle" }).label, "OTel delivery live");
});
