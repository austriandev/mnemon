import type { Answer, MeetingRecord, SearchHit } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import type { GoldQuestion, GoldRecord } from "../src/dataset.ts";
import { scoreAnswer, scoreExtraction, scoreRetrieval } from "../src/score.ts";

const record = (
  kind: MeetingRecord["kind"],
  turns: number[],
  owner: string | null = null,
): MeetingRecord => ({
  index: 0,
  kind,
  summary: `${kind} citing ${turns.join(",")}`,
  owner,
  due: null,
  citations: turns.map((turnIndex) => ({ turnIndex, quote: "q" })),
});

const gold: GoldRecord[] = [
  { kind: "decision", label: "dose hold", turns: [19, 22] },
  { kind: "decision", label: "no second vendor", turns: [25], optional: true },
  { kind: "action_item", label: "listings", owner: "Dr. Hana Sato", turns: [23] },
  { kind: "action_item", label: "audit plan", owner: "Priya Nair", turns: [31] },
];

describe("scoreExtraction", () => {
  it("counts a record as a hit when it has the gold record's kind and cites one of its turns", () => {
    const score = scoreExtraction(
      [record("decision", [22]), record("action_item", [23], "Hana Sato")],
      gold,
    );

    expect(score.hits).toBe(2);
    expect(score.misses.map((g) => g.label)).toEqual(["audit plan"]);
    expect(score.extras).toEqual([]);
  });

  it("counts records that match nothing, or repeat a matched one, as extras", () => {
    const score = scoreExtraction(
      [record("decision", [22]), record("decision", [19]), record("decision", [5])],
      gold,
    );

    expect(score.hits).toBe(1);
    expect(score.extras.map((r) => r.citations[0]?.turnIndex)).toEqual([19, 5]);
  });

  it("neither rewards nor penalises optional records", () => {
    const withOptional = scoreExtraction([record("decision", [25])], gold);

    expect(withOptional.hits).toBe(0);
    expect(withOptional.extras).toEqual([]);
    expect(withOptional.misses.map((g) => g.label)).toEqual([
      "dose hold",
      "listings",
      "audit plan",
    ]);
  });

  it("ignores topics and a kind mismatch is not a hit", () => {
    const score = scoreExtraction([record("topic", [22]), record("decision", [23])], gold);

    expect(score.hits).toBe(0);
    expect(score.extras).toHaveLength(1);
  });

  it("checks owners of matched action items, ignoring titles and case", () => {
    const score = scoreExtraction(
      [record("action_item", [23], "hana sato"), record("action_item", [31], "Dana Wu")],
      gold,
    );

    expect(score).toMatchObject({ hits: 2, ownersCorrect: 1, ownersChecked: 2 });
  });

  it("matches a record citing two action items' turns to the one whose owner it names", () => {
    const handover: GoldRecord[] = [
      { kind: "action_item", label: "resubmission", owner: "Rosa Delgado", turns: [122, 123] },
      { kind: "action_item", label: "draft to Rosa", owner: "Lea Fontaine", turns: [124] },
    ];
    const score = scoreExtraction(
      [record("action_item", [123, 124], "Lea Fontaine"), record("action_item", [123], "Rosa")],
      handover,
    );

    expect(score).toMatchObject({ hits: 2, extras: [], ownersCorrect: 2, ownersChecked: 2 });
  });

  it("matches a record to the gold record sharing the most of its cited turns", () => {
    const shared: GoldRecord[] = [
      { kind: "decision", label: "escalation resumes", turns: [13, 31] },
      { kind: "decision", label: "batch on hold", turns: [23, 31] },
    ];
    const score = scoreExtraction([record("decision", [23, 31]), record("decision", [13])], shared);

    expect(score).toMatchObject({ hits: 2, extras: [] });
  });
});

const hit = (meetingId: string, first: number, last: number): SearchHit => ({
  meetingId,
  chunk: {
    index: first,
    turnRange: { first, last },
    startSeconds: 0,
    endSeconds: 0,
    speakers: [],
    text: "",
    tokenCount: 0,
    oversize: false,
  },
});
const ids = { oct: "id-oct", nov: "id-nov", cmc: "id-cmc", kr44: "id-kr44" } as const;

