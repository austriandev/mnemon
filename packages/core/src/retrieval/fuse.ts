export interface Fused<T> {
  readonly item: T;
  /** Sum of 1 / (k + rank) over the rankings the item appears in. */
  readonly score: number;
  /** The item's 1-based rank in each input ranking, or null where it is absent. */
  readonly ranks: readonly (number | null)[];
}

/** k = 60 is the value from the original RRF paper (Cormack et al., 2009). */
export const DEFAULT_RRF_K = 60;

/**
 * Reciprocal rank fusion: merges several rankings of the same kind of item into
 * one, using only rank positions, so scores on different scales (text relevance,
 * cosine distance) never need to be compared. Ties keep first-appearance order.
 */
export function fuseRankings<T>(
  rankings: readonly (readonly T[])[],
  key: (item: T) => string,
  { k = DEFAULT_RRF_K }: { k?: number } = {},
): Fused<T>[] {
  const byKey = new Map<string, { item: T; score: number; ranks: (number | null)[] }>();
  rankings.forEach((ranking, list) => {
    ranking.forEach((item, position) => {
      const id = key(item);
      let entry = byKey.get(id);
      if (!entry) {
        entry = { item, score: 0, ranks: rankings.map(() => null) };
        byKey.set(id, entry);
      }
      if (entry.ranks[list] === null) {
        entry.ranks[list] = position + 1;
        entry.score += 1 / (k + position + 1);
      }
    });
  });
  // Array.prototype.sort is stable, so equal scores keep insertion (first-appearance) order.
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
