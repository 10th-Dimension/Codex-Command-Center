/**
 * API-equivalent token estimates use published standard API USD rates and
 * published Work/Codex credit rates. They are comparisons, not account
 * balances or invoices.
 */
export const CODEX_PRICING_CARD_ID = "openai-api-and-codex-token-rates-2026-09-23";
export const CODEX_PRICING_BASIS = "codex-token-credit-rates" as const;
export const CODEX_PRICING_NOTE = "Codex auto-review activity is excluded from these estimates and coverage because it has no published per-token rate. Standard API USD and Work/Codex credit token rates only. Cache reads and writes are separate input subsets; Codex does not charge cache writes. Reasoning tokens are included in output and are not added again. Fast mode, long-context, regional-processing, and separately metered feature charges are excluded. Pricing compares matching complete hourly rollups, so the partial leading model hour is excluded. This is not an invoice or account balance.";

export interface CodexModelPricingRate {
  model: string;
  displayName: string;
  aliases: readonly string[];
  inputCreditsPerMillion: number;
  cachedInputCreditsPerMillion: number;
  outputCreditsPerMillion: number;
  inputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}

type CacheWriteUsdRule = "standard-input" | "premium-1.25x" | "unavailable";

/** Published token-based Work/Codex credits and standard API USD rates. */
export const CODEX_MODEL_PRICING: readonly CodexModelPricingRate[] = [
  rate("gpt-6-astra", "GPT-6 Astra", ["gpt-6-astra", "6-astra", "astra", "gpt-6-pro"], 250, 25, 1250, 10, 1, 50, "premium-1.25x"),
  rate("gpt-6-sol", "GPT-6 Sol", ["gpt-6-sol", "6-sol"], 50, 5, 250, 2, 0.2, 10, "premium-1.25x"),
  rate("gpt-6-luna", "GPT-6 Luna", ["gpt-6-luna", "6-luna"], 2.5, 0.25, 12.5, 0.1, 0.01, 0.5, "premium-1.25x"),
  rate("gpt-5.6-sol", "GPT-5.6 Sol", ["gpt-5.6-sol", "5.6-sol", "sol"], 100, 10, 500, 4, 0.4, 20, "premium-1.25x"),
  rate("gpt-5.6-terra", "GPT-5.6 Terra", ["gpt-5.6-terra", "5.6-terra", "terra"], 50, 5, 300, 2, 0.2, 12, "premium-1.25x"),
  rate("gpt-5.6-luna", "GPT-5.6 Luna", ["gpt-5.6-luna", "5.6-luna", "luna"], 5, 0.5, 30, 0.2, 0.02, 1.2, "premium-1.25x"),
  rate("gpt-rosalind-research", "GPT-Rosalind-Research", ["gpt-rosalind-research", "rosalind-research"], 125, 12.5, 625, 5, 0.5, 25, "standard-input"),
  rate("gpt-5.5", "GPT-5.5", ["gpt-5.5", "5.5"], 125, 12.5, 750, 5, 0.5, 30, "standard-input"),
  rate("daybreak-blue", "Daybreak Blue", ["daybreak-blue"], 100, 10, 500, 4, 0.4, 20, "premium-1.25x"),
  rate("daybreak-red", "Daybreak Red", ["daybreak-red"], 312.5, 31.25, 1875, 12.5, 1.25, 75, "premium-1.25x"),
  rate("gpt-5.4", "GPT-5.4", ["gpt-5.4", "5.4"], 62.5, 6.25, 375, 2.5, 0.25, 15, "standard-input"),
  rate("gpt-5.4-mini", "GPT-5.4 Mini", ["gpt-5.4-mini", "5.4-mini", "gpt-5.4-mini-codex"], 18.75, 1.875, 113, 0.75, 0.075, 4.5, "standard-input"),
  rate("gpt-5.3-codex", "GPT-5.3-Codex", ["gpt-5.3-codex", "5.3-codex"], 43.75, 4.375, 350, 1.75, 0.175, 14, "standard-input"),
  rate("gpt-5.2", "GPT-5.2", ["gpt-5.2", "5.2"], 43.75, 4.375, 350, 1.75, 0.175, 14, "standard-input"),
  // Astra for Law has a published Work/Codex credit rate but no public API USD rate.
  rate("gpt-6-astra-law", "GPT-6 Astra Law", ["gpt-6-astra-law", "astra-law"], 312.5, 31.25, 1562.5, undefined, undefined, undefined, "unavailable"),
];

export type CodexPricingStatus = "available" | "partial" | "unavailable";

