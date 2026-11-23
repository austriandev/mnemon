import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Embedder,
  type LanguageModel,
  type MeetingRepository,
  type NewMeeting,
  type NewRecords,
  planIngest,
  runIngest,
} from "../src/index.ts";

const source = readFileSync(new URL("../fixtures/steering-committee.txt", import.meta.url), "utf8");

const doseHold = {
  kind: "decision",
  summary: "Dosing stays at 20 mg until the DMC review.",
  owner: null,
  due: null,
  citations: [{ turn: 22, quote: "dosing stays at 20 mg for all new patients" }],
};

/** An in-memory repository, embedder and model that record every call. */
function world(stored?: { id: string; title: string; recordsModel: string | null }) {
  const calls: string[] = [];
  const saved: NewMeeting[] = [];
  const added: [string, NewRecords][] = [];
  const repository: MeetingRepository = {
    async findBySource() {
      calls.push("findBySource");
      return stored;
    },
    async save(meeting) {
      calls.push("save");
      saved.push(meeting);
      return { id: "m-new", created: true };
    },
    async addRecords(id, records) {
      calls.push("addRecords");
      added.push([id, records]);
    },
  };
  const embedder: Embedder = {
    model: "fake-embed-1",
    dimensions: 2,
    async embed(texts) {
      calls.push(`embed:${texts.length}`);
      return { vectors: texts.map(() => [0.5, 0.5]), tokens: 120 };
    },
  };
  let output: unknown = { records: [doseHold] };
  const model: LanguageModel = {
    model: "fake-model-1",
    async generateObject() {
      calls.push("extract");
      if (output instanceof Error) throw output;
      return { value: output, model: "fake-model-2" };
    },
  };
  const failExtraction = (error: Error) => {
    output = error;
  };
  return { deps: { repository, embedder, model }, calls, saved, added, failExtraction };
}

describe("planIngest", () => {
  it("plans a new transcript: parse, chunk, then extract and embed", async () => {
    const { deps, calls } = world();

    const plan = await planIngest(source, "AMT-208 (Oct)", deps.repository);

    expect(plan).toMatchObject({ kind: "new", title: "AMT-208 (Oct)" });
    expect(plan.kind === "new" && [plan.turns.length, plan.chunks.length]).toEqual([47, 5]);
    expect(calls).toEqual(["findBySource"]);
  });

  it("plans nothing for a transcript already stored with its records", async () => {
    const { deps } = world({ id: "m-1", title: "Oct", recordsModel: "claude-sonnet-5-5" });

    expect(await planIngest(source, "ignored", deps.repository)).toEqual({
      kind: "unchanged",
      meeting: { id: "m-1", title: "Oct" },
    });
  });

  it("plans extraction only for a transcript stored before extraction existed", async () => {
    const { deps } = world({ id: "m-1", title: "Oct", recordsModel: null });

    const plan = await planIngest(source, "ignored", deps.repository);

    expect(plan).toMatchObject({ kind: "extract-only", meeting: { id: "m-1", title: "Oct" } });
  });

  it.each([
    ["an empty", ""],
    ["a blank", "   "],
  ])("rejects %s title before anything is paid for", async (_, title) => {
    const { deps, calls } = world();

    const plan = await planIngest(source, title, deps.repository);

    expect(plan).toMatchObject({ kind: "invalid", errors: [{ code: "empty-title" }] });
    expect(calls).toEqual([]);
  });

  it("trims the title", async () => {
    const { deps } = world();

    const plan = await planIngest(source, "  AMT-208 (Oct) ", deps.repository);

    expect(plan).toMatchObject({ kind: "new", title: "AMT-208 (Oct)" });
  });

  it("rejects a malformed transcript without touching the repository", async () => {
    const { deps, calls } = world();

    const plan = await planIngest("not a transcript", "x", deps.repository);

    expect(plan).toMatchObject({ kind: "invalid" });
    expect(plan.kind === "invalid" && plan.errors.length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});

describe("runIngest", () => {
  it("extracts, then embeds, then saves the meeting with its records in one call", async () => {
    const { deps, calls, saved } = world();
    const plan = await planIngest(source, "AMT-208 (Oct)", deps.repository);

    const result = await runIngest(plan, deps);

    expect(calls).toEqual(["findBySource", "extract", "embed:5", "save"]);
    expect(saved[0]).toMatchObject({
      title: "AMT-208 (Oct)",
      source,
      embeddings: { model: "fake-embed-1" },
      records: { model: "fake-model-2", items: [{ kind: "decision", owner: null }] },
    });
    expect(saved[0]?.embeddings.vectors).toHaveLength(5);
    expect(result).toMatchObject({
      kind: "stored",
      id: "m-new",
      embeddingTokens: 120,
      extraction: { model: "fake-model-2", rejected: [] },
    });
  });

  it("backfills records without embedding again", async () => {
    const { deps, calls, added } = world({ id: "m-1", title: "Oct", recordsModel: null });
    const plan = await planIngest(source, "ignored", deps.repository);

    const result = await runIngest(plan, deps);

    expect(calls).toEqual(["findBySource", "extract", "addRecords"]);
    expect(added[0]?.[0]).toBe("m-1");
    expect(result).toMatchObject({ kind: "backfilled", id: "m-1" });
  });

  it("does nothing for an unchanged meeting", async () => {
    const { deps, calls } = world({ id: "m-1", title: "Oct", recordsModel: "m" });
    const plan = await planIngest(source, "ignored", deps.repository);

    expect(await runIngest(plan, deps)).toEqual({ kind: "unchanged", id: "m-1", title: "Oct" });
    expect(calls).toEqual(["findBySource"]);
  });

  it("pays for no embedding and saves nothing when extraction fails", async () => {
    const { deps, calls, failExtraction } = world();
    failExtraction(new Error("Claude declined the request"));
    const plan = await planIngest(source, "Oct", deps.repository);

    await expect(runIngest(plan, deps)).rejects.toThrow("Claude declined");
    expect(calls).toEqual(["findBySource", "extract"]);
  });

  it("refuses to run an invalid plan", async () => {
    const { deps } = world();
    const plan = await planIngest("not a transcript", "x", deps.repository);

    await expect(runIngest(plan, deps)).rejects.toThrow(/plan is invalid/);
  });
});
