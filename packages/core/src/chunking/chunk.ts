import type { Turn } from "../transcript/types.ts";
import { approximateTokenCounter } from "./tokens.ts";
import type { Chunk, ChunkOptions } from "./types.ts";

/**
 * Provisional defaults, to be settled by the retrieval eval and recorded in
 * ADR-0003. Until then they are a reasoned guess, not a measured choice.
 */
export const DEFAULT_CHUNK_OPTIONS = { maxTokens: 300, overlapTurns: 1 } as const;

/**
 * Groups a meeting's turns into chunks of whole, consecutive turns.
 *
 * Expects turns in meeting order, as `parseTranscript` returns them. Each chunk
 * stays within `maxTokens` unless it is a single oversize turn. Consecutive chunks
 * share `overlapTurns` turns, fewer only when the previous chunk is shorter than
 * that or when carrying them all would push the next turn over budget.
 *
 * @throws RangeError when `maxTokens` is not a positive integer or `overlapTurns`
 *   is not a non-negative integer: those are programming errors, not bad input.
 */
export function chunkTurns(turns: readonly Turn[], options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_CHUNK_OPTIONS.maxTokens;
  const overlapTurns = options.overlapTurns ?? DEFAULT_CHUNK_OPTIONS.overlapTurns;
  const counter = options.tokenCounter ?? approximateTokenCounter;
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new RangeError(`maxTokens must be a positive integer, got ${maxTokens}`);
  }
  if (!Number.isInteger(overlapTurns) || overlapTurns < 0) {
    throw new RangeError(`overlapTurns must be a non-negative integer, got ${overlapTurns}`);
  }
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
