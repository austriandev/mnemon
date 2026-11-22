import type { Chunk, Turn } from "@mnemon/core";

// Row shapes and their mapping to domain types. The one place snake_case meets camelCase.

export interface MeetingRow {
  id: string;
  title: string;
  source_text: string;
  source_sha256: string;
  embedding_model: string;
  created_at: Date;
}

export interface TurnRow {
  meeting_id: string;
  turn_index: number;
  speaker: string;
  start_seconds: number;
  text: string;
  source_line_start: number;
  source_line_end: number;
}

export interface ChunkRow {
  meeting_id: string;
  chunk_index: number;
  first_turn: number;
  last_turn: number;
  start_seconds: number;
  end_seconds: number;
  speakers: string[];
  text: string;
  token_count: number;
  oversize: boolean;
}

export function turnRow(meetingId: string, t: Turn): TurnRow {
  return {
    meeting_id: meetingId,
    turn_index: t.index,
    speaker: t.speaker,
    start_seconds: t.startSeconds,
    text: t.text,
    source_line_start: t.sourceLines.start,
    source_line_end: t.sourceLines.end,
  };
}

export function toTurn(r: TurnRow): Turn {
  return {
    index: r.turn_index,
    speaker: r.speaker,
    startSeconds: r.start_seconds,
    text: r.text,
    sourceLines: { start: r.source_line_start, end: r.source_line_end },
  };
}

export function chunkRow(
  meetingId: string,
  c: Chunk,
  embedding: readonly number[],
): ChunkRow & { embedding: string } {
  return {
    meeting_id: meetingId,
    chunk_index: c.index,
    first_turn: c.turnRange.first,
    last_turn: c.turnRange.last,
    start_seconds: c.startSeconds,
    end_seconds: c.endSeconds,
    speakers: [...c.speakers],
    text: c.text,
    token_count: c.tokenCount,
    oversize: c.oversize,
    embedding: toVectorLiteral(embedding),
  };
}

/** pgvector's text form, e.g. "[0.1,0.2]". */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/** Columns needed to rebuild a Chunk, for select lists. */
export const CHUNK_COLUMNS = [
  "chunk_index",
  "first_turn",
  "last_turn",
  "start_seconds",
  "end_seconds",
  "speakers",
  "text",
  "token_count",
  "oversize",
] as const;

export function toChunk(r: ChunkRow): Chunk {
  return {
    index: r.chunk_index,
    turnRange: { first: r.first_turn, last: r.last_turn },
    startSeconds: r.start_seconds,
    endSeconds: r.end_seconds,
    speakers: r.speakers,
    text: r.text,
    tokenCount: r.token_count,
    oversize: r.oversize,
  };
}
