import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractRecords,
  type LanguageModel,
  parseTranscript,
  type StructuredRequest,
} from "../src/index.ts";

const parsed = parseTranscript(
  readFileSync(new URL("../fixtures/steering-committee.txt", import.meta.url), "utf8"),
);
if (!parsed.ok) throw new Error("fixture must parse");
const turns = parsed.turns;

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

const doseHold = {
  kind: "decision",
  summary: "Dosing stays at 20 mg for new patients until the DMC review of the liver data.",
  owner: null,
  due: null,
  citations: [{ turn: 22, quote: "dosing stays at 20 mg for all new patients" }],
};
const listings = {
  kind: "action_item",
  summary: "Prepare patient listings and narratives for the three cases.",
  owner: "Dr. Hana Sato",
  due: "by Friday",
  citations: [{ turn: 23, quote: "send them to the committee by Friday" }],
};

describe("extractRecords", () => {
  it("shows the model every turn with its index, time and speaker", async () => {
    const { model, requests } = fakeModel({ records: [] });

    await extractRecords(turns, model);

    expect(requests).toHaveLength(1);
    const prompt = requests[0]?.prompt ?? "";
    expect(prompt).toContain(
      "[turn 22] [00:03:39] Dana Wu: Decision, then: dosing stays at 20 mg for all new patients",
    );
    for (const turn of turns) expect(prompt).toContain(`[turn ${turn.index}] `);
    expect(requests[0]?.schema).toMatchObject({ type: "object", required: ["records"] });
  });

  it("returns the records whose citations check out, numbered in order", async () => {
    const { model } = fakeModel({ records: [doseHold, listings] }, "fake-model-2");

    const extraction = await extractRecords(turns, model);

    expect(extraction).toEqual({
      model: "fake-model-2",
      rejected: [],
      records: [
        {
          index: 0,
          kind: "decision",
          summary: doseHold.summary,
          owner: null,
          due: null,
          citations: [{ turnIndex: 22, quote: "dosing stays at 20 mg for all new patients" }],
        },
        {
          index: 1,
          kind: "action_item",
          summary: listings.summary,
          owner: "Dr. Hana Sato",
          due: "by Friday",
          citations: [{ turnIndex: 23, quote: "send them to the committee by Friday" }],
        },
      ],
    });
  });

  it.each([
    [
      "cites a turn that does not exist",
      { ...doseHold, citations: [{ turn: 99, quote: "dosing stays" }] },
      /turn 99 does not exist/,
    ],
    [
      "quotes words the cited turn does not contain",
      { ...doseHold, citations: [{ turn: 21, quote: "dosing stays at 20 mg" }] },
      /not found in turn 21/,
    ],
    ["cites no turn at all", { ...doseHold, citations: [] }, /no citation/],
    ["is an action item without an owner", { ...listings, owner: null }, /no owner/],
    ["has an empty summary", { ...doseHold, summary: "  " }, /empty summary/],
    ["has an unknown kind", { ...doseHold, kind: "risk" }, /kind/],
  ])("rejects, and does not repair, a record that %s", async (_, bad, reason) => {
    const { model } = fakeModel({ records: [listings, bad] });

    const extraction = await extractRecords(turns, model);

    expect(extraction.records.map((r) => r.summary)).toEqual([listings.summary]);
    expect(extraction.rejected).toHaveLength(1);
    expect(extraction.rejected[0]?.output).toEqual(bad);
    expect(extraction.rejected[0]?.reason).toMatch(reason);
  });

  it("fails when the model's output is not a list of records", async () => {
    const { model } = fakeModel({ decisions: [] });

    await expect(extractRecords(turns, model)).rejects.toThrow(/records/);
  });

  it("calls no model for a meeting without turns", async () => {
    const { model, requests } = fakeModel({ records: [] });

    expect(await extractRecords([], model)).toEqual({ records: [], rejected: [], model: null });
    expect(requests).toHaveLength(0);
  });
});
