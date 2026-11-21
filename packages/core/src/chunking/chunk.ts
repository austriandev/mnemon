import type { Turn } from "../transcript/types.ts";
import type { Chunk, ChunkOptions } from "./types.ts";

export function chunkTurns(turns: readonly Turn[], options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 300;
  const overlapTurns = options.overlapTurns ?? 1;
  const counter = options.tokenCounter ?? { count: (text: string) => Math.ceil(text.length / 4) };
  const cost = (from: number, to: number) => counter.count(render(turns.slice(from, to + 1)));

  const chunks: Chunk[] = [];
  let start = 0;
  // The first turn the next chunk must include, so every chunk adds a new turn.
  let mustReach = 0;
  while (mustReach < turns.length) {
    let end = mustReach;
    while (end + 1 < turns.length && cost(start, end + 1) <= maxTokens) end++;
    const tokenCount = cost(start, end);
    const oversize = start === end && tokenCount > maxTokens;
    chunks.push(buildChunk(chunks.length, turns.slice(start, end + 1), tokenCount, oversize));
    mustReach = end + 1;
    // Carry up to overlapTurns turns, but never the whole previous chunk, and fewer
    // when the carried turns plus the next new turn would not fit the budget.
    let overlap = Math.min(overlapTurns, end - start);
    while (overlap > 0 && cost(mustReach - overlap, mustReach) > maxTokens) overlap--;
    start = mustReach - overlap;
  }
  return chunks;
}

function buildChunk(
  index: number,
  turns: readonly Turn[],
  tokenCount: number,
  oversize: boolean,
): Chunk {
  const first = turns[0] as Turn;
  const last = turns.at(-1) as Turn;
  return {
    index,
    turnRange: { first: first.index, last: last.index },
    startSeconds: first.startSeconds,
    endSeconds: last.startSeconds,
    speakers: [...new Set(turns.map((t) => t.speaker))],
    text: render(turns),
    tokenCount,
    oversize,
  };
}

function render(turns: readonly Turn[]): string {
  return turns
    .map((turn) => `[${formatTimestamp(turn.startSeconds)}] ${turn.speaker}: ${turn.text}`)
    .join("\n");
}

function formatTimestamp(totalSeconds: number): string {
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}
