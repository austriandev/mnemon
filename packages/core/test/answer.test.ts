import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  answer,
  type Excerpt,
  type LanguageModel,
  parseTranscript,
  type StructuredRequest,
} from "../src/index.ts";

const parsed = parseTranscript(
  readFileSync(new URL("../fixtures/steering-committee.txt", import.meta.url), "utf8"),
);
if (!parsed.ok) throw new Error("fixture must parse");
const turns = parsed.turns;

const QUESTION = "Who is doing the vendor audit?";

/** Turns 30-33 and 43 of the fixture, as if retrieved for the question. */
const steering: Excerpt = {
  meetingId: "m-steering",
  title: "AMT-208 steering committee (Oct)",
  turns: turns.filter((t) => (t.index >= 30 && t.index <= 33) || t.index === 43),
};
const budget: Excerpt = {
  meetingId: "m-budget",
  title: "Budget review",
  turns: [
    {
      index: 4,
      speaker: "Sam Okafor",
      startSeconds: 95,
      text: "The audit is funded from the reallocation.",
      sourceLines: { start: 7, end: 7 },
    },
  ],
};

/** A model that returns a fixed value and records what it was asked. */
function fakeModel(value: unknown, servedBy = "fake-model-1") {
  const requests: StructuredRequest[] = [];
  const model: LanguageModel = {
    model: "fake-model-1",
    async generateObject(request) {
      requests.push(request);
      return { value, model: servedBy };
    },
  };
  return { model, requests };
}

const auditOwner = {
  text: "Priya Nair is taking the vendor audit, with a plan due within two weeks.",
  citations: [{ meeting: 1, turn: 31, quote: "I'll take the vendor audit" }],
};
const answered = (sentences: unknown[], gaps: string | null = null) => ({
  status: "answered",
  sentences,
  gaps,
});

