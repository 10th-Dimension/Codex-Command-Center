import test from "node:test";
import assert from "node:assert/strict";

import { calculateCodexEquivalentPricing, resolveCodexPricingRate } from "../src/lib/telemetry/pricing";

const available = (value: number) => ({ availability: "available" as const, value, sampleCount: 1 });

test("pricing resolves model aliases and leaves reasoning effort out of the rate key", () => {
  assert.equal(resolveCodexPricingRate("gpt-6-sol-xhigh")?.model, "gpt-6-sol");
  assert.equal(resolveCodexPricingRate("6-luna-high")?.model, "gpt-6-luna");
  assert.equal(resolveCodexPricingRate("gpt-5.6-sol-high")?.model, "gpt-5.6-sol");
  assert.equal(resolveCodexPricingRate("5.6-luna")?.displayName, "GPT-5.6 Luna");
  assert.equal(resolveCodexPricingRate("future-model"), undefined);
});

test("GPT-6 Sol and Luna use published standard USD rates and disclosed credit equivalents", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: { inputTokens: available(1_100_000), cachedTokens: available(200_000), outputTokens: available(150_000) },
    models: [
      { model: "gpt-6-sol", inputTokens: 1_000_000, cachedInputTokens: 100_000, outputTokens: 100_000 },
      { model: "gpt-6-luna", inputTokens: 100_000, cachedInputTokens: 100_000, outputTokens: 50_000 },
    ],
  });
  assert.equal(result.status, "available");
  assert.equal(result.usdEquivalent, "3.056");
  assert.equal(result.apiCredits, "76.4");
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.byModel[0].usdEquivalent, "3.02");
  assert.equal(result.byModel[0].apiCredits, "75.5");
  assert.equal(result.byModel[1].usdEquivalent, "0.036");
  assert.equal(result.byModel[1].apiCredits, "0.9");
  assert.match(result.note, /Codex credits are API-equivalent estimates/);
});

test("pricing uses one blended total across models with exact token-rate math", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: { inputTokens: available(3_000_000), cachedTokens: available(1_000_000), outputTokens: available(500_000) },
    models: [
      { model: "gpt-5.6-sol", eventCount: 4, inputTokens: 2_000_000, cachedInputTokens: 500_000, outputTokens: 400_000 },
      { model: "gpt-5.6-luna", eventCount: 2, inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 },
    ],
  });
  assert.equal(result.status, "available");
  assert.equal(result.apiCredits, "413.25");
  assert.equal(result.usdEquivalent, "16.53");
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.pricedModelCount, 2);
  assert.equal(result.unpricedModelCount, 0);
});

test("reasoning tokens are treated as an output breakdown and never charged twice", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: { inputTokens: available(0), cachedTokens: available(0), outputTokens: available(10) },
    models: [{ model: "gpt-5.6-luna", inputTokens: 0, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 6 }],
  });
  assert.equal(result.apiCredits, "0.0003");
  assert.equal(result.usdEquivalent, "0.000012");
});

test("unknown models stay visible and produce partial coverage instead of a fabricated zero", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: { inputTokens: available(2_000_000), cachedTokens: available(0), outputTokens: available(0) },
    models: [
      { model: "gpt-5.6-luna", inputTokens: 1_000_000 },
      { model: "gpt-5.3-codex-spark", inputTokens: 1_000_000 },
    ],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.apiCredits, "5");
  assert.equal(result.usdEquivalent, "0.2");
  assert.equal(result.pricedTokenCount, 1_000_000);
  assert.equal(result.unpricedTokenCount, 1_000_000);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.byModel[1].status, "unpriced");
});
