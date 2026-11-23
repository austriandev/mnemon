import { describe, expect, it } from "vitest";
import {
  ask,
  type Chunk,
  type ChunkSearch,
  type Embedder,
  type Excerpt,
  type LanguageModel,
  type MeetingRecord,
  type SearchHit,
  type StructuredRequest,
  type TranscriptSource,
  type Turn,
} from "../src/index.ts";

const turn = (index: number, text: string): Turn => ({
  index,
  speaker: "Priya Nair",
  startSeconds: index * 10,
  text,
  sourceLines: { start: index + 1, end: index + 1 },
});

function hit(meetingId: string, index: number, first: number, last: number): SearchHit {
  const chunk: Chunk = {
    index,
    turnRange: { first, last },
    startSeconds: first * 10,
    endSeconds: last * 10,
    speakers: ["Priya Nair"],
    text: "rendered chunk text",
    tokenCount: 10,
    oversize: false,
  };
  return { meetingId, chunk };
}

const shipLetter: MeetingRecord = {
  index: 0,
  kind: "action_item",
  summary: "Send the notice letter.",
  owner: "Priya Nair",
  due: "by Friday",
  citations: [{ turnIndex: 5, quote: "A says 5" }],
};

/** Two stored meetings, a search that returns canned hits, and a model with a fixed answer. */
function world(hits: SearchHit[], output: unknown, records: Record<string, MeetingRecord[]> = {}) {
  const meetings: Record<string, { title: string; turns: Turn[] }> = {
    "m-a": { title: "Meeting A", turns: [0, 1, 2, 3, 4, 5].map((i) => turn(i, `A says ${i}`)) },
    "m-b": { title: "Meeting B", turns: [0, 1, 2].map((i) => turn(i, `B says ${i}`)) },
  };
  const excerptCalls: [string, number[]][] = [];
  const transcripts: TranscriptSource = {
    async excerpt(meetingId, indices) {
      excerptCalls.push([meetingId, [...indices]]);
      const m = meetings[meetingId];
      return (
        m && { meetingId, title: m.title, turns: m.turns.filter((t) => indices.includes(t.index)) }
      );
    },
    async records(meetingId) {
      return records[meetingId] ?? [];
    },
  };
  const embedder: Embedder = {
    model: "fake-embed-1",
    dimensions: 3,
    async embed(texts) {
      return { vectors: texts.map(() => [0.1, 0.2, 0.3]), tokens: 5 };
    },
  };
  const search: ChunkSearch = {
    async keyword() {
      return hits;
    },
    async vector() {
      return hits;
    },
  };
  const requests: StructuredRequest[] = [];
  const model: LanguageModel = {
    model: "fake-model-1",
    async generateObject(request) {
      requests.push(request);
      return { value: output, model: "fake-model-1" };
    },
  };
  return { deps: { embedder, search, transcripts, model }, excerptCalls, requests };
}

describe("ask", () => {
  it("answers from the turns of the retrieved chunks, meeting by meeting in rank order", async () => {
    const output = {
      status: "answered",
      sentences: [{ text: "B says so.", citations: [{ meeting: 1, turn: 1, quote: "B says 1" }] }],
      gaps: null,
    };
    // Best first: a chunk of B, then two overlapping chunks of A.
    const { deps, excerptCalls, requests } = world(
      [hit("m-b", 0, 0, 1), hit("m-a", 1, 2, 4), hit("m-a", 0, 1, 2)],
      output,
    );

    const result = await ask("What does B say?", deps);

    expect(excerptCalls).toEqual([
      ["m-b", [0, 1]],
      ["m-a", [1, 2, 3, 4]],
    ]);
    expect(result.excerpts.map((e: Excerpt) => [e.title, e.turns.map((t) => t.index)])).toEqual([
      ["Meeting B", [0, 1]],
      ["Meeting A", [1, 2, 3, 4]],
    ]);
    expect(result.retrieved.map((r) => [r.meetingId, r.chunk.index])).toEqual([
      ["m-b", 0],
      ["m-a", 1],
      ["m-a", 0],
    ]);
    expect(result.embeddingTokens).toBe(5);
    expect(requests[0]?.prompt).toContain('<meeting number="1" title="Meeting B">');
    expect(result.answer).toEqual({
      status: "answered",
      model: "fake-model-1",
      gaps: null,
      sentences: [
        { text: "B says so.", citations: [{ meetingId: "m-b", turnIndex: 1, quote: "B says 1" }] },
      ],
    });
  });

  it("says not found without calling the model when retrieval finds nothing", async () => {
    const { deps, excerptCalls, requests } = world([], { status: "not_found" });

    const result = await ask("Anything?", deps);

    expect(result.answer).toEqual({ status: "not_found", model: null });
    expect(excerptCalls).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("shows each meeting's extracted records, and the turns they cite, beside the retrieved turns", async () => {
    // Retrieval finds turns 1-2 of A; A's records cite turn 5, which retrieval missed.
    const { deps, excerptCalls, requests } = world(
      [hit("m-a", 0, 1, 2)],
      { status: "not_found", sentences: [], gaps: null },
      { "m-a": [shipLetter] },
    );

    const result = await ask("List every action item.", deps);

    expect(excerptCalls).toEqual([["m-a", [1, 2, 5]]]);
    expect(result.excerpts[0]?.records).toEqual([shipLetter]);
    expect(requests[0]?.prompt).toContain("Send the notice letter.");
  });

  it("answers from the retrieved turns alone when records are turned off", async () => {
    const { deps, excerptCalls, requests } = world(
      [hit("m-a", 0, 1, 2)],
      { status: "not_found", sentences: [], gaps: null },
      { "m-a": [shipLetter] },
    );

    const result = await ask("List every action item.", { ...deps, records: false });

    expect(excerptCalls).toEqual([["m-a", [1, 2]]]);
    expect(result.excerpts[0]?.records).toBeUndefined();
    expect(requests[0]?.prompt).not.toContain("<records");
  });
});
