import assert from "node:assert/strict";
import test from "node:test";

import { prepareOverlayTrend } from "../desktop/overlay/src/lib/trend";

test("24-hour overlay displays every ten-minute interval without combining measured fields", () => {
  const asOf = "2026-09-25T12:34:00.000Z";
  const first = Date.parse("2026-09-24T12:40:00.000Z");
  const source = Array.from({ length: 144 }, (_, index) => index).filter((index) => index % 7 !== 0).map((index) => ({
    label: new Date(first + index * 600_000).toISOString(),
    inputTokens: index === 50 ? 100 : 10,
    cachedTokens: index === 50 ? 90 : 5,
    outputTokens: 2,
  }));
  const display = prepareOverlayTrend(source, "24h", asOf);

  assert.equal(display.points.length, 144);
  assert.equal(display.observedBuckets, source.length);
  assert.equal(display.intervalLabel, "10-minute buckets · local time");
  assert.equal(display.points[50].label, source.find((point) => point.inputTokens === 100)?.label);
  assert.equal(display.points[48].inputTokens, 10);
  assert.equal(display.points[48].cachedTokens, 5);
  assert.equal(display.points[49].observed, false);
  assert.equal(display.points[0].observed, false);
  assert.equal(display.points[0].inputTokens, undefined);
  assert.equal(display.points.reduce((total, point) => total + (point.inputTokens ?? 0), 0), source.reduce((total, point) => total + point.inputTokens, 0));
});

test("longer overlay ranges retain the server's UTC-day resolution", () => {
  const source = [{ label: "2026-09-24", inputTokens: 42 }];
  const weekly = prepareOverlayTrend(source, "7d", "2026-09-25T12:34:00.000Z");
  const monthly = prepareOverlayTrend(source, "30d", "2026-09-25T12:34:00.000Z");

  assert.equal(weekly.points.length, 8);
  assert.equal(monthly.points.length, 31);
  assert.equal(weekly.intervalLabel, "UTC-day buckets");
  assert.equal(weekly.points.find((point) => point.label === "2026-09-24")?.inputTokens, 42);
  assert.equal(weekly.observedBuckets, 1);
  assert.equal(monthly.observedBuckets, 1);
});
