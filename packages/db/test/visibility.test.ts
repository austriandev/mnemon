import { chunkTurns, type MeetingRecord, parseTranscript } from "@mnemon/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChunkSearch, createMeetingStore, type Visibility } from "../src/index.ts";
import { migrate } from "../src/migrate.ts";
import { createTestDatabase, fakeEmbeddings, unitVector } from "./test-database.ts";

// Common meetings (seeded, no owner) are seen by everyone; a meeting added under an
// access code is seen only under that code. Operator tools see everything.
const ALL: Visibility = { kind: "all" };
const asCode = (owner: string | null): Visibility => ({ kind: "viewer", owner });

function meeting(title: string, line: string) {
  const source = `[00:00:05] Dana Wu: ${line}`;
  const parsed = parseTranscript(source);
  if (!parsed.ok) throw new Error("fixture must parse");
  const chunks = chunkTurns(parsed.turns);
  const records: MeetingRecord[] = [
    {
      index: 0,
      kind: "decision",
      summary: line,
      owner: null,
      due: null,
      citations: [{ turnIndex: 0, quote: line }],
    },
  ];
  return {
    title,
    source,
    turns: parsed.turns,
    chunks,
    embeddings: fakeEmbeddings(chunks.length),
    records: { model: "fake-llm-1", items: records },
  };
}

describe("visibility", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let common: string;
  let ofA: string;
  let ofB: string;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDatabase());
    await migrate(sql);
    ({ id: common } = await createMeetingStore(sql, ALL).save(
      meeting("Seeded", "The zephyr protocol is approved for everyone."),
    ));
    ({ id: ofA } = await createMeetingStore(sql, asCode("reviewer-a")).save(
      meeting("A's private", "The quokka budget stays with reviewer A."),
    ));
    ({ id: ofB } = await createMeetingStore(sql, asCode("reviewer-b")).save(
      meeting("B's private", "The narwhal launch is reviewer B's alone."),
    ));
  });
  afterAll(async () => drop());

  it("lists the common meetings and the code's own, never another code's", async () => {
    const titles = async (v: Visibility) =>
      (await createMeetingStore(sql, v).list()).map((m) => m.title).sort();

    expect(await titles(asCode("reviewer-a"))).toEqual(["A's private", "Seeded"]);
    expect(await titles(asCode("reviewer-b"))).toEqual(["B's private", "Seeded"]);
    expect(await titles(asCode(null))).toEqual(["Seeded"]);
    expect(await titles(ALL)).toEqual(["A's private", "B's private", "Seeded"]);
  });

  it("reads another code's meeting as if it did not exist", async () => {
    const asB = createMeetingStore(sql, asCode("reviewer-b"));

    expect(await asB.get(ofA)).toBeUndefined();
    expect(await asB.excerpt(ofA, [0])).toBeUndefined();
    expect(await asB.records(ofA)).toEqual([]);
    expect((await asB.get(common))?.title).toBe("Seeded");
    expect((await asB.get(ofB))?.title).toBe("B's private");
  });

  it("never retrieves another code's chunks, by keyword or by vector", async () => {
    const searchAs = (v: Visibility) => createChunkSearch(sql, v);
    const meetings = (hits: { meetingId: string }[]) => hits.map((h) => h.meetingId).sort();
    const everything = { limit: 10 };

    const keywordB = await searchAs(asCode("reviewer-b")).keyword(
      "quokka budget zephyr narwhal",
      everything,
    );
    const vectorB = await searchAs(asCode("reviewer-b")).vector(unitVector(0), {
      ...everything,
      model: "fake-embed-1",
    });
    const keywordAll = await searchAs(ALL).keyword("quokka budget zephyr narwhal", everything);

    expect(meetings(keywordB)).toEqual([common, ofB].sort());
    expect(meetings(vectorB)).toEqual([common, ofB].sort());
    expect(meetings(keywordAll)).toEqual([common, ofA, ofB].sort());
    // Asking for another code's meeting by id finds nothing, rather than its chunks.
    expect(
      await searchAs(asCode("reviewer-b")).keyword("quokka", { limit: 5, meetingId: ofA }),
    ).toEqual([]);
  });

  it("lets a code add a transcript another code holds privately, as its own copy", async () => {
    const asB = createMeetingStore(sql, asCode("reviewer-b"));
    const same = meeting("A's private, added by B", "The quokka budget stays with reviewer A.");

    expect(await asB.findBySource(same.source)).toBeUndefined();
    const saved = await asB.save(same);

    expect(saved.created).toBe(true);
    expect(saved.id).not.toBe(ofA);
    expect((await asB.get(saved.id))?.title).toBe("A's private, added by B");
  });

  it("finds a common transcript for every code, so no one stores a second copy of it", async () => {
    const asA = createMeetingStore(sql, asCode("reviewer-a"));
    const seeded = meeting("Seeded again", "The zephyr protocol is approved for everyone.");

    expect((await asA.findBySource(seeded.source))?.id).toBe(common);
    expect(await asA.save(seeded)).toEqual({ id: common, created: false });
  });
});
