import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Chunk, chunkTurns, type Turn } from "../src/index.ts";

const SPEAKERS = ["Dana Wu", "Priya Nair", "Sam Okafor", "Dr. Elena Ortiz"];
const WORDS = ["we", "hold", "the", "dose", "at", "20", "mg", "audit", "sites", "agreed."];
const LONGEST_SPEAKER = Math.max(...SPEAKERS.map((s) => s.length));
const LONGEST_WORD = Math.max(...WORDS.map((w) => w.length));

/** A meeting of turns in order, with non-decreasing start times. */
function meeting(maxWordsPerTurn: number) {
  return fc
    .array(
      fc.record({
        speaker: fc.constantFrom(...SPEAKERS),
        words: fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: maxWordsPerTurn }),
        gapSeconds: fc.nat({ max: 120 }),
      }),
      { minLength: 1, maxLength: 60 },
    )
    .map((specs) => {
      let clock = 0;
      return specs.map(({ speaker, words, gapSeconds }, index): Turn => {
        clock += gapSeconds;
        return {
          index,
          speaker,
          startSeconds: clock,
          text: words.join(" "),
          sourceLines: { start: index + 1, end: index + 1 },
        };
      });
    });
}

const options = fc.record({
  maxTokens: fc.integer({ min: 1, max: 200 }),
  overlapTurns: fc.integer({ min: 0, max: 4 }),
});

const turnsIn = (chunk: Chunk, turns: readonly Turn[]) =>
  turns.slice(chunk.turnRange.first, chunk.turnRange.last + 1);

const pairs = <T>(items: readonly T[]): Array<[T, T]> =>
  items.slice(1).map((item, i) => [items[i] as T, item]);

describe("chunkTurns invariants", () => {
  it("every turn appears in at least one chunk", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        const covered = new Set(
          chunkTurns(turns, opts).flatMap((c) => turnsIn(c, turns).map((t) => t.index)),
        );
        expect([...covered].sort((a, b) => a - b)).toEqual(turns.map((t) => t.index));
      }),
    );
  });

  it("no turn is split: each chunk holds whole turns, one line per turn", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        for (const chunk of chunkTurns(turns, opts)) {
          const lines = chunk.text.split("\n");
          const expected = turnsIn(chunk, turns);
          expect(lines).toHaveLength(expected.length);
          lines.forEach((line, i) => {
            const turn = expected[i] as Turn;
            expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] /);
            expect(line.endsWith(`] ${turn.speaker}: ${turn.text}`)).toBe(true);
          });
        }
      }),
    );
  });

  it("chunks are in order, numbered from 0, and each adds at least one new turn", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        const chunks = chunkTurns(turns, opts);
        expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
        for (const [prev, next] of pairs(chunks)) {
          expect(next.turnRange.first).toBeGreaterThan(prev.turnRange.first);
          expect(next.turnRange.last).toBeGreaterThan(prev.turnRange.last);
        }
      }),
    );
  });

  it("consecutive chunks leave no gap and share at most overlapTurns turns", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        for (const [prev, next] of pairs(chunkTurns(turns, opts))) {
          const shared = prev.turnRange.last - next.turnRange.first + 1;
          expect(shared).toBeGreaterThanOrEqual(0);
          expect(shared).toBeLessThanOrEqual(opts.overlapTurns);
        }
      }),
    );
  });

  it("overlap is exactly overlapTurns whenever overlapTurns + 1 turns always fit the budget", () => {
    // Upper bound on one rendered turn line plus its newline, in approximate tokens:
    // "[HH:MM:SS] " (11) + speaker + ": " (2) + text + "\n" (1), divided by 4.
    const maxWords = 12;
    const longestText = maxWords * LONGEST_WORD + (maxWords - 1);
    const turnBound = Math.ceil((14 + LONGEST_SPEAKER + longestText) / 4);
    const roomyOptions = fc
      .record({ overlapTurns: fc.integer({ min: 0, max: 4 }), slack: fc.nat({ max: 300 }) })
      .map(({ overlapTurns, slack }) => ({
        overlapTurns,
        maxTokens: (overlapTurns + 1) * turnBound + slack,
      }));

    fc.assert(
      fc.property(meeting(maxWords), roomyOptions, (turns, opts) => {
        for (const [prev, next] of pairs(chunkTurns(turns, opts))) {
          expect(prev.turnRange.last - next.turnRange.first + 1).toBe(opts.overlapTurns);
        }
      }),
    );
  });

  it("chunks stay within budget unless they are a single oversize turn", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        for (const chunk of chunkTurns(turns, opts)) {
          if (chunk.oversize) {
            expect(chunk.turnRange.first).toBe(chunk.turnRange.last);
            expect(chunk.tokenCount).toBeGreaterThan(opts.maxTokens);
          } else {
            expect(chunk.tokenCount).toBeLessThanOrEqual(opts.maxTokens);
          }
        }
      }),
    );
  });

  it("each chunk's times and speakers describe its own turns", () => {
    fc.assert(
      fc.property(meeting(40), options, (turns, opts) => {
        for (const chunk of chunkTurns(turns, opts)) {
          const own = turnsIn(chunk, turns);
          expect(chunk.startSeconds).toBe(own[0]?.startSeconds);
          expect(chunk.endSeconds).toBe(own.at(-1)?.startSeconds);
          expect(new Set(chunk.speakers)).toEqual(new Set(own.map((t) => t.speaker)));
          expect(chunk.speakers).toHaveLength(new Set(chunk.speakers).size);
        }
      }),
    );
  });
});
