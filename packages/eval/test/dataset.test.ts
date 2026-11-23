import { readFileSync } from "node:fs";
import { parseTranscript, type Turn } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import { GOLD_RECORDS, MEETINGS, type MeetingKey, QUESTIONS } from "../src/dataset.ts";

const turns = Object.fromEntries(
  MEETINGS.map((m) => {
    const parsed = parseTranscript(
      readFileSync(new URL(`../../core/fixtures/${m.file}`, import.meta.url), "utf8"),
    );
    if (!parsed.ok) throw new Error(`${m.file} must parse`);
    return [m.key, parsed.turns];
  }),
) as Record<MeetingKey, Turn[]>;

describe("the eval dataset", () => {
  it("labels only turns that exist", () => {
    for (const m of MEETINGS) {
      for (const g of GOLD_RECORDS[m.key]) {
        for (const t of g.turns) expect(turns[m.key][t], `${m.key} ${g.label}`).toBeDefined();
      }
    }
    for (const q of QUESTIONS) {
      for (const e of q.evidence) {
        for (const t of e.turns) expect(turns[e.meeting][t], q.id).toBeDefined();
      }
    }
  });

  it("names each action item's owner as a speaker or in the turns it cites", () => {
    for (const m of MEETINGS) {
      for (const g of GOLD_RECORDS[m.key]) {
        if (!g.owner || g.optional) continue;
        const cited = g.turns.map((t) => turns[m.key][t]);
        const names = cited.flatMap((t) => (t ? [t.speaker, t.text] : [])).join(" ");
        expect(names, g.label).toContain(g.owner.replace(/^Dr\. /, "").split(" ")[0]);
      }
    }
  });

  it("grounds every fact in its evidence turns", () => {
    for (const q of QUESTIONS) {
      const text = q.evidence
        .flatMap((e) => e.turns.map((t) => turns[e.meeting][t]))
        .map((t) => `${t?.speaker} ${t?.text}`)
        .join(" ")
        .toLowerCase();
      for (const alternatives of q.facts) {
        expect(
          alternatives.some((a) => text.includes(a.toLowerCase())),
          `${q.id}: ${alternatives.join(" | ")}`,
        ).toBe(true);
      }
    }
  });

  it("dates every meeting a derived fact depends on", () => {
    for (const q of QUESTIONS.filter((q) => q.derived)) {
      for (const e of q.evidence) {
        const meeting = MEETINGS.find((m) => m.key === e.meeting);
        expect(meeting?.heldOn, q.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("includes a long meeting, 150+ turns with 20+ action items, to measure extraction recall", () => {
    const long = MEETINGS.filter((m) => turns[m.key].length >= 150);
    expect(long.length).toBeGreaterThan(0);
    for (const m of long) {
      const actions = GOLD_RECORDS[m.key].filter((g) => g.kind === "action_item" && !g.optional);
      expect(actions.length, m.key).toBeGreaterThanOrEqual(20);
    }
  });

  it("asks for every action item of each meeting, one fact per required action item", () => {
    for (const m of MEETINGS) {
      const list = QUESTIONS.find((q) => q.id === `list-${m.key}`);
      const actions = GOLD_RECORDS[m.key].filter((g) => g.kind === "action_item" && !g.optional);
      expect(list?.facts.length, m.key).toBe(actions.length);
    }
  });

  it("has unique question ids, and no evidence for unanswerable questions", () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const q of QUESTIONS.filter((q) => !q.answerable)) expect(q.evidence, q.id).toEqual([]);
  });
});
