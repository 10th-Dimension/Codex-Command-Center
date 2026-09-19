export interface TokenStackDefinition<TKey extends string> {
  readonly id: string;
  readonly key: TKey;
  readonly label: string;
  readonly color: string;
}

export interface TokenStackGeometry<TDefinition> {
  readonly definition: TDefinition;
  readonly base: number[];
  readonly topValues: number[];
}

/**
 * Builds the geometry for a stacked token chart.
 *
 * Each band's thickness is the field's own measured value. The top value is
 * cumulative only because it is the upper boundary of that band; callers
 * should not draw that boundary as if it were an independent series.
 */
export function stackTokenSeries<TPoint, TDefinition extends TokenStackDefinition<string>>(
  points: readonly TPoint[],
  series: readonly TDefinition[],
  readValue: (point: TPoint, key: TDefinition["key"]) => number | undefined,
): Array<TokenStackGeometry<TDefinition>> {
  const cumulative = points.map(() => 0);

  return series.map((definition) => {
    const base: number[] = [];
    const topValues: number[] = [];

    points.forEach((point, index) => {
      base.push(cumulative[index]);
      const rawValue = readValue(point, definition.key);
      const value = typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
      cumulative[index] += value;
      topValues.push(cumulative[index]);
    });

    return { definition, base, topValues };
  });
}
