import { readFileSync } from "node:fs";
import { type MeetingRepository, planIngest } from "@mnemon/core";
import { describe, expect, it } from "vitest";
import { planCostUsd, presentPlan, readSubmission } from "../src/server/add-meeting.ts";

const source = readFileSync(
  new URL("../../../packages/core/fixtures/steering-committee.txt", import.meta.url),
  "utf8",
);

const repository = (
  stored?: Awaited<ReturnType<MeetingRepository["findBySource"]>>,
): MeetingRepository => ({
  findBySource: async () => stored,
  save: async () => ({ id: "m-new", created: true }),
  addRecords: async () => {},
  setHeldOn: async () => {},
});

describe("planCostUsd", () => {
  it("prices what the plan will pay for, as the budget check needs it", async () => {
    const fresh = await planIngest(source, "Oct", repository());
    const stored = await planIngest(
      source,
      "Oct",
      repository({ id: "m-1", title: "Oct", recordsModel: "claude-sonnet-5-5" }),
    );

    expect(planCostUsd(fresh)).toBeGreaterThan(0.065);
    expect(planCostUsd(fresh)).toBeLessThan(0.075);
    expect(planCostUsd(stored)).toBe(0);
  });
});

describe("presentPlan", () => {
  it("shows a new meeting's size and its cost before anything is paid", async () => {
    const plan = await planIngest(source, "AMT-208 (Oct)", repository());

    expect(presentPlan(plan)).toEqual({
      kind: "ready",
      title: "AMT-208 (Oct)",
      turns: 47,
      speakers: 6,
      embedded: false,
      cost: "about $0.07",
    });
  });

  it("points to a meeting that is already stored, at no cost", async () => {
    const plan = await planIngest(
      source,
      "x",
      repository({ id: "m-1", title: "Oct", recordsModel: "claude-sonnet-5-5" }),
    );

    expect(presentPlan(plan)).toEqual({ kind: "unchanged", id: "m-1", title: "Oct" });
  });

  it("lists every problem with its line, so the transcript can be fixed", async () => {
    const plan = await planIngest(
      "[00:00:01] Dana Wu: Hello.\n[00:61:00] Sam: Hi.",
      "",
      repository(),
    );

    expect(presentPlan(plan)).toEqual({
      kind: "invalid",
      problems: [
        { line: 2, message: expect.stringContaining("not a valid") },
        { line: null, message: "The meeting needs a title." },
      ],
    });
  });
});

describe("readSubmission", () => {
  const form = (fields: Record<string, string | File>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("takes the pasted transcript as it is, and trims the title", async () => {
    expect(await readSubmission(form({ title: " Oct ", source: "[00:00:01] A: b\n" }))).toEqual({
      ok: true,
      title: "Oct",
      source: "[00:00:01] A: b\n",
    });
  });

  it("passes on the day the meeting was held, when given", async () => {
    expect(
      await readSubmission(form({ title: "Oct", source: "[00:00:01] A: b", heldOn: "2026-10-15" })),
    ).toEqual({ ok: true, title: "Oct", source: "[00:00:01] A: b", heldOn: "2026-10-15" });
  });

  it("reads an uploaded file when nothing was pasted", async () => {
    const file = new File(["[00:00:01] A: b"], "oct.txt", { type: "text/plain" });

    expect(await readSubmission(form({ title: "Oct", source: "", file }))).toMatchObject({
      ok: true,
      source: "[00:00:01] A: b",
    });
  });

  it("refuses a transcript over the size limit before reading it into a plan", async () => {
    const big = "x".repeat(512 * 1024 + 1);

    expect(await readSubmission(form({ title: "Oct", source: big }))).toEqual({
      ok: false,
      message: "The transcript is over 512 KB. Split it, or ingest it with pnpm ingest.",
    });
  });

  it("asks for a transcript when there is none", async () => {
    expect(await readSubmission(form({ title: "Oct", source: "  " }))).toEqual({
      ok: false,
      message: "Paste a transcript or choose a .txt file.",
    });
  });
});
