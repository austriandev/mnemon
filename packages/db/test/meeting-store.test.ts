import { readFileSync } from "node:fs";
import { chunkTurns, type MeetingRecord, parseTranscript, type Turn } from "@mnemon/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMeetingStore, type MeetingStore, migrate } from "../src/index.ts";
import { createTestDatabase, fakeEmbeddings } from "./test-database.ts";

const source = readFileSync(
  new URL("../../core/fixtures/steering-committee.txt", import.meta.url),
  "utf8",
);
const parsed = parseTranscript(source);
if (!parsed.ok) throw new Error("fixture must parse");
const turns = parsed.turns;
const chunks = chunkTurns(turns);
const embeddings = fakeEmbeddings(chunks.length);

const records: MeetingRecord[] = [
  {
    index: 0,
    kind: "decision",
    summary: "Dosing stays at 20 mg until the DMC review.",
    owner: null,
    due: null,
    citations: [{ turnIndex: 22, quote: "dosing stays at 20 mg for all new patients" }],
  },
  {
    index: 1,
    kind: "action_item",
    summary: "Prepare listings and narratives for the three cases.",
    owner: "Dr. Hana Sato",
    due: "by Friday",
    citations: [
      { turnIndex: 23, quote: "I'll prepare the patient listings" },
      { turnIndex: 23, quote: "by Friday" },
    ],
  },
];

/** A distinct one-turn meeting, so tests that save don't collide on the source hash. */
function oneTurnMeeting(source: string) {
  const turn = turns[0] as Turn;
  return { source, turns: [turn], chunks: chunkTurns([turn]), embeddings: fakeEmbeddings(1) };
}

describe("meeting store", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let store: MeetingStore;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDatabase());
    await migrate(sql);
    store = createMeetingStore(sql);
  });
  afterAll(async () => {
    await drop();
  });

  it("returns a saved meeting with its transcript, turns and chunks unchanged", async () => {
    const { id } = await store.save({
      title: "AMT-208 steering committee",
      source,
      turns,
      chunks,
      embeddings,
    });

    const meeting = await store.get(id);

    expect(meeting).toMatchObject({
      id,
      title: "AMT-208 steering committee",
      sourceText: source,
      sourceSha256: "e142e42eb70c2958070dac30bb8abf0081bd62eac33e26c829b5692ff6d2b160",
      embeddingModel: "fake-embed-1",
    });
    expect(meeting?.createdAt).toBeInstanceOf(Date);
    expect(meeting?.turns).toEqual(turns);
    expect(meeting?.chunks).toEqual(chunks);
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-uuid"],
  ])("returns undefined for %s", async (_, id) => {
    expect(await store.get(id)).toBeUndefined();
  });

  it("lists meetings newest first, with their turn counts", async () => {
    const second = await store.save({
      title: "Follow-up",
      source: "[00:00:01] Dana Wu: Quick check-in.",
      turns: [turns[0] as Turn],
      chunks: chunkTurns([turns[0] as Turn]),
      embeddings: fakeEmbeddings(1),
    });

    const listed = await store.list();

    expect(listed.map((m) => [m.title, m.turnCount])).toEqual([
      ["Follow-up", 1],
      ["AMT-208 steering committee", 47],
    ]);
    expect(listed[0]?.id).toBe(second.id);
  });

  it("saves nothing when any part of the meeting is rejected", async () => {
    const before = await store.list();
    const chunkCitingAMissingTurn = { ...chunks[0], turnRange: { first: 0, last: 999 } };

    await expect(
      store.save({
        title: "Broken",
        source: "[00:00:01] Dana Wu: A meeting that fails to save.",
        turns,
        chunks: [chunkCitingAMissingTurn as (typeof chunks)[number]],
        embeddings: fakeEmbeddings(1),
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(before);
  });

  it("returns the first meeting, and stores no copy, when the same transcript is saved again", async () => {
    const copy = `${source}\n[00:07:00] Dana Wu: Re-sent for the minutes.`;
    const first = await store.save({ title: "Original", source: copy, turns, chunks, embeddings });
    const before = await store.list();

    const again = await store.save({ title: "Re-upload", source: copy, turns, chunks, embeddings });

    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(await store.list()).toEqual(before);
    expect((await store.get(first.id))?.title).toBe("Original");
  });

  it("finds a stored meeting by its exact transcript", async () => {
    const source2 = "[00:00:01] Dana Wu: Only this one line.";
    expect(await store.findBySource(source2)).toBeUndefined();
    const { id } = await store.save({
      title: "One line",
      source: source2,
      turns: [turns[0] as Turn],
      chunks: chunkTurns([turns[0] as Turn]),
      embeddings: fakeEmbeddings(1),
    });

    expect(await store.findBySource(source2)).toEqual({
      id,
      title: "One line",
      recordsModel: null,
    });
    // One changed byte is a different transcript.
    expect(await store.findBySource(`${source2} `)).toBeUndefined();
  });

  it("returns a meeting's records and their citations as saved, with the model that made them", async () => {
    const { id } = await store.save({
      title: "With records",
      source: `${source}\n[00:07:10] Dana Wu: With records.`,
      turns,
      chunks,
      embeddings,
      records: { model: "fake-llm-1", items: records },
    });

    const meeting = await store.get(id);

    expect(meeting?.recordsModel).toBe("fake-llm-1");
    expect(meeting?.records).toEqual(records);
  });

  it("marks a meeting saved without extraction as having no records yet", async () => {
    const { id } = await store.save({
      title: "No extraction",
      ...oneTurnMeeting("[00:00:01] A: b."),
    });

    const meeting = await store.get(id);

    expect(meeting?.recordsModel).toBeNull();
    expect(meeting?.records).toEqual([]);
    expect(await store.findBySource("[00:00:01] A: b.")).toEqual({
      id,
      title: "No extraction",
      recordsModel: null,
    });
  });

  it("adds records to a meeting stored before extraction, once", async () => {
    const { id } = await store.save({ title: "Backfill", ...oneTurnMeeting("[00:00:01] B: c.") });
    const first = {
      ...(records[0] as MeetingRecord),
      citations: [{ turnIndex: 0, quote: "Good" }],
    };

    await store.addRecords(id, { model: "fake-llm-1", items: [first] });

    expect((await store.get(id))?.records).toEqual([first]);
    await expect(store.addRecords(id, { model: "fake-llm-1", items: [first] })).rejects.toThrow(
      /already has records/,
    );
  });

  it("refuses a record citing a turn the meeting does not have, and saves nothing", async () => {
    const before = await store.list();
    const bad = { ...(records[0] as MeetingRecord), citations: [{ turnIndex: 999, quote: "x" }] };

    await expect(
      store.save({
        title: "Bad citation",
        ...oneTurnMeeting("[00:00:01] C: d."),
        records: { model: "fake-llm-1", items: [bad] },
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(before);
  });

  it("refuses embeddings that don't match the chunks one to one", async () => {
    await expect(
      store.save({ title: "Mismatch", source, turns, chunks, embeddings: fakeEmbeddings(1) }),
    ).rejects.toThrow(/5 chunks.*1 embedding/);
  });
});
