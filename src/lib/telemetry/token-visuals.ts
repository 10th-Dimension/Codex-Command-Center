/**
 * The shared visual vocabulary for measured token fields.
 *
 * These are presentation constants only. They do not change token math or
 * billing semantics; they keep the dashboard and native overlay consistent.
 */
export const tokenVisualColors = {
  input: "#68d8e8",
  output: "#a78bfa",
  cached: "#55d6a9",
  cacheWrite: "#7dd3fc",
  reasoning: "#f4b860",
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
