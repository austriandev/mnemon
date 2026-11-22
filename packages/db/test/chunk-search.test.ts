import { readFileSync } from "node:fs";
import { type ChunkSearch, chunkTurns, parseTranscript } from "@mnemon/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChunkSearch, createMeetingStore, migrate } from "../src/index.ts";
import { createTestDatabase, fakeEmbeddings, unitVector } from "./test-database.ts";

const source = readFileSync(
  new URL("../../core/fixtures/steering-committee.txt", import.meta.url),
  "utf8",
);
const parsed = parseTranscript(source);
if (!parsed.ok) throw new Error("fixture must parse");
// Default chunking gives five chunks over turns 0-8, 8-18, 18-28, 28-39 and 39-46.
const chunks = chunkTurns(parsed.turns);

const budgetSource = "[00:00:01] Sam Okafor: The vendor audit budget is approved.";
const budget = parseTranscript(budgetSource);
if (!budget.ok) throw new Error("must parse");
const budgetChunks = chunkTurns(budget.turns);

describe("chunk search", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let search: ChunkSearch;
  let committee: string;
  let other: string;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDatabase());
    await migrate(sql);
    const store = createMeetingStore(sql);
    ({ id: committee } = await store.save({
      title: "AMT-208 steering committee",
      source,
      turns: parsed.turns,
      chunks,
      embeddings: fakeEmbeddings(chunks.length),
    }));
    ({ id: other } = await store.save({
      title: "Budget sync",
      source: budgetSource,
      turns: budget.turns,
      chunks: budgetChunks,
      embeddings: fakeEmbeddings(1, "fake-embed-2"),
    }));
    search = createChunkSearch(sql);
  });
  afterAll(async () => {
    await drop();
  });

  describe("keyword", () => {
    it("ranks the chunk where the vendor audit is discussed first", async () => {
      const hits = await search.keyword("Who is doing the vendor audit?", {
        limit: 5,
        meetingId: committee,
      });

      // Chunk 3 covers turns 28-39: the fill-finish vendor and the for-cause audit.
      expect(hits[0]?.chunk.index).toBe(3);
      expect(hits[0]?.meetingId).toBe(committee);
    });

    it("matches any of the question's words, not all of them", async () => {
      const hits = await search.keyword("liver enzymes or something else entirely", {
        limit: 5,
        meetingId: committee,
      });

      // No chunk has all the words. Chunk 1 has "liver", "enzyme" and "else" (turns 12
      // and 15); chunk 2 has only "liver" (turn 22, "review of the liver data").
      expect(hits.map((h) => h.chunk.index)).toEqual([1, 2]);
    });

    it("searches every meeting unless scoped to one", async () => {
      const hits = await search.keyword("vendor audit", { limit: 10 });

      expect(new Set(hits.map((h) => h.meetingId))).toEqual(new Set([committee, other]));
    });

    it("returns the stored chunk with its turn range and text", async () => {
      const [hit] = await search.keyword("approved budget", { limit: 1, meetingId: other });

      expect(hit?.chunk).toEqual(budgetChunks[0]);
    });

    it.each([
      ["only stop words", "who is it?"],
      ["only punctuation", "?!' --"],
      ["quotes and backslashes", "I'll \\ 'audit'"],
    ])("copes with a question of %s", async (_, question) => {
      await expect(search.keyword(question, { limit: 5 })).resolves.toBeInstanceOf(Array);
    });
  });

  describe("vector", () => {
    it("ranks chunks by cosine similarity to the query vector", async () => {
      const hits = await search.vector(unitVector(2), {
        limit: 2,
        meetingId: committee,
        model: "fake-embed-1",
      });

      expect(hits[0]?.chunk.index).toBe(2);
      expect(hits).toHaveLength(2);
    });

    it("only compares against chunks embedded by the same model", async () => {
      const hits = await search.vector(unitVector(0), { limit: 10, model: "fake-embed-2" });

      expect(hits.map((h) => h.meetingId)).toEqual([other]);
    });
  });
});
