import { describe, expect, it } from "vitest";
import { type ParseError, parseTranscript } from "../src/index.ts";

function errorsOf(source: string): ReadonlyArray<Pick<ParseError, "code" | "line">> {
  const result = parseTranscript(source);
  if (result.ok) throw new Error("expected the transcript to be rejected");
  return result.errors.map(({ code, line }) => ({ code, line }));
}

describe("parseTranscript rejects malformed input with located errors", () => {
  it.each([
    ["single-digit field", "[0:05] Priya Nair: Hello."],
    ["seconds out of range", "[00:12:75] Priya Nair: Hello."],
    ["minutes out of range", "[00:61:00] Priya Nair: Hello."],
    ["too many fields", "[01:00:00:00] Priya Nair: Hello."],
  ])("reports an invalid timestamp (%s)", (_, badLine) => {
    expect(errorsOf(`[00:00:01] Sam Okafor: Start.\n${badLine}`)).toEqual([
      { code: "invalid-timestamp", line: 2 },
    ]);
  });

  it("reports a timestamped line with no 'Speaker: ' separator", () => {
    expect(errorsOf("[00:00:01] Sam Okafor said we should start.")).toEqual([
      { code: "missing-speaker", line: 1 },
    ]);
  });

  it.each([
    ["nothing before the colon", "[00:00:01]: We should start."],
    ["only whitespace before the colon", "[00:00:01]   : We should start."],
  ])("reports an empty speaker (%s)", (_, badLine) => {
    expect(errorsOf(badLine)).toEqual([{ code: "empty-speaker", line: 1 }]);
  });

  it("reports a turn that has a speaker but no text", () => {
    expect(errorsOf("[00:00:01] Sam Okafor:\n[00:00:09] Priya Nair: Go ahead.")).toEqual([
      { code: "empty-text", line: 1 },
    ]);
  });

  it("allows a turn's text to start on the line after the speaker", () => {
    const result = parseTranscript("[00:00:01] Sam Okafor:\nLet's begin.");

    expect(result.ok && result.turns[0]?.text).toBe("Let's begin.");
  });

  it("reports text before the first turn once, at its first line", () => {
    expect(errorsOf("Minutes, draft 2\nconfidential\n[00:00:01] Sam Okafor: Start.")).toEqual([
      { code: "orphan-line", line: 1 },
    ]);
  });

  it("explains the problem in a human-readable message", () => {
    const result = parseTranscript("[00:00:01] Sam Okafor: Start.\n[00:12:75] Priya Nair: Hi.");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.message).toMatch(/00:12:75/);
  });
});
