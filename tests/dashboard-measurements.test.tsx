import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TokenComposition, TokenTrend, activityTooltipText, validTokenValue } from "../src/components/dashboard/analytics-ui";
import type { CodexUsageSnapshot, DataResult } from "../src/lib/providers/types";

const usage: CodexUsageSnapshot = {
  window: "24h",
  capturedAt: "2026-10-30T12:00:00Z",
  eventsWithUsage: 7,
  sessionsWithUsage: 1,
  modelsWithUsage: 1,
  inputTokens: { availability: "available", value: 1000, sampleCount: 7 },
  cachedInputTokens: { availability: "available", value: 800, sampleCount: 3 },
  outputTokens: { availability: "available", value: 100, sampleCount: 7 },
  reasoningTokens: { availability: "available", value: 80, sampleCount: 2 },
  toolTokens: { availability: "available", value: 0, sampleCount: 1 },
  cacheWriteTokens: { availability: "no-samples", sampleCount: 0 },
};
const connected = <T,>(data: T): DataResult<T> => ({ status: "connected", source: "codex", data });

test("overlapping fields render independently with their sample counts and no invented total", () => {
  const html = renderToStaticMarkup(<TokenComposition result={connected(usage)} />);
  assert.match(html, /1,000/);
  assert.match(html, /800/);
  assert.match(html, /3<!-- --> samples|3 samples/);
  assert.match(html, /2<!-- --> samples|2 samples/);
  assert.match(html, /<b>0<\/b>/);
  assert.match(html, /No samples/);
  assert.match(html, /Fields may overlap/);
  assert.doesNotMatch(html, /1,980|composition-bar/);
});

test("unavailable and absent fields stay distinct from measured zero", () => {
  const html = renderToStaticMarkup(<TokenComposition result={connected({ ...usage, inputTokens: { availability: "unavailable", value: 900, sampleCount: 0 } })} />);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /<b>900<\/b>/);
  assert.equal(validTokenValue(0), 0);
  for (const value of [undefined, NaN, Infinity, -1]) assert.equal(validTokenValue(value), undefined);
});

test("chart renders one input field without adding cached or reasoning fields; zero has a mark and missing has none", () => {
  const html = renderToStaticMarkup(<TokenTrend result={connected([
    { label: "2026-10-30T01:00:00Z", events: 1, errors: 0, toolExecutions: 0, inputTokens: 1000, cachedTokens: 800, reasoningTokens: 80 },
    { label: "2026-10-30T01:10:00Z", events: 1, errors: 0, toolExecutions: 0, inputTokens: 0 },
    { label: "2026-10-30T02:00:00Z", events: 1, errors: 0, toolExecutions: 0, outputTokens: 200 },
  ])} />);
  assert.equal((html.match(/class="token-observation"/g) ?? []).length, 2);
  assert.match(html, /1,000 input tokens/);
  assert.match(html, /0 input tokens/);
  assert.doesNotMatch(html, /1,880|Total measured tokens|token-series-area/);
});

test("measured zero chart is not described as having no samples", () => {
  const html = renderToStaticMarkup(<TokenTrend result={connected([{ label: "2026-10-30T01:00:00Z", events: 1, errors: 0, toolExecutions: 0, inputTokens: 0 }])} />);
  assert.match(html, /0 input tokens/);
  assert.doesNotMatch(html, /No input measurements|No token samples/);
});

test("activity tooltip lists individual fields without summing potential overlaps", () => {
  const tooltip = activityTooltipText({ label: "2026-10-30T01:00:00Z", events: 1, errors: 0, toolExecutions: 0, inputTokens: 1000, cachedTokens: 800 });
  assert.match(tooltip, /Input 1,000/);
  assert.match(tooltip, /Cached 800/);
  assert.doesNotMatch(tooltip, /1,800|measured tokens/);
});
