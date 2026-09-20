/**
 * The shared visual vocabulary for measured token fields.
 *
 * These are presentation constants only. They do not change token math or
 * billing semantics; they keep the dashboard and native overlay consistent.
 */
export const tokenVisualColors = {
  // High-luminance colors keep adjacent fields distinguishable on dark
  // dashboard and native overlay surfaces without changing their meaning.
  input: "#22d3ee",
  output: "#c084fc",
  cached: "#34d399",
  cacheWrite: "#60a5fa",
  reasoning: "#fbbf24",
  tool: "#f472b6",
} as const;

export const tokenVisualSeries = [
  { id: "input", label: "Input", color: tokenVisualColors.input },
  { id: "output", label: "Output", color: tokenVisualColors.output },
  { id: "cached", label: "Cached", color: tokenVisualColors.cached },
  { id: "cacheWrite", label: "Cache write", color: tokenVisualColors.cacheWrite },
  { id: "reasoning", label: "Reasoning", color: tokenVisualColors.reasoning },
  { id: "tool", label: "Tool", color: tokenVisualColors.tool },
] as const;

/**
 * Calculates the exact proportional widths used by token-composition bars.
 * Zero-valued fields stay in the returned list for their ledger/legend row,
 * while negative or non-finite values cannot create visual area.
 */
export function tokenCompositionSegments<T extends { readonly value: number }>(items: readonly T[]) {
  const safeItems = items.map((item) => ({ ...item, value: Number.isFinite(item.value) && item.value > 0 ? item.value : 0 }));
  const total = safeItems.reduce((sum, item) => sum + item.value, 0);
  return { total, items: safeItems.map((item) => ({ ...item, fraction: total > 0 ? item.value / total : 0 })) };
}
