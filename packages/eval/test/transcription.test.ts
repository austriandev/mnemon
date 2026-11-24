import type { Turn, Utterance } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import { scoreSpeakers, wordErrorRate } from "../src/transcription-score.ts";

describe("wordErrorRate", () => {
  it("counts substitutions, insertions and deletions over the reference's words", () => {
    expect(wordErrorRate("the line restarts at ten", "the line restarts at ten")).toBe(0);
    // one substitution (starts), one deletion (at): 2 of 5 words.
    expect(wordErrorRate("the line restarts at ten", "the line starts ten")).toBe(0.4);
    // one insertion: 1 of 2 words.
    expect(wordErrorRate("hold dose", "hold the dose")).toBe(0.5);
  });

  it("ignores case, punctuation and how numbers are written", () => {
    expect(
      wordErrorRate(
        "It held at 180 degrees, at six.",
        "it held at one hundred eighty degrees at 6",
      ),
    ).toBe(0);
    expect(wordErrorRate("Thirty minutes. BX-17!", "30 minutes bx 17")).toBe(0);
  });
});

describe("scoreSpeakers", () => {
  const turn = (index: number, speaker: string, startSeconds: number): Turn => ({
    index,
    speaker,
    startSeconds,
    text: "",
    sourceLines: { start: index + 1, end: index + 1 },
  });
  const reference = [
    turn(0, "Rui", 0),
    turn(1, "Grace", 5),
    turn(2, "Rui", 11),
    turn(3, "Tomas", 19),
  ];

  it("maps each label to the person it most often lands on, then counts turns attributed right", () => {
    const utterances: Utterance[] = [
      { speaker: "A", startMs: 300, text: "" },
      { speaker: "B", startMs: 5_200, text: "" },
      { speaker: "A", startMs: 11_100, text: "" },
      { speaker: "C", startMs: 19_400, text: "" },
    ];

    expect(scoreSpeakers(reference, utterances)).toEqual({
      correct: 4,
      turns: 4,
      labels: { A: "Rui", B: "Grace", C: "Tomas" },
      speakersFound: 3,
      speakersExpected: 3,
    });
  });

  it("counts a turn wrong when two people were merged into one label", () => {
    const utterances: Utterance[] = [
      { speaker: "A", startMs: 300, text: "" },
      { speaker: "A", startMs: 5_200, text: "" },
      { speaker: "A", startMs: 11_100, text: "" },
      { speaker: "B", startMs: 19_400, text: "" },
    ];

    const score = scoreSpeakers(reference, utterances);
    expect(score.correct).toBe(3);
    expect(score.labels).toEqual({ A: "Rui", B: "Tomas" });
    expect(score.speakersFound).toBe(2);
  });
});
