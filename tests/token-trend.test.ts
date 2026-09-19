import assert from "node:assert/strict";
import test from "node:test";

import { stackTokenSeries } from "../src/lib/telemetry/stacked-token-series";
import { tokenCompositionSegments, tokenVisualColors } from "../src/lib/telemetry/token-visuals";

const series = [
  { id: "input", key: "input" as const, label: "Input", color: "#68d8e8" },
  { id: "output", key: "output" as const, label: "Output", color: "#a78bfa" },
  { id: "reasoning", key: "reasoning" as const, label: "Reasoning", color: "#f4b860" },
];

test("stacked token geometry keeps each band equal to its own field", () => {
  const points = [{ input: 100, output: 10, reasoning: 1 }];
  const stacked = stackTokenSeries(points, series, (point, key) => point[key]);

  assert.deepEqual(stacked.map(({ base, topValues }) => ({ base: base[0], top: topValues[0] })), [
    { base: 0, top: 100 },
    { base: 100, top: 110 },
    { base: 110, top: 111 },
  ]);
  assert.equal(stacked[2].topValues[0] - stacked[2].base[0], 1);
});

test("invalid and negative token values do not create phantom chart area", () => {
  const points = [{ input: Number.NaN, output: -10, reasoning: undefined }];
  const stacked = stackTokenSeries(points, series, (point, key) => point[key]);

  assert.deepEqual(stacked.map(({ base, topValues }) => [base[0], topValues[0]]), [[0, 0], [0, 0], [0, 0]]);
});

test("composition widths use exact positive field ratios without a minimum-width distortion", () => {
  const { total, items } = tokenCompositionSegments([
    { id: "input", value: 100 },
    { id: "cached", value: 1 },
    { id: "reasoning", value: 0 },
    { id: "invalid", value: Number.NaN },
  ]);

  assert.equal(total, 101);
  assert.equal(items.find((item) => item.id === "input")?.fraction, 100 / 101);
  assert.equal(items.find((item) => item.id === "cached")?.fraction, 1 / 101);
  assert.equal(items.find((item) => item.id === "reasoning")?.fraction, 0);
  assert.equal(items.find((item) => item.id === "invalid")?.fraction, 0);
});

test("shared token colors are bright and distinct for the composition legend", () => {
  assert.notEqual(tokenVisualColors.input, tokenVisualColors.cached);
  assert.notEqual(tokenVisualColors.cached, tokenVisualColors.reasoning);
  assert.match(tokenVisualColors.input, /^#[0-9a-f]{6}$/i);
  assert.match(tokenVisualColors.cached, /^#[0-9a-f]{6}$/i);
});
