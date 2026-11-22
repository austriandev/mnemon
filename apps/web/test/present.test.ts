import type { AskResult, Excerpt, Turn } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import { presentAnswer } from "../src/server/present.ts";

const turn = (index: number, speaker: string, start: number, lines: [number, number]): Turn => ({
  index,
  speaker,
  startSeconds: start,
  text: "…",
  sourceLines: { start: lines[0], end: lines[1] },
});
const excerpt: Excerpt = {
  meetingId: "m-1",
  title: "AMT-208 steering committee (Oct)",
  turns: [turn(31, "Priya Nair", 292, [50, 51]), turn(33, "Sam Okafor", 311, [53, 53])],
};
const base = { retrieved: [], excerpts: [excerpt], embeddingTokens: 3 };

describe("presentAnswer", () => {
  it("numbers each distinct citation once, in order of first use, linked to its turn", () => {
    const result: AskResult = {
      ...base,
      answer: {
        status: "answered",
        model: "claude-sonnet-5-5",
        gaps: "No audit date is given.",
        sentences: [
          {
            text: "Priya Nair is taking it.",
            citations: [{ meetingId: "m-1", turnIndex: 31, quote: "I'll take the vendor audit" }],
          },
          {
            text: "Sam sends the letter, after Priya.",
            citations: [
              { meetingId: "m-1", turnIndex: 33, quote: "I'll send the notice letter" },
              { meetingId: "m-1", turnIndex: 31, quote: "I'll take the vendor audit" },
            ],
          },
        ],
      },
    };

    const view = presentAnswer(result);

    expect(view.sentences).toEqual([
      { text: "Priya Nair is taking it.", sources: [1] },
      { text: "Sam sends the letter, after Priya.", sources: [2, 1] },
    ]);
    expect(view.sources).toEqual([
      {
        n: 1,
        meetingTitle: "AMT-208 steering committee (Oct)",
        time: "00:04:52",
        speaker: "Priya Nair",
        turnIndex: 31,
        lines: "lines 50-51",
        quote: "I'll take the vendor audit",
        href: "/meetings/m-1#turn-31",
      },
      {
        n: 2,
        meetingTitle: "AMT-208 steering committee (Oct)",
        time: "00:05:11",
        speaker: "Sam Okafor",
        turnIndex: 33,
        lines: "line 53",
        quote: "I'll send the notice letter",
        href: "/meetings/m-1#turn-33",
      },
    ]);
    expect(view).toMatchObject({
      status: "answered",
      gaps: "No audit date is given.",
      model: "claude-sonnet-5-5",
      searched: { chunks: 0, meetings: 1 },
    });
  });

  it("shows a not-found answer and a withheld answer with its reason, never the withheld text", () => {
    expect(presentAnswer({ ...base, answer: { status: "not_found", model: "m" } })).toMatchObject({
      status: "not_found",
      sentences: [],
      sources: [],
    });

    const withheld = presentAnswer({
      ...base,
      answer: {
        status: "rejected",
        reason: "sentence 2 has no citation",
        output: { secret: 1 },
        model: "m",
      },
    });
    expect(withheld).toMatchObject({
      status: "rejected",
      reason: "sentence 2 has no citation",
      sentences: [],
    });
    expect(JSON.stringify(withheld)).not.toContain("secret");
  });
});
