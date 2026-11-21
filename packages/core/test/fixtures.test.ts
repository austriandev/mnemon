import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("steering-committee fixture", () => {
  const result = parseTranscript(fixture("steering-committee.txt"));
  const turns = result.ok ? result.turns : [];

  it("parses cleanly into 47 turns", () => {
    expect(result.ok).toBe(true);
    expect(turns).toHaveLength(47);
  });

  it("keeps the dose decision traceable to who said it, when, and where in the file", () => {
    expect(turns.find((t) => t.text.startsWith("That's my view too."))).toEqual({
      index: 19,
      speaker: "Dr. Elena Ortiz",
      startSeconds: 200,
      text: "That's my view too. We should hold the dose at 20 mg until the safety review comes back.",
      sourceLines: { start: 32, end: 33 },
    });
  });
});

describe("malformed fixtures", () => {
  it.each([
    ["invalid-timestamp.txt", "invalid-timestamp", 3],
    ["backwards-timestamp.txt", "timestamp-backwards", 4],
    ["empty-speaker.txt", "empty-speaker", 2],
    ["missing-speaker.txt", "missing-speaker", 2],
    ["empty-text.txt", "empty-text", 1],
    ["orphan-preamble.txt", "orphan-line", 1],
    ["no-turns.txt", "no-turns", null],
  ])("%s is rejected with %s at line %s", (file, code, line) => {
    const result = parseTranscript(fixture(`malformed/${file}`));

    expect(result.ok ? [] : result.errors.map((e) => ({ code: e.code, line: e.line }))).toEqual([
      { code, line },
    ]);
  });
});
