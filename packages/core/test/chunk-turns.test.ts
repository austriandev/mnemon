import { describe, expect, it } from "vitest";
import { type Chunk, chunkTurns, type TokenCounter, type Turn } from "../src/index.ts";

/** One token per whitespace-separated word, so costs in these tests are easy to read. */
const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter(Boolean).length,
};

/**
 * Turns whose rendered line ("[HH:MM:SS] S<i>: w w ...") costs exactly the given
 * number of words: two for the timestamp and speaker, the rest for the text.
 */
function turnsCosting(costs: readonly number[]): Turn[] {
  return costs.map((cost, index) => ({
    index,
    speaker: `S${index}`,
    startSeconds: index * 10,
    text: Array.from({ length: cost - 2 }, () => "w").join(" "),
    sourceLines: { start: index + 1, end: index + 1 },
  }));
}

const ranges = (chunks: readonly Chunk[]) =>
  chunks.map((c) => [c.turnRange.first, c.turnRange.last, c.oversize]);

describe("chunkTurns", () => {
  it("puts turns that fit the budget into one chunk, rendered with speaker and timestamp", () => {
    const turns: Turn[] = [
      {
        index: 0,
        speaker: "Sam Okafor",
        startSeconds: 5,
        text: "Shall we start?",
        sourceLines: { start: 1, end: 1 },
      },
      {
        index: 1,
        speaker: "Priya Nair",
        startSeconds: 3725,
        text: "Yes.",
        sourceLines: { start: 2, end: 3 },
      },
    ];

    expect(
      chunkTurns(turns, { maxTokens: 100, overlapTurns: 0, tokenCounter: wordCounter }),
    ).toEqual([
      {
        index: 0,
        turnRange: { first: 0, last: 1 },
        startSeconds: 5,
        endSeconds: 3725,
        speakers: ["Sam Okafor", "Priya Nair"],
        text: "[00:00:05] Sam Okafor: Shall we start?\n[01:02:05] Priya Nair: Yes.",
        tokenCount: 10,
        oversize: false,
      },
    ]);
  });

  it("starts a new chunk when the next turn would exceed the budget", () => {
    const chunks = chunkTurns(turnsCosting([5, 5, 5, 5, 5]), {
      maxTokens: 10,
      overlapTurns: 0,
      tokenCounter: wordCounter,
    });

    expect(ranges(chunks)).toEqual([
      [0, 1, false],
      [2, 3, false],
      [4, 4, false],
    ]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("repeats the last overlapTurns turns of a chunk at the start of the next", () => {
    const chunks = chunkTurns(turnsCosting([5, 5, 5, 5, 5, 5]), {
      maxTokens: 15,
      overlapTurns: 1,
      tokenCounter: wordCounter,
    });

    expect(ranges(chunks)).toEqual([
      [0, 2, false],
      [2, 4, false],
      [4, 5, false],
    ]);
  });
});
