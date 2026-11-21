import { createHash } from "node:crypto";
import type { Chunk, Turn } from "@mnemon/core";
import type { Sql } from "postgres";

export interface NewMeeting {
  readonly title: string;
  /** The transcript exactly as received; stored verbatim with its SHA-256. */
  readonly source: string;
  readonly turns: readonly Turn[];
  readonly chunks: readonly Chunk[];
}

export interface StoredMeeting {
  readonly id: string;
  readonly title: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly createdAt: Date;
  readonly turns: readonly Turn[];
  readonly chunks: readonly Chunk[];
}

export interface MeetingSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly turnCount: number;
}

export interface MeetingStore {
  /** Saves a meeting with all its turns and chunks, or nothing at all. */
  save(meeting: NewMeeting): Promise<{ id: string }>;
  /** The meeting with that id, or undefined if there is none (including malformed ids). */
  get(id: string): Promise<StoredMeeting | undefined>;
  /** All meetings, newest first. */
  list(): Promise<MeetingSummary[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMeetingStore(sql: Sql): MeetingStore {
  return {
    async save({ title, source, turns, chunks }) {
      const sha256 = createHash("sha256").update(source, "utf8").digest("hex");
      return sql.begin(async (tx) => {
        const [meeting] = await tx<{ id: string }[]>`
          insert into meetings (title, source_text, source_sha256)
          values (${title}, ${source}, ${sha256})
          returning id`;
        if (!meeting) throw new Error("insert into meetings returned no row");
        if (turns.length > 0) {
          await tx`insert into turns ${tx(turns.map((t) => turnRow(meeting.id, t)))}`;
        }
        if (chunks.length > 0) {
          await tx`insert into chunks ${tx(chunks.map((c) => chunkRow(meeting.id, c)))}`;
        }
        return { id: meeting.id };
      });
    },

    async get(id) {
      if (!UUID.test(id)) return undefined;
      const [meeting] = await sql<MeetingRow[]>`
        select id, title, source_text, source_sha256, created_at
        from meetings where id = ${id}`;
      if (!meeting) return undefined;
      const turnRows = await sql<TurnRow[]>`
        select * from turns where meeting_id = ${id} order by turn_index`;
      const chunkRows = await sql<ChunkRow[]>`
        select * from chunks where meeting_id = ${id} order by chunk_index`;
      return {
        id: meeting.id,
        title: meeting.title,
        sourceText: meeting.source_text,
        sourceSha256: meeting.source_sha256,
        createdAt: meeting.created_at,
        turns: turnRows.map(toTurn),
        chunks: chunkRows.map(toChunk),
      };
    },

    async list() {
      const rows = await sql<(MeetingRow & { turn_count: number })[]>`
        select m.id, m.title, m.created_at,
               (select count(*)::int from turns t where t.meeting_id = m.id) as turn_count
        from meetings m
        order by m.created_at desc, m.id`;
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        turnCount: r.turn_count,
      }));
    },
  };
}

interface MeetingRow {
  id: string;
  title: string;
  source_text: string;
  source_sha256: string;
  created_at: Date;
}

interface TurnRow {
  meeting_id: string;
  turn_index: number;
  speaker: string;
  start_seconds: number;
  text: string;
  source_line_start: number;
  source_line_end: number;
}

interface ChunkRow {
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

function turnRow(meetingId: string, t: Turn): TurnRow {
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

function toTurn(r: TurnRow): Turn {
  return {
    index: r.turn_index,
    speaker: r.speaker,
    startSeconds: r.start_seconds,
    text: r.text,
    sourceLines: { start: r.source_line_start, end: r.source_line_end },
  };
}

function chunkRow(meetingId: string, c: Chunk): ChunkRow {
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
  };
}

function toChunk(r: ChunkRow): Chunk {
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
