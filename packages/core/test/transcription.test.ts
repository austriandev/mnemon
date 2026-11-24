import { describe, expect, it } from "vitest";
import { parseTranscript, speakersOf, toTranscript, type Utterance } from "../src/index.ts";

// What a speech-to-text service returns once it has told the speakers apart: who
// (a label), when (ms from the start) and what. Adapted from a diarized transcript.
const utterances: Utterance[] = [
  { speaker: "A", startMs: 250, text: "Good morning. This is the BX-17 line review." },
  { speaker: "B", startMs: 4_900, text: "The sealer is back at 180 degrees." },
  { speaker: "A", startMs: 9_400, text: "Good. Then we restart the line on Monday." },
  { speaker: "C", startMs: 3_725_000, text: "I'll update the deviation log today." },
];

function turnsOf(source: string) {
  const parsed = parseTranscript(source);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join("\n"));
  return parsed.turns.map(({ speaker, startSeconds, text }) => ({ speaker, startSeconds, text }));
}

describe("toTranscript", () => {
  it("writes each utterance as a turn that Mnemon's own parser reads back unchanged", () => {
    const source = toTranscript(utterances);

    expect(source).toBe(
      [
        "[00:00:00] Speaker A: Good morning. This is the BX-17 line review.",
        "[00:00:04] Speaker B: The sealer is back at 180 degrees.",
        "[00:00:09] Speaker A: Good. Then we restart the line on Monday.",
        "[01:02:05] Speaker C: I'll update the deviation log today.",
      ].join("\n"),
    );
    expect(turnsOf(source)).toEqual([
      {
        speaker: "Speaker A",
        startSeconds: 0,
        text: "Good morning. This is the BX-17 line review.",
      },
      { speaker: "Speaker B", startSeconds: 4, text: "The sealer is back at 180 degrees." },
      { speaker: "Speaker A", startSeconds: 9, text: "Good. Then we restart the line on Monday." },
      { speaker: "Speaker C", startSeconds: 3725, text: "I'll update the deviation log today." },
    ]);
  });

  it("uses the names given for each label, keeping the default for the rest", () => {
    const source = toTranscript(utterances, { A: "Rui Almeida", B: " Dr. Grace Mensah " });

    expect(turnsOf(source).map((t) => t.speaker)).toEqual([
      "Rui Almeida",
      "Dr. Grace Mensah",
      "Rui Almeida",
      "Speaker C",
    ]);
  });

  it("joins consecutive utterances by the same person into one turn", () => {
    const source = toTranscript(utterances.slice(0, 3), { A: "Rui Almeida", B: "Rui Almeida" });

    expect(turnsOf(source)).toEqual([
      {
        speaker: "Rui Almeida",
        startSeconds: 0,
        text: "Good morning. This is the BX-17 line review. The sealer is back at 180 degrees. Good. Then we restart the line on Monday.",
      },
    ]);
  });

  it("puts each turn on one line, skips empty utterances, and keeps time order", () => {
    const source = toTranscript([
      { speaker: "B", startMs: 8_000, text: "Second,\n  on two lines." },
      { speaker: "A", startMs: 1_000, text: "First." },
      { speaker: "C", startMs: 5_000, text: "   " },
    ]);

    expect(source).toBe(
      "[00:00:01] Speaker A: First.\n[00:00:08] Speaker B: Second, on two lines.",
    );
  });

  it("keeps a typed name from breaking the transcript: no colons, no new lines, never blank", () => {
    const source = toTranscript(utterances.slice(0, 2), { A: "QA: Lead\nRui", B: "   " });

    expect(turnsOf(source).map((t) => t.speaker)).toEqual(["QA - Lead Rui", "Speaker B"]);
  });
});

describe("speakersOf", () => {
  it("lists each label once, in order of first appearance, with what they first said", () => {
    expect(speakersOf(utterances)).toEqual([
      { label: "A", firstWords: "Good morning. This is the BX-17 line review." },
      { label: "B", firstWords: "The sealer is back at 180 degrees." },
      { label: "C", firstWords: "I'll update the deviation log today." },
    ]);
  });
});
