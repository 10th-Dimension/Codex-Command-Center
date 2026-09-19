import assert from "node:assert/strict";
import test from "node:test";

import { stackTokenSeries } from "../src/lib/telemetry/stacked-token-series";

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