export interface CodexPricingModelUsage {
  model: string;
  eventCount?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  toolTokens?: number | null;
  /** Totals only from events where every token category was emitted and valid. */
  priceableInputTokens?: number | null;
  priceableCachedInputTokens?: number | null;
  priceableCacheWriteInputTokens?: number | null;
  priceableOutputTokens?: number | null;
  priceableSampleCount?: number | null;
  categoryOverlapTokenCount?: number | null;
}

export interface CodexEquivalentModelCost {
  model: string;
  displayName: string;
  status: "priced" | "unpriced" | "incomplete";
  reason?: string;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  pricedTokenCount: number;
  apiCredits?: string;
  usdEquivalent?: string;
}

export function codexEquivalentModelPriceLabel(model: Pick<CodexEquivalentModelCost, "status" | "apiCredits" | "usdEquivalent">) {
  if (model.usdEquivalent !== undefined) {
    return model.status === "incomplete" ? `Partial $${model.usdEquivalent}` : `$${model.usdEquivalent}`;
  }
  if (model.apiCredits !== undefined) {
    return model.status === "incomplete" ? `Partial ${model.apiCredits} credits` : `${model.apiCredits} credits only`;
  }
  return model.status === "priced" ? "$—" : model.status === "incomplete" ? "Incomplete" : "Unpriced";
}

export interface CodexEquivalentPricing {
  status: CodexPricingStatus;
  basis: typeof CODEX_PRICING_BASIS;
  rateCardId: string;
  featureChargesIncluded: false;
  apiCredits?: string;
  usdEquivalent?: string;
  observedTokenCount?: number;
  modelAttributedTokenCount?: number;
  pricedTokenCount: number;
  unpricedTokenCount?: number;
  unpricedModelTokenCount: number;
  unattributedTokenCount?: number;
  tokenFieldsUnavailableTokenCount: number;
  truncatedModelTokenCount?: number;
  categoryOverlapTokenCount: number;
  accountingMismatchTokenCount: number;
  coveragePercent?: number;
  modelCount: number;
  pricedModelCount: number;
  unpricedModelCount: number;
  incompleteModelCount: number;
  modelsTruncated: boolean;
  byModel: CodexEquivalentModelCost[];
  note: string;
}

export function codexPricingCoverageReasons(pricing: CodexEquivalentPricing) {
  const reasons: string[] = [];
  const formatted = (count: number) => `${count.toLocaleString()} tokens`;
  if (pricing.unpricedModelTokenCount > 0) reasons.push(`Unpriced model usage: ${formatted(pricing.unpricedModelTokenCount)}.`);
  if ((pricing.unattributedTokenCount ?? 0) > 0) reasons.push(`Unattributed token usage: no trustworthy model was emitted for ${formatted(pricing.unattributedTokenCount ?? 0)}.`);
  if (pricing.tokenFieldsUnavailableTokenCount > 0) reasons.push(`Token fields unavailable: ${formatted(pricing.tokenFieldsUnavailableTokenCount)} could not be priced exactly.`);
  if ((pricing.truncatedModelTokenCount ?? 0) > 0) reasons.push(`Model details beyond the display limit: ${formatted(pricing.truncatedModelTokenCount ?? 0)}.`);
  if (pricing.categoryOverlapTokenCount > 0) reasons.push(`Overlapping input categories: ${formatted(pricing.categoryOverlapTokenCount)} were excluded from the estimate.`);
  if (pricing.accountingMismatchTokenCount > 0) reasons.push(`Inconsistent model totals: visible details disagree with model or observed totals by ${formatted(pricing.accountingMismatchTokenCount)}.`);
  if (pricing.observedTokenCount === undefined) reasons.push("Overall input/output token totals are unavailable.");
  return reasons;
}

interface PricingMeasuredValue {
  availability: "available" | "unavailable" | "no-samples";
  value?: number;
}

interface PricingSummaryMetrics {
  inputTokens: PricingMeasuredValue;
  cachedTokens: PricingMeasuredValue;
  cacheWriteTokens?: PricingMeasuredValue;
  outputTokens: PricingMeasuredValue;
}

interface FixedRate {
  input?: bigint;
  cached?: bigint;
  cacheWrite?: bigint;
  output?: bigint;
}

