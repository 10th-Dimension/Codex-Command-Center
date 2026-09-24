import test from "node:test";
import assert from "node:assert/strict";

import { calculateCodexEquivalentPricing, CODEX_MODEL_PRICING, resolveCodexPricingRate } from "../src/lib/telemetry/pricing";

const available = (value: number) => ({ availability: "available" as const, value, sampleCount: 1 });
const noSamples = { availability: "no-samples" as const, sampleCount: 0 };

function modelUsage(model: string, values: { input?: number; cached?: number; write?: number; output?: number; reasoning?: number } = {}) {
  const input = values.input ?? 0;
  const cached = values.cached ?? 0;
  const write = values.write ?? 0;
  const output = values.output ?? 0;
  return {
    model,
    eventCount: 1,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: write,
    outputTokens: output,
    reasoningTokens: values.reasoning ?? 0,
    priceableInputTokens: input,
    priceableCachedInputTokens: cached,
    priceableCacheWriteInputTokens: write,
    priceableOutputTokens: output,
    priceableSampleCount: 1,
  };
}

function metrics(input: number, cached: number, output: number, write = 0) {
  return {
    inputTokens: available(input),
    cachedTokens: available(cached),
    cacheWriteTokens: available(write),
    outputTokens: available(output),
  };
}

test("pricing resolves model aliases and strips reasoning-effort suffixes", () => {
  assert.equal(resolveCodexPricingRate("gpt-6-sol-xhigh")?.model, "gpt-6-sol");
  assert.equal(resolveCodexPricingRate("6-luna-high")?.model, "gpt-6-luna");
  assert.equal(resolveCodexPricingRate("gpt-5.6-sol-high")?.model, "gpt-5.6-sol");
  assert.equal(resolveCodexPricingRate("5.6-luna")?.displayName, "GPT-5.6 Luna");
  assert.equal(resolveCodexPricingRate("future-model"), undefined);
});

test("fully observed supported-model tokens reach 100% coverage without adding cached or reasoning tokens twice", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000_000, 200_000, 150_000, 100_000),
    models: [modelUsage("gpt-6-sol", { input: 1_000_000, cached: 200_000, write: 100_000, output: 150_000, reasoning: 60_000 })],
  });
  assert.equal(result.status, "available");
  assert.equal(result.observedTokenCount, 1_150_000);
  assert.equal(result.modelAttributedTokenCount, 1_150_000);
  assert.equal(result.pricedTokenCount, 1_150_000);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.byModel[0].reasoningTokens, 60_000);
  assert.equal(result.usdEquivalent, "3.19");
  assert.equal(result.apiCredits, "73.5");
});

test("GPT-6 Sol/Luna use published standard API prices and official Work/Codex credits", () => {
  const sol = CODEX_MODEL_PRICING.find((item) => item.model === "gpt-6-sol");
  const luna = CODEX_MODEL_PRICING.find((item) => item.model === "gpt-6-luna");
  assert.deepEqual([sol?.inputCreditsPerMillion, sol?.cachedInputCreditsPerMillion, sol?.outputCreditsPerMillion], [50, 5, 250]);
  assert.deepEqual([luna?.inputCreditsPerMillion, luna?.cachedInputCreditsPerMillion, luna?.outputCreditsPerMillion], [2.5, 0.25, 12.5]);
  assert.doesNotMatch(sol?.model ?? "", /estimate/i);
});

test("cached input is a subset of input and is charged only at the cached-input rate", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000_000, 200_000, 0),
    models: [modelUsage("gpt-6-sol", { input: 1_000_000, cached: 200_000 })],
  });
  assert.equal(result.observedTokenCount, 1_000_000);
  assert.equal(result.pricedTokenCount, 1_000_000);
  assert.equal(result.usdEquivalent, "1.64");
  assert.equal(result.apiCredits, "41");
});

test("cache writes use the official API write price but are excluded from Codex credit charges", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000_000, 0, 0, 1_000_000),
    models: [modelUsage("gpt-6-sol", { input: 1_000_000, write: 1_000_000 })],
  });
  assert.equal(result.usdEquivalent, "2.5");
  assert.equal(result.apiCredits, "0");
  assert.equal(result.coveragePercent, 100);
});

test("pre-GPT-5.6 cache writes use the documented ordinary-input API rate", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000_000, 0, 0, 1_000_000),
    models: [modelUsage("gpt-5.5", { input: 1_000_000, write: 1_000_000 })],
  });
  assert.equal(result.usdEquivalent, "5");
  assert.equal(result.apiCredits, "0");
});

test("reasoning tokens remain an output breakdown and are never charged or counted twice", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(0, 0, 10),
    models: [modelUsage("gpt-5.6-luna", { output: 10, reasoning: 6 })],
  });
  assert.equal(result.observedTokenCount, 10);
  assert.equal(result.pricedTokenCount, 10);
  assert.equal(result.usdEquivalent, "0.000012");
  assert.equal(result.apiCredits, "0.0003");
});

