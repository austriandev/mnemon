import { describe, expect, it } from "vitest";
import {
  type Chunk,
  type ChunkSearch,
  type Embedder,
  retrieve,
  type SearchHit,
} from "../src/index.ts";

function chunk(index: number, text: string): Chunk {
  return {
    index,
    turnRange: { first: index, last: index },
    startSeconds: index * 60,
    endSeconds: index * 60,
    speakers: ["Priya Nair"],
    text,
    tokenCount: 10,
    oversize: false,
  };
}

const hit = (meetingId: string, index: number): SearchHit => ({
  meetingId,
  chunk: chunk(index, `chunk ${index}`),
});

/** Records what it was asked, and returns canned rankings. */
function fakes(keywordHits: SearchHit[], vectorHits: SearchHit[]) {
  const calls: string[] = [];
  const embedder: Embedder = {
    model: "fake-embed-1",
    dimensions: 3,
    async embed(texts, inputType) {
      calls.push(`embed:${inputType}:${texts.join("|")}`);
      return { vectors: texts.map(() => [0.1, 0.2, 0.3]), tokens: 7 };
    },
  };
  const search: ChunkSearch = {
    async keyword(query, options) {
      calls.push(`keyword:${query}:${options.limit}:${options.meetingId ?? "*"}`);
      return keywordHits.slice(0, options.limit);
    },
    async vector(embedding, options) {
      calls.push(`vector:${embedding.length}:${options.model}:${options.limit}`);
      return vectorHits.slice(0, options.limit);
    },
  };
  return { embedder, search, calls };
}

describe("retrieve", () => {
  it("fuses keyword and vector results, keeping each chunk's rank in both", async () => {
    const { embedder, search } = fakes([hit("m1", 4), hit("m1", 2)], [hit("m1", 2), hit("m1", 7)]);

    const result = await retrieve("Who owns the vendor audit?", { embedder, search });

    expect(
      result.chunks.map((c) => [c.meetingId, c.chunk.index, c.keywordRank, c.vectorRank]),
    ).toEqual([
      ["m1", 2, 2, 1],
      ["m1", 4, 1, null],
      ["m1", 7, null, 2],
    ]);
    expect(result.embeddingTokens).toBe(7);
  });

  it("treats the same chunk index in different meetings as different chunks", async () => {
    const { embedder, search } = fakes([hit("m1", 0)], [hit("m2", 0)]);

    const result = await retrieve("budget", { embedder, search });

    expect(result.chunks.map((c) => c.meetingId)).toEqual(["m1", "m2"]);
  });

  it("embeds the question as a query, searches with the embedder's model, and caps results", async () => {
    const { embedder, search, calls } = fakes(
      [hit("m1", 1), hit("m1", 2), hit("m1", 3)],
      [hit("m1", 4), hit("m1", 5), hit("m1", 6)],
    );

    const result = await retrieve("dose hold", {
      embedder,
      search,
      limit: 2,
      candidates: 3,
      meetingId: "m1",
    });

    expect(calls.sort()).toEqual([
      "embed:query:dose hold",
      "keyword:dose hold:3:m1",
      "vector:3:fake-embed-1:3",
    ]);
    expect(result.chunks).toHaveLength(2);
  });

  it("returns nothing, without calling the embedder, for a blank question", async () => {
    const { embedder, search, calls } = fakes([hit("m1", 1)], [hit("m1", 1)]);

    expect(await retrieve("   ", { embedder, search })).toEqual({ chunks: [], embeddingTokens: 0 });
    expect(calls).toEqual([]);
  });
});
