import { readFileSync } from "node:fs";
import { chunkTurns, parseTranscript, type Turn } from "@mnemon/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMeetingStore, type MeetingStore, migrate } from "../src/index.ts";
import { createTestDatabase } from "./test-database.ts";

const source = readFileSync(
  new URL("../../core/fixtures/steering-committee.txt", import.meta.url),
  "utf8",
);
const parsed = parseTranscript(source);
if (!parsed.ok) throw new Error("fixture must parse");
const turns = parsed.turns;
const chunks = chunkTurns(turns);

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
    const { id } = await store.save({ title: "AMT-208 steering committee", source, turns, chunks });

    const meeting = await store.get(id);

    expect(meeting).toMatchObject({
      id,
      title: "AMT-208 steering committee",
      sourceText: source,
      sourceSha256: "e142e42eb70c2958070dac30bb8abf0081bd62eac33e26c829b5692ff6d2b160",
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
        source,
        turns,
        chunks: [chunkCitingAMissingTurn as (typeof chunks)[number]],
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(before);
  });
});