describe("scoreRetrieval", () => {
  it("measures the share of evidence turns the top k chunks cover, and the first chunk that covers any", () => {
    const ranked = [hit("id-cmc", 0, 9), hit("id-nov", 10, 19), hit("id-oct", 30, 40)];
    const evidence = [
      { meeting: "nov" as const, turns: [12, 15] },
      { meeting: "oct" as const, turns: [31, 50] },
    ];

    expect(scoreRetrieval(ranked, evidence, ids, [1, 2, 3])).toEqual({
      recallAt: { 1: 0, 2: 0.5, 3: 0.75 },
      reciprocalRank: 0.5,
    });
  });

  it("scores no evidence found as zero", () => {
    expect(
      scoreRetrieval([hit("id-cmc", 0, 9)], [{ meeting: "oct", turns: [1] }], ids, [1]),
    ).toEqual({ recallAt: { 1: 0 }, reciprocalRank: 0 });
  });
});

const question: GoldQuestion = {
  id: "amendment-owner",
  question: "Who is drafting the protocol amendment, and by when?",
  answerable: true,
  facts: [["Hana"], ["end of the month", "month end"]],
  evidence: [{ meeting: "nov", turns: [12, 15] }],
};
const answered = (texts: string[], turnIndex = 15, gaps: string | null = null): Answer => ({
  status: "answered",
  model: "m",
  gaps,
  sentences: texts.map((text) => ({
    text,
    citations: [{ meetingId: "id-nov", turnIndex, quote: "q" }],
  })),
});

describe("scoreAnswer", () => {
  it("is correct when it answers with every fact, and notes whether it cites the evidence", () => {
    const score = scoreAnswer(
      answered(["Dr. Hana Sato is drafting it.", "It is due by the End of the Month."]),
      question,
      ids,
    );

    expect(score).toEqual({
      outcome: "answered",
      correct: true,
      factsFound: 2,
      factsTotal: 2,
      citesEvidence: true,
    });
  });

  it("is not correct when a fact is missing or the evidence is not cited", () => {
    expect(scoreAnswer(answered(["Hana is drafting it."], 3), question, ids)).toEqual({
      outcome: "answered",
      correct: false,
      factsFound: 1,
      factsTotal: 2,
      citesEvidence: false,
    });
  });

  it("also requires the derived facts, worked out from the meeting's date", () => {
    const dated: GoldQuestion = { ...question, derived: [["30 November"]] };
    const said = ["Dr. Hana Sato is drafting it.", "It is due by the end of the month."];

    expect(scoreAnswer(answered(said), dated, ids)).toMatchObject({
      correct: false,
      factsFound: 2,
      factsTotal: 3,
    });
    expect(scoreAnswer(answered([...said, "That is 30 November 2026."]), dated, ids)).toMatchObject(
      { correct: true, factsFound: 3, factsTotal: 3 },
    );
  });

  it("is correct for a question the meetings don't answer only when it says not found", () => {
    const unanswerable: GoldQuestion = { ...question, answerable: false, facts: [], evidence: [] };

    expect(scoreAnswer({ status: "not_found", model: "m" }, unanswerable, ids)).toMatchObject({
      outcome: "not_found",
      correct: true,
      citesEvidence: null,
    });
    expect(scoreAnswer(answered(["Hana."]), unanswerable, ids)).toMatchObject({ correct: false });
  });

  it("accepts not found where the gold says the meetings don't settle it", () => {
    const either = { ...question, acceptNotFound: true };

    expect(scoreAnswer({ status: "not_found", model: "m" }, either, ids).correct).toBe(true);
    expect(scoreAnswer({ status: "not_found", model: "m" }, question, ids).correct).toBe(false);
  });

  it("counts a rejected answer as wrong", () => {
    const rejected: Answer = { status: "rejected", reason: "r", output: {}, model: "m" };

    expect(scoreAnswer(rejected, question, ids)).toMatchObject({
      outcome: "rejected",
      correct: false,
      factsFound: 0,
    });
  });
});