interface DisjointTokenCounts {
  ordinaryInput: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

const MICRO_UNITS = 1_000_000n;
const MILLION_TOKENS = 1_000_000n;
const effortSuffix = /-(?:light|low|medium|high|extra-high|extra-high|max|ultra|xhigh)$/;
const excludedEquivalentPricingModels = new Set(["codex-auto-review"]);

function rate(
  model: string,
  displayName: string,
  aliases: readonly string[],
  inputCreditsPerMillion: number,
  cachedInputCreditsPerMillion: number,
  outputCreditsPerMillion: number,
  inputUsdPerMillion: number | undefined,
  cachedInputUsdPerMillion: number | undefined,
  outputUsdPerMillion: number | undefined,
  cacheWriteRule: CacheWriteUsdRule,
): CodexModelPricingRate {
  const cacheWriteUsdPerMillion = inputUsdPerMillion === undefined || cacheWriteRule === "unavailable"
    ? undefined
    : inputUsdPerMillion * (cacheWriteRule === "premium-1.25x" ? 1.25 : 1);
  return { model, displayName, aliases, inputCreditsPerMillion, cachedInputCreditsPerMillion, outputCreditsPerMillion,
    inputUsdPerMillion, cachedInputUsdPerMillion, cacheWriteUsdPerMillion, outputUsdPerMillion };
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

function isExcludedFromEquivalentPricing(model: string) {
  return excludedEquivalentPricingModels.has(canonicalModel(model));
}

function tokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function metricValue(value: PricingMeasuredValue) {
  return value.availability === "available" ? tokenCount(value.value) : undefined;
}

function subtractObservedTokens(value: PricingMeasuredValue, tokensToSubtract: number): PricingMeasuredValue {
  if (tokensToSubtract === 0 || value.availability !== "available") return value;
  const observedTokens = metricValue(value);
  if (observedTokens === undefined || observedTokens < tokensToSubtract) return { availability: "unavailable" };
  return { ...value, value: observedTokens - tokensToSubtract };
}

function fixedRate(value: number | undefined) {
  return value === undefined ? undefined : BigInt(Math.round(value * Number(MICRO_UNITS)));
}

function fixedRates(rateValue: CodexModelPricingRate, kind: "credits" | "usd"): FixedRate {
  return kind === "credits"
    ? { input: fixedRate(rateValue.inputCreditsPerMillion), cached: fixedRate(rateValue.cachedInputCreditsPerMillion), cacheWrite: 0n, output: fixedRate(rateValue.outputCreditsPerMillion) }
    : { input: fixedRate(rateValue.inputUsdPerMillion), cached: fixedRate(rateValue.cachedInputUsdPerMillion), cacheWrite: fixedRate(rateValue.cacheWriteUsdPerMillion), output: fixedRate(rateValue.outputUsdPerMillion) };
}

function charge(tokens: DisjointTokenCounts, rates: FixedRate): bigint | undefined {
  const terms: Array<[number, bigint | undefined]> = [
    [tokens.ordinaryInput, rates.input], [tokens.cached, rates.cached], [tokens.cacheWrite, rates.cacheWrite], [tokens.output, rates.output],
  ];
  if (terms.some(([count, price]) => count > 0 && price === undefined)) return undefined;
  const numerator = terms.reduce((sum, [count, price]) => sum + BigInt(count) * (price ?? 0n), 0n);
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
  const cacheWrite = typeof model.cacheWriteInputTokens === "number" ? tokenCount(model.cacheWriteInputTokens) : undefined;
  const output = tokenCount(model.outputTokens);
  return {
    input, cached, cacheWrite, output, reasoning: tokenCount(model.reasoningTokens),
    priceableInput: tokenCount(model.priceableInputTokens),
    priceableCached: tokenCount(model.priceableCachedInputTokens),
    priceableCacheWrite: tokenCount(model.priceableCacheWriteInputTokens),
    priceableOutput: tokenCount(model.priceableOutputTokens),
    priceableSamples: tokenCount(model.priceableSampleCount),
    overlap: tokenCount(model.categoryOverlapTokenCount),
  };
}

function measuredTotal(metrics: PricingSummaryMetrics) {
  const input = metricValue(metrics.inputTokens);
  const output = metricValue(metrics.outputTokens);
  if (input === undefined || output === undefined) return undefined;
  return input + output;
}

export function calculateCodexEquivalentPricing({
  metrics,
  models,
  modelsTruncated = false,
  modelCount,
  totalModelTokenCount,
}: {
  metrics: PricingSummaryMetrics;
  models: readonly CodexPricingModelUsage[];
  modelsTruncated?: boolean;
  modelCount?: number;
  totalModelTokenCount?: number;
}): CodexEquivalentPricing {
  const excludedModels = models.filter((model) => isExcludedFromEquivalentPricing(model.model));
  const pricedModels = models.filter((model) => !isExcludedFromEquivalentPricing(model.model));
  const excludedUsage = excludedModels.reduce((total, model) => {
    const usage = sumTokenFields(model);
    return { input: total.input + usage.input, output: total.output + usage.output };
  }, { input: 0, output: 0 });
  const pricingMetrics: PricingSummaryMetrics = {
    ...metrics,
    inputTokens: subtractObservedTokens(metrics.inputTokens, excludedUsage.input),
    outputTokens: subtractObservedTokens(metrics.outputTokens, excludedUsage.output),
  };
  const observedTokenCount = measuredTotal(pricingMetrics);
  const excludedModelTokenCount = excludedUsage.input + excludedUsage.output;
  let pricedCredits = 0n;
  let pricedUsd = 0n;
  let creditCostAvailable = false;
  let usdCostAvailable = false;
  let pricedTokenCount = 0;
  let visibleModelTokenCount = 0;
  let pricedModelCount = 0;
  let unpricedModelCount = 0;
  let incompleteModelCount = 0;
  let unpricedModelTokenCount = 0;
  let tokenFieldsUnavailableTokenCount = 0;
  let categoryOverlapTokenCount = 0;
  const declaredModelCount = Math.max(models.length, typeof modelCount === "number" && Number.isFinite(modelCount) ? Math.trunc(modelCount) : models.length);
  const totalModelCount = Math.max(pricedModels.length, declaredModelCount - excludedModels.length);
  const hasModelTruncation = modelsTruncated || totalModelCount > pricedModels.length;
  const byModel = pricedModels.map((model) => {
    const usage = sumTokenFields(model);
    const rateValue = resolveCodexPricingRate(model.model);
    const eventCount = tokenCount(model.eventCount);
    const observedModelTokens = usage.input + usage.output;
    visibleModelTokenCount += observedModelTokens;
    categoryOverlapTokenCount += usage.overlap;
    const base = {
      model: model.model, displayName: rateValue?.displayName ?? model.model, eventCount,
      inputTokens: usage.input, cachedInputTokens: usage.cached,
      outputTokens: usage.output, reasoningTokens: usage.reasoning,
    };

    if (!rateValue) {
      unpricedModelCount += 1;
      unpricedModelTokenCount += observedModelTokens;
      return { ...base, status: "unpriced" as const, pricedTokenCount: 0, reason: "No published rate is available for this model." };
    }

    const categoriesOverlap = usage.overlap > 0 || (usage.cacheWrite !== undefined && usage.cached + usage.cacheWrite > usage.input) ||
      usage.priceableCached + usage.priceableCacheWrite > usage.priceableInput;
    const priceableModelTokens = usage.priceableInput + usage.priceableOutput;
    const hasPriceableSamples = usage.priceableSamples > 0;
    const readyWithinObserved = priceableModelTokens <= observedModelTokens;
    const categoriesComplete = !categoriesOverlap && readyWithinObserved &&
      usage.priceableInput === usage.input && usage.priceableCached === usage.cached &&
      (usage.cacheWrite === undefined || usage.priceableCacheWrite === usage.cacheWrite) &&
      usage.priceableOutput === usage.output;
    const priceableTokens = !categoriesOverlap && readyWithinObserved ? priceableModelTokens : 0;
    const missingCategoryTokens = categoriesComplete ? 0 : Math.max(0, observedModelTokens - priceableTokens);
    const unpricedUsdRate = rateValue.inputUsdPerMillion === undefined || rateValue.cachedInputUsdPerMillion === undefined || rateValue.outputUsdPerMillion === undefined;
    const readyCategories: DisjointTokenCounts | undefined = !categoriesOverlap && readyWithinObserved && hasPriceableSamples
      ? {
        ordinaryInput: usage.priceableInput - usage.priceableCached - usage.priceableCacheWrite,
        cached: usage.priceableCached,
        cacheWrite: usage.priceableCacheWrite,
        output: usage.priceableOutput,
      }
      : undefined;
    const creditsCost = readyCategories ? charge(readyCategories, fixedRates(rateValue, "credits")) : undefined;
    const usdCost = readyCategories ? charge(readyCategories, fixedRates(rateValue, "usd")) : undefined;
    if (creditsCost !== undefined) {
      pricedCredits += creditsCost;
      creditCostAvailable = true;
    }

    const reason = categoriesOverlap
      ? "Cached and cache-write input exceed the observed input total."
      : !hasPriceableSamples && observedModelTokens > 0
        ? "Token category fields were not fully observed for this usage."
        : unpricedUsdRate || usdCost === undefined
          ? "No complete standard API USD rate is available for these token categories."
          : missingCategoryTokens > 0
            ? "Some token category fields were not observed for this model."
            : undefined;
    const status = reason
      ? unpricedUsdRate || (usdCost === undefined && priceableTokens > 0) ? "unpriced" as const : "incomplete" as const
      : "priced" as const;

    if (status === "unpriced") {
      unpricedModelCount += 1;
      unpricedModelTokenCount += observedModelTokens;
    } else {
      pricedTokenCount += priceableTokens;
      if (usdCost !== undefined) {
        pricedUsd += usdCost;
        usdCostAvailable = true;
      }
      if (status === "incomplete") {
        incompleteModelCount += 1;
        tokenFieldsUnavailableTokenCount += missingCategoryTokens;
      } else {
        pricedModelCount += 1;
      }
    }

    return {
      ...base,
      status,
      pricedTokenCount: status === "unpriced" ? 0 : priceableTokens,
      ...(creditsCost !== undefined ? { apiCredits: decimal(creditsCost) } : {}),
      ...(usdCost !== undefined ? { usdEquivalent: decimal(usdCost) } : {}),
      ...(reason ? { reason } : {}),
    };
  });

  const completeModelTokenCount = typeof totalModelTokenCount === "number" && Number.isFinite(totalModelTokenCount)
    ? Math.max(0, Math.trunc(totalModelTokenCount) - excludedModelTokenCount)
    : visibleModelTokenCount;
  const exclusionAccountingMismatch = typeof totalModelTokenCount === "number" && Number.isFinite(totalModelTokenCount)
    ? Math.max(0, excludedModelTokenCount - Math.max(0, Math.trunc(totalModelTokenCount)))
    : 0;
  const accountingMismatchTokenCount = Math.max(
    exclusionAccountingMismatch,
    0,
    visibleModelTokenCount - completeModelTokenCount,
    observedTokenCount === undefined ? 0 : completeModelTokenCount - observedTokenCount,
    observedTokenCount === undefined ? 0 : visibleModelTokenCount - observedTokenCount,
  );
  const unattributedTokenCount = observedTokenCount === undefined
    ? undefined
    : Math.max(0, observedTokenCount - completeModelTokenCount);
  const truncatedModelTokenCount = hasModelTruncation
    ? Math.max(0, completeModelTokenCount - visibleModelTokenCount)
    : 0;
  const unpricedTokenCount = observedTokenCount === undefined
    ? undefined
    : Math.max(0, observedTokenCount - pricedTokenCount);
  const coveragePercent = observedTokenCount !== undefined && observedTokenCount > 0 && accountingMismatchTokenCount === 0
    ? Math.min(100, Math.max(0, Number(((pricedTokenCount / observedTokenCount) * 100).toFixed(2))))
    : undefined;
  const hasTokenSamples = observedTokenCount !== undefined || completeModelTokenCount > 0 || pricedModels.some((model) => tokenCount(model.priceableSampleCount) > 0);
  const incompleteAccountAttribution = observedTokenCount === undefined;
  const isComplete = hasTokenSamples && observedTokenCount !== undefined &&
    unpricedTokenCount === 0 && unpricedModelCount === 0 && incompleteModelCount === 0 &&
    (unattributedTokenCount ?? 0) === 0 && truncatedModelTokenCount === 0 && categoryOverlapTokenCount === 0 &&
    accountingMismatchTokenCount === 0 && !hasModelTruncation && !incompleteAccountAttribution;
  const status: CodexPricingStatus = !hasTokenSamples
    ? "unavailable"
    : isComplete
      ? "available"
      : "partial";
  const note = status === "unavailable"
    ? "No billable token samples are available for this window."
    : CODEX_PRICING_NOTE;

  return {
    status,
    basis: CODEX_PRICING_BASIS,
    rateCardId: CODEX_PRICING_CARD_ID,
    featureChargesIncluded: false,
    apiCredits: creditCostAvailable ? decimal(pricedCredits) : undefined,
    usdEquivalent: usdCostAvailable ? decimal(pricedUsd) : undefined,
    observedTokenCount,
    modelAttributedTokenCount: completeModelTokenCount,
    pricedTokenCount,
    unpricedTokenCount,
    unpricedModelTokenCount,
    unattributedTokenCount,
    tokenFieldsUnavailableTokenCount,
    truncatedModelTokenCount,
    categoryOverlapTokenCount,
    accountingMismatchTokenCount,
    coveragePercent,
    modelCount: totalModelCount,
    pricedModelCount,
    unpricedModelCount: unpricedModelCount + Math.max(0, totalModelCount - models.length),
    incompleteModelCount,
    modelsTruncated: hasModelTruncation,
    byModel,
    note,
  };
}