test("an unknown model remains visibly unpriced with an exact token count", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(2_000_000, 0, 0),
    models: [modelUsage("gpt-5.6-luna", { input: 1_000_000 }), modelUsage("gpt-5.3-codex-spark", { input: 1_000_000 })],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.usdEquivalent, "0.2");
  assert.equal(result.pricedTokenCount, 1_000_000);
  assert.equal(result.unpricedModelTokenCount, 1_000_000);
  assert.equal(result.unattributedTokenCount, 0);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.byModel[1].status, "unpriced");
});

test("model-less token usage stays unattributed and is not assigned from another model or session", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(2_000_000, 0, 0),
    models: [modelUsage("gpt-5.6-sol", { input: 1_000_000 })],
  });
  assert.equal(result.modelAttributedTokenCount, 1_000_000);
  assert.equal(result.unattributedTokenCount, 1_000_000);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.byModel.length, 1);
});

test("known model usage with historical token categories missing is explicitly incomplete", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(100, 0, 10),
    models: [{ model: "gpt-6-sol", inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 }],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.pricedTokenCount, 0);
  assert.equal(result.tokenFieldsUnavailableTokenCount, 110);
  assert.equal(result.byModel[0].status, "incomplete");
});

test("published Work credits without a public API USD rate do not invent a USD estimate", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000_000, 0, 0),
    models: [modelUsage("gpt-6-astra-law", { input: 1_000_000 })],
  });
  assert.equal(result.usdEquivalent, undefined);
  assert.equal(result.apiCredits, "312.5");
  assert.equal(result.unpricedModelTokenCount, 1_000_000);
  assert.equal(result.byModel[0].status, "unpriced");
  assert.match(result.byModel[0].reason ?? "", /API USD rate/);
});

test("cache-write and cached input exceeding total input are reported as an accounting mismatch", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(100, 80, 0, 40),
    models: [{
      ...modelUsage("gpt-6-sol", { input: 100, cached: 80, write: 40 }),
      priceableInputTokens: 0,
      priceableCachedInputTokens: 0,
      priceableCacheWriteInputTokens: 0,
      priceableOutputTokens: 0,
      priceableSampleCount: 0,
      categoryOverlapTokenCount: 20,
    }],
  });
  assert.equal(result.categoryOverlapTokenCount, 20);
  assert.equal(result.coveragePercent, 0);
  assert.equal(result.status, "partial");
});

test("model totals exceeding observed totals disable percentage coverage instead of clamping mismatch away", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(100, 0, 0),
    models: [modelUsage("gpt-6-sol", { input: 120 })],
    totalModelTokenCount: 120,
  });
  assert.equal(result.accountingMismatchTokenCount, 20);
  assert.equal(result.coveragePercent, undefined);
  assert.equal(result.status, "partial");
});

test("visible model rows exceeding the declared model total disable percentage coverage", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(200, 0, 0),
    models: [modelUsage("gpt-6-sol", { input: 120 })],
    totalModelTokenCount: 100,
  });
  assert.equal(result.accountingMismatchTokenCount, 20);
  assert.equal(result.coveragePercent, undefined);
  assert.equal(result.status, "partial");
});

test("model-list truncation has a separate, measurable token bucket", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(1_000, 0, 0),
    models: [modelUsage("gpt-6-sol", { input: 10 })],
    modelCount: 65,
    modelsTruncated: true,
    totalModelTokenCount: 65,
  });
  assert.equal(result.modelsTruncated, true);
  assert.equal(result.truncatedModelTokenCount, 55);
  assert.equal(result.unpricedTokenCount, 990);
  assert.equal(result.coveragePercent, 1);
});

test("zero-token samples are different from token fields with no samples", () => {
  const zero = calculateCodexEquivalentPricing({ metrics: metrics(0, 0, 0), models: [modelUsage("gpt-6-sol")] });
  const unavailable = calculateCodexEquivalentPricing({
    metrics: { inputTokens: noSamples, cachedTokens: noSamples, cacheWriteTokens: noSamples, outputTokens: noSamples },
    models: [],
  });
  assert.equal(zero.status, "available");
  assert.equal(zero.observedTokenCount, 0);
  assert.equal(zero.coveragePercent, undefined);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.observedTokenCount, undefined);
});

test("coverage stays bounded and incomplete categories remain visible", () => {
  const result = calculateCodexEquivalentPricing({
    metrics: metrics(100, 20, 20),
    models: [modelUsage("gpt-6-sol", { input: 100, cached: 20, output: 20 })],
  });
  assert.ok((result.coveragePercent ?? 0) <= 100);
  assert.equal(result.tokenFieldsUnavailableTokenCount, 0);
});

test("pricing disclosure preserves comparison semantics rather than claiming an actual balance or invoice", () => {
  const result = calculateCodexEquivalentPricing({ metrics: metrics(0, 0, 0), models: [] });
  assert.match(result.note, /Standard API USD and Work\/Codex credit token rates/);
  assert.match(result.note, /not an invoice or account balance/i);
});