describe("answer", () => {
  it("shows the model each meeting's turns, numbered and fenced as data, then the question", async () => {
    const { model, requests } = fakeModel({ status: "not_found", sentences: [], gaps: null });

    await answer(QUESTION, [steering, budget], model);

    expect(requests).toHaveLength(1);
    const prompt = requests[0]?.prompt ?? "";
    expect(prompt).toContain('<meeting number="1" title="AMT-208 steering committee (Oct)">');
    expect(prompt).toContain(
      "[turn 31] [00:04:52] Priya Nair: A for-cause audit before we release the March batch order.",
    );
    expect(prompt).toContain('<meeting number="2" title="Budget review">');
    expect(prompt).toContain("[turn 4] [00:01:35] Sam Okafor: The audit is funded");
    expect(prompt).toContain(`<question>\n${QUESTION}\n</question>`);
    expect(prompt.indexOf("<question>")).toBeGreaterThan(prompt.lastIndexOf("</meeting>"));
    expect(requests[0]?.system).toMatch(/data/);
    // Meeting numbers are the prompt's bookkeeping; a reader knows meetings by title.
    expect(requests[0]?.system).toMatch(/by its title, never by its number/);
    expect(requests[0]?.schema).toMatchObject({ type: "object" });
  });

  it("lists a meeting's extracted records before its turns, each with the turns it rests on", async () => {
    const { model, requests } = fakeModel({ status: "not_found", sentences: [], gaps: null });
    const withRecords: Excerpt = {
      ...steering,
      records: [
        {
          index: 0,
          kind: "action_item",
          summary: "Write the vendor audit plan.",
          owner: "Priya Nair",
          due: "within two weeks",
          citations: [{ turnIndex: 31, quote: "I'll take the vendor audit" }],
        },
        {
          index: 1,
          kind: "decision",
          summary: "A for-cause audit happens before the March batch.",
          owner: null,
          due: null,
          citations: [
            { turnIndex: 31, quote: "A for-cause audit" },
            { turnIndex: 32, quote: "before" },
          ],
        },
      ],
    };

    await answer(QUESTION, [withRecords], model);

    const prompt = requests[0]?.prompt ?? "";
    expect(prompt).toContain(
      "- action item: Write the vendor audit plan. Owner: Priya Nair. Due: within two weeks. [turn 31]",
    );
    expect(prompt).toContain(
      "- decision: A for-cause audit happens before the March batch. [turns 31, 32]",
    );
    expect(prompt.indexOf("<records")).toBeGreaterThan(prompt.indexOf('<meeting number="1"'));
    expect(prompt.indexOf("</records>")).toBeLessThan(prompt.indexOf("[turn 30] "));
    // Records are a summary; the turns are the evidence, and only turns are cited.
    expect(requests[0]?.system).toMatch(/records/);
    expect(requests[0]?.system).toMatch(/cite the turns/i);
  });

  it("marks the turns left out between two excerpted turns", async () => {
    const { model, requests } = fakeModel({ status: "not_found", sentences: [], gaps: null });

    await answer(QUESTION, [steering], model);

    const prompt = requests[0]?.prompt ?? "";
    const gap = prompt.indexOf("[turns 34-42 not shown]");
    expect(gap).toBeGreaterThan(prompt.indexOf("[turn 33] "));
    expect(gap).toBeLessThan(prompt.indexOf("[turn 43] "));
  });

  it("returns the sentences, each citation resolved to its meeting", async () => {
    const funding = {
      text: "It is funded from the budget reallocation.",
      citations: [{ meeting: 2, turn: 4, quote: "funded from the reallocation" }],
    };
    const { model } = fakeModel(answered([auditOwner, funding]), "fake-model-2");

    const result = await answer(QUESTION, [steering, budget], model);

    expect(result).toEqual({
      status: "answered",
      model: "fake-model-2",
      gaps: null,
      sentences: [
        {
          text: auditOwner.text,
          citations: [
            { meetingId: "m-steering", turnIndex: 31, quote: "I'll take the vendor audit" },
          ],
        },
        {
          text: funding.text,
          citations: [
            { meetingId: "m-budget", turnIndex: 4, quote: "funded from the reallocation" },
          ],
        },
      ],
    });
  });

  it("keeps what the excerpts don't cover", async () => {
    const { model } = fakeModel(answered([auditOwner], "The excerpts give no audit date."));

    const result = await answer(QUESTION, [steering], model);

    expect(result).toMatchObject({ status: "answered", gaps: "The excerpts give no audit date." });
  });

  it("says when the excerpts don't answer the question", async () => {
    const { model } = fakeModel({ status: "not_found", sentences: [], gaps: null });

    expect(await answer("What is the audit budget?", [steering], model)).toEqual({
      status: "not_found",
      model: "fake-model-1",
    });
  });

  it("does not call the model when nothing was retrieved", async () => {
    const { model, requests } = fakeModel(answered([auditOwner]));

    expect(await answer(QUESTION, [], model)).toEqual({ status: "not_found", model: null });
    expect(requests).toHaveLength(0);
  });

  const cite = (meeting: number, turn: number, quote: string) => ({
    text: "Priya Nair is taking the vendor audit.",
    citations: [{ meeting, turn, quote }],
  });

  it.each([
    [
      "quotes words the cited turn does not contain",
      answered([cite(1, 30, "I'll take the vendor audit")]),
      /not found in turn 30 of meeting 1/,
    ],
    [
      "cites a turn of the meeting it was not shown",
      answered([cite(1, 5, "Brackenford")]),
      /turn 5 of meeting 1 was not in the excerpts/,
    ],
    [
      "cites a meeting it was not shown",
      answered([cite(3, 31, "I'll take the vendor audit")]),
      /meeting 3 was not in the excerpts/,
    ],
    [
      "has a sentence with no citation",
      answered([auditOwner, { text: "The audit is next month.", citations: [] }]),
      /sentence 2 has no citation/,
    ],
    ["answers with no sentences", answered([]), /no sentences/],
    [
      "says not found but answers anyway",
      { status: "not_found", sentences: [auditOwner], gaps: null },
      /not_found with sentences/,
    ],
    ["is not an answer at all", { records: [] }, /status/],
  ])("rejects the whole answer when it %s", async (_, output, reason) => {
    const { model } = fakeModel(output);

    const result = await answer(QUESTION, [steering], model);

    expect(result).toMatchObject({ status: "rejected", output, model: "fake-model-1" });
    expect(result.status === "rejected" && result.reason).toMatch(reason);
  });
});
