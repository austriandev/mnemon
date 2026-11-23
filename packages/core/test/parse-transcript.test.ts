import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/index.ts";

describe("parseTranscript", () => {
  it("parses a timestamped line into a turn with speaker, start time and source line", () => {
    const result = parseTranscript("[00:12:40] Dr. Elena Ortiz: We should hold the dose at 20 mg.");

    expect(result).toEqual({
      ok: true,
      turns: [
        {
          index: 0,
          speaker: "Dr. Elena Ortiz",
          startSeconds: 760,
          text: "We should hold the dose at 20 mg.",
          sourceLines: { start: 1, end: 1 },
        },
      ],
    });
  });

  it("joins untimestamped lines onto the previous turn and ignores blank lines", () => {
    const source = [
      "[00:12:40] Dr. Elena Ortiz: We should hold the dose at 20 mg until the",
      "safety review comes back.",
      "",
      "[00:12:58] Priya Nair: Agreed. I'll take the vendor audit.",
    ].join("\n");

    expect(parseTranscript(source)).toEqual({
      ok: true,
      turns: [
        {
          index: 0,
          speaker: "Dr. Elena Ortiz",
          startSeconds: 760,
          text: "We should hold the dose at 20 mg until the safety review comes back.",
          sourceLines: { start: 1, end: 2 },
        },
        {
          index: 1,
          speaker: "Priya Nair",
          startSeconds: 778,
          text: "Agreed. I'll take the vendor audit.",
          sourceLines: { start: 4, end: 4 },
        },
      ],
    });
  });

  it("accepts [MM:SS] timestamps alongside [HH:MM:SS]", () => {
    const result = parseTranscript(
      "[04:05] Priya Nair: Short meeting.\n[01:00:00] Sam Okafor: Long one.",
    );

    expect(result.ok && result.turns.map((t) => t.startSeconds)).toEqual([245, 3600]);
  });

  it("splits the speaker at the first ': ' so the text may contain colons", () => {
    const result = parseTranscript("[00:00:05] Priya Nair: Agenda: budget, then hiring.");

    expect(result.ok && result.turns[0]).toMatchObject({
      speaker: "Priya Nair",
      text: "Agenda: budget, then hiring.",
    });
  });

  it("accepts Windows line endings", () => {
    const result = parseTranscript("[00:00:01] Priya Nair: One\r\nmore line.\r\n");

    expect(result.ok && result.turns[0]?.text).toBe("One more line.");
  });
  it("reads a line starting with a bracketed number, like a footnote, as text", () => {
    const source = "[00:01:10] Dana Wu: The criteria are in the protocol.\n[2] See appendix B.";

    const result = parseTranscript(source);

    expect(result).toMatchObject({
      ok: true,
      turns: [{ text: "The criteria are in the protocol. [2] See appendix B." }],
    });
  });
});
