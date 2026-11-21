import { describe, expect, it } from "vitest";
import { fuseRankings } from "../src/index.ts";

const id = (s: string) => s;

describe("fuseRankings (reciprocal rank fusion)", () => {
  it("scores each item by the sum of 1 / (k + rank) over the rankings it appears in", () => {
    // a: 1/61 + 1/62 = 0.032522   c: 1/63 + 1/61 = 0.032266   b: 1/62 = 0.016129
    const fused = fuseRankings(
      [
        ["a", "b", "c"],
        ["c", "a"],
      ],
      id,
    );

    expect(fused.map((f) => f.item)).toEqual(["a", "c", "b"]);
    expect(fused[0]?.score).toBeCloseTo(0.032522, 6);
    expect(fused[2]?.score).toBeCloseTo(0.016129, 6);
  });

  it("reports each item's 1-based rank in every ranking, or null where it is absent", () => {
    const fused = fuseRankings([["a", "b"], ["b"]], id);

    expect(fused.map((f) => [f.item, f.ranks])).toEqual([
      ["b", [2, 1]],
      ["a", [1, null]],
    ]);
  });

  it("breaks score ties by first appearance, scanning rankings in order", () => {
    expect(
      fuseRankings(
        [
          ["a", "b"],
          ["b", "a"],
        ],
        id,
      ).map((f) => f.item),
    ).toEqual(["a", "b"]);
  });

  it("merges items by key, not by identity", () => {
    const fused = fuseRankings([[{ id: "x" }], [{ id: "x" }]], (item) => item.id);

    expect(fused).toHaveLength(1);
    expect(fused[0]?.ranks).toEqual([1, 1]);
  });

  it("uses a configurable k", () => {
    expect(fuseRankings([["a"]], id, { k: 0 })[0]?.score).toBe(1);
  });
});
