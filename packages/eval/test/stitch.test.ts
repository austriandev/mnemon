import type { Turn } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import type { GoldRecord } from "../src/dataset.ts";
import { stitch } from "../src/stitch.ts";

const turn = (index: number, startSeconds: number, text: string): Turn => ({
  index,
  speaker: "Ana",
  startSeconds,
  text,
  sourceLines: { start: index + 1, end: index + 1 },
});

describe("stitch", () => {
  it("joins meetings into one, numbering turns on and shifting each meeting's gold turns", () => {
    const first = {
      turns: [turn(0, 0, "a"), turn(1, 30, "b")],
      gold: [{ kind: "decision", label: "x", turns: [1] }] satisfies GoldRecord[],
    };
    const second = {
      turns: [turn(0, 0, "c"), turn(1, 12, "d")],
      gold: [
        { kind: "action_item", label: "y", owner: "Ana", turns: [0, 1], optional: true },
      ] satisfies GoldRecord[],
    };

    const joined = stitch([first, second]);

    expect(joined.turns.map((t) => [t.index, t.startSeconds, t.text])).toEqual([
      [0, 0, "a"],
      [1, 30, "b"],
      [2, 90, "c"],
      [3, 102, "d"],
    ]);
    expect(joined.gold).toEqual([
      { kind: "decision", label: "x", turns: [1] },
      { kind: "action_item", label: "y", owner: "Ana", turns: [2, 3], optional: true },
    ]);
  });
});
