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

  it("explains the problem in a human-readable message", () => {
    const result = parseTranscript("[00:00:01] Sam Okafor: Start.\n[00:12:75] Priya Nair: Hi.");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.message).toMatch(/00:12:75/);
  });
});
