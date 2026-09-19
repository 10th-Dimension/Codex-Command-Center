/**
 * The token-based Work/Codex credit card is separate from a live account
 * balance. These values let the dashboard answer "what would this usage have
 * cost at the published token rates?" without pretending to know the user's
 * remaining balance or plan entitlements.
 */
export const CODEX_PRICING_CARD_ID = "openai-work-codex-token-rates-2026-09";
export const CODEX_PRICING_BASIS = "codex-token-credit-rates" as const;
export const CODEX_PRICING_NOTE = "Standard token rates only. Reasoning is an output-token breakdown; cache writes and separately metered feature charges are excluded.";

export interface CodexModelPricingRate {
  model: string;
  displayName: string;
  aliases: readonly string[];
  inputCreditsPerMillion: number;
  cachedInputCreditsPerMillion: number;
  outputCreditsPerMillion: number;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/** Published token-based Work/Codex rates as of the current rate-card revision. */
export const CODEX_MODEL_PRICING: readonly CodexModelPricingRate[] = [
  rate("gpt-6-astra", "GPT-6 Astra", ["gpt-6-astra", "6-astra", "astra", "gpt-6-pro"], 250, 25, 1250, 10, 1, 50),
  rate("gpt-5.6-sol", "GPT-5.6 Sol", ["gpt-5.6-sol", "5.6-sol", "sol"], 100, 10, 500, 4, 0.4, 20),
  rate("gpt-5.6-terra", "GPT-5.6 Terra", ["gpt-5.6-terra", "5.6-terra", "terra"], 50, 5, 300, 2, 0.2, 12),
  rate("gpt-5.6-luna", "GPT-5.6 Luna", ["gpt-5.6-luna", "5.6-luna", "luna"], 5, 0.5, 30, 0.2, 0.02, 1.2),
  rate("gpt-rosalind-research", "GPT-Rosalind-Research", ["gpt-rosalind-research", "rosalind-research"], 125, 12.5, 625, 5, 0.5, 25),
  rate("gpt-5.5", "GPT-5.5", ["gpt-5.5", "5.5"], 125, 12.5, 750, 5, 0.5, 30),
  rate("daybreak-blue", "Daybreak Blue", ["daybreak-blue"], 100, 10, 500, 4, 0.4, 20),
  rate("daybreak-red", "Daybreak Red", ["daybreak-red"], 312.5, 31.25, 1875, 12.5, 1.25, 75),
  rate("gpt-5.4", "GPT-5.4", ["gpt-5.4", "5.4"], 62.5, 6.25, 375, 2.5, 0.25, 15),
  rate("gpt-5.4-mini", "GPT-5.4 Mini", ["gpt-5.4-mini", "5.4-mini", "gpt-5.4-mini-codex"], 18.75, 1.875, 113, 0.75, 0.075, 4.5),
  rate("gpt-5.3-codex", "GPT-5.3-Codex", ["gpt-5.3-codex", "5.3-codex"], 43.75, 4.375, 350, 1.75, 0.175, 14),
  rate("gpt-5.2", "GPT-5.2", ["gpt-5.2", "5.2"], 43.75, 4.375, 350, 1.75, 0.175, 14),
  rate("gpt-6-astra-law", "GPT-6 Astra Law", ["gpt-6-astra-law", "astra-law"], 312.5, 31.25, 1562.5, 12.5, 1.25, 62.5),
];

export type CodexPricingStatus = "available" | "partial" | "unavailable";

export interface CodexPricingModelUsage {
  model: string;
  eventCount?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  toolTokens?: number | null;
}

export interface CodexEquivalentModelCost {
  model: string;
  displayName: string;
  status: "priced" | "unpriced";
  reason?: string;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  apiCredits?: string;
  usdEquivalent?: string;
}

export interface CodexEquivalentPricing {
  status: CodexPricingStatus;
  basis: typeof CODEX_PRICING_BASIS;
  rateCardId: string;
  featureChargesIncluded: false;
  apiCredits?: string;
  usdEquivalent?: string;
  observedTokenCount?: number;
  pricedTokenCount: number;
  unpricedTokenCount?: number;
  coveragePercent?: number;
  modelCount: number;
  pricedModelCount: number;
  unpricedModelCount: number;
  modelsTruncated: boolean;
  byModel: CodexEquivalentModelCost[];
  note: string;
}

interface PricingMeasuredValue {
  availability: "available" | "unavailable" | "no-samples";
  value?: number;
}

interface PricingSummaryMetrics {
  inputTokens: PricingMeasuredValue;
  cachedTokens: PricingMeasuredValue;
  outputTokens: PricingMeasuredValue;
}

interface FixedRate {
  input: bigint;
  cached: bigint;
  output: bigint;
}

const MICRO_UNITS = 1_000_000n;
const MILLION_TOKENS = 1_000_000n;
const effortSuffix = /-(?:light|low|medium|high|extra-high|extra-high|max|ultra|xhigh)$/;

function rate(
  model: string,
  displayName: string,
  aliases: readonly string[],
  inputCreditsPerMillion: number,
  cachedInputCreditsPerMillion: number,
  outputCreditsPerMillion: number,
  inputUsdPerMillion: number,
  cachedInputUsdPerMillion: number,
  outputUsdPerMillion: number,
): CodexModelPricingRate {
  return { model, displayName, aliases, inputCreditsPerMillion, cachedInputCreditsPerMillion, outputCreditsPerMillion, inputUsdPerMillion, cachedInputUsdPerMillion, outputUsdPerMillion };
}

function canonicalModel(value: string) {
  return value.trim().toLowerCase().replace(/^openai[/:]/, "").replace(/[\s_]+/g, "-").replace(/--+/g, "-");
}

const pricingByAlias = new Map<string, CodexModelPricingRate>(CODEX_MODEL_PRICING.flatMap((item) => item.aliases.map((alias) => [canonicalModel(alias), item] as const)));

export function resolveCodexPricingRate(model: string | undefined) {
  if (!model) return undefined;
  const canonical = canonicalModel(model);
  return pricingByAlias.get(canonical) ?? pricingByAlias.get(canonical.replace(effortSuffix, ""));
}

function tokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function metricValue(value: PricingMeasuredValue) {
  if (value.availability === "available") return tokenCount(value.value);
  if (value.availability === "no-samples") return 0;
  return undefined;
}

function fixedRate(value: number) {
  return BigInt(Math.round(value * Number(MICRO_UNITS)));
}

function fixedRates(rateValue: CodexModelPricingRate, kind: "credits" | "usd"): FixedRate {
  return kind === "credits"
    ? { input: fixedRate(rateValue.inputCreditsPerMillion), cached: fixedRate(rateValue.cachedInputCreditsPerMillion), output: fixedRate(rateValue.outputCreditsPerMillion) }
    : { input: fixedRate(rateValue.inputUsdPerMillion), cached: fixedRate(rateValue.cachedInputUsdPerMillion), output: fixedRate(rateValue.outputUsdPerMillion) };
}

function charge(tokens: { input: number; cached: number; output: number }, rates: FixedRate) {
  const numerator = BigInt(tokens.input) * rates.input + BigInt(tokens.cached) * rates.cached + BigInt(tokens.output) * rates.output;
  return (numerator + MILLION_TOKENS / 2n) / MILLION_TOKENS;
}

function decimal(value: bigint | undefined) {
  if (value === undefined) return undefined;
  const whole = value / MICRO_UNITS;
  const fraction = (value % MICRO_UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sumTokenFields(model: CodexPricingModelUsage) {
  const input = tokenCount(model.inputTokens);
  const cached = tokenCount(model.cachedInputTokens);
  const output = tokenCount(model.outputTokens);
  // reasoning_tokens is a breakdown of output_tokens in the API usage model.
  // It is kept for inspection but is never added a second time.
  const reasoning = tokenCount(model.reasoningTokens);
  return { input, cached, output, reasoning, billableOutput: output || reasoning };
}

function measuredTotal(metrics: PricingSummaryMetrics) {
  const input = metricValue(metrics.inputTokens);
  const cached = metricValue(metrics.cachedTokens);
  const output = metricValue(metrics.outputTokens);
  if (input === undefined && cached === undefined && output === undefined) return undefined;
  return { input: input ?? 0, cached: cached ?? 0, output: output ?? 0, complete: input !== undefined && cached !== undefined && output !== undefined };
}

export function calculateCodexEquivalentPricing({
  metrics,
  models,
  modelsTruncated = false,
  modelCount,
}: {
  metrics: PricingSummaryMetrics;
  models: readonly CodexPricingModelUsage[];
  modelsTruncated?: boolean;
  modelCount?: number;
}): CodexEquivalentPricing {
  const total = measuredTotal(metrics);
  let pricedCredits = 0n;
  let pricedUsd = 0n;
  let pricedTokenCount = 0;
  let modelTokenCount = 0;
  let pricedModelCount = 0;
  let unpricedModelCount = 0;
  const totalModelCount = Math.max(models.length, typeof modelCount === "number" && Number.isFinite(modelCount) ? Math.trunc(modelCount) : models.length);
  const hasModelTruncation = modelsTruncated || totalModelCount > models.length;
  const byModel = models.map((model) => {
    const usage = sumTokenFields(model);
    const rateValue = resolveCodexPricingRate(model.model);
    const eventCount = tokenCount(model.eventCount);
    const base = { model: model.model, displayName: rateValue?.displayName ?? model.model, eventCount, inputTokens: usage.input, cachedInputTokens: usage.cached, outputTokens: usage.output, reasoningTokens: usage.reasoning };
    modelTokenCount += usage.input + usage.cached + usage.billableOutput;
    if (!rateValue) {
      unpricedModelCount += 1;
      return { ...base, status: "unpriced" as const, reason: "No published token rate is available for this model." };
    }
    const tokens = { input: usage.input, cached: usage.cached, output: usage.billableOutput };
    pricedModelCount += 1;
    pricedTokenCount += usage.input + usage.cached + usage.billableOutput;
    pricedCredits += charge(tokens, fixedRates(rateValue, "credits"));
    pricedUsd += charge(tokens, fixedRates(rateValue, "usd"));
    return { ...base, status: "priced" as const, apiCredits: decimal(charge(tokens, fixedRates(rateValue, "credits"))), usdEquivalent: decimal(charge(tokens, fixedRates(rateValue, "usd"))) };
  });

  const observedTokenCount = total ? total.input + total.cached + total.output : modelTokenCount || undefined;
  const unpricedTokenCount = observedTokenCount === undefined ? undefined : Math.max(0, observedTokenCount - pricedTokenCount);
  const coveragePercent = observedTokenCount ? Math.min(100, Math.max(0, Number(((pricedTokenCount / observedTokenCount) * 100).toFixed(2)))) : undefined;
  const hasObservedTokens = observedTokenCount !== undefined && observedTokenCount > 0;
  const status: CodexPricingStatus = !hasObservedTokens
    ? "unavailable"
    : total?.complete && !hasModelTruncation && unpricedTokenCount === 0 && unpricedModelCount === 0
      ? "available"
      : "partial";
  const note = status === "unavailable"
    ? "No complete billable token samples are available for this window."
    : status === "partial"
      ? `${CODEX_PRICING_NOTE} Coverage is partial because some model or token fields are unavailable.`
      : CODEX_PRICING_NOTE;
  return {
    status,
    basis: CODEX_PRICING_BASIS,
    rateCardId: CODEX_PRICING_CARD_ID,
    featureChargesIncluded: false,
    apiCredits: hasObservedTokens ? decimal(pricedCredits) : undefined,
    usdEquivalent: hasObservedTokens ? decimal(pricedUsd) : undefined,
    observedTokenCount,
    pricedTokenCount,
    unpricedTokenCount,
    coveragePercent,
    modelCount: totalModelCount,
    pricedModelCount,
    unpricedModelCount: unpricedModelCount + Math.max(0, totalModelCount - models.length),
    modelsTruncated: hasModelTruncation,
    byModel,
    note,
  };
}
