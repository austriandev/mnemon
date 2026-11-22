import { createHash } from "node:crypto";
import type { Chunk, Turn } from "@mnemon/core";
import type { Sql } from "postgres";
import {
  CHUNK_COLUMNS,
  type ChunkRow,
  chunkRow,
  type MeetingRow,
  type TurnRow,
  toChunk,
  toTurn,
  turnRow,
} from "./rows.ts";

export interface NewMeeting {
  readonly title: string;
  /** The transcript exactly as received; stored verbatim with its SHA-256. */
  readonly source: string;
  readonly turns: readonly Turn[];
  readonly chunks: readonly Chunk[];
  /** One vector per chunk, in chunk order, and the model that produced them. */
  readonly embeddings: { readonly model: string; readonly vectors: readonly (readonly number[])[] };
}

export interface StoredMeeting {
  readonly id: string;
  readonly title: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly embeddingModel: string;
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
  /**
   * Saves a meeting with all its turns and chunks, or nothing at all. A transcript
   * is stored once: saving the same source again stores nothing and returns the
   * meeting already stored, with `created: false`.
   */
  save(meeting: NewMeeting): Promise<{ id: string; created: boolean }>;
  /** The meeting stored from exactly this transcript, if any. Checked before paying to embed. */
  findBySource(source: string): Promise<{ id: string; title: string } | undefined>;
  /** The meeting with that id, or undefined if there is none (including malformed ids). */
  get(id: string): Promise<StoredMeeting | undefined>;
  /** All meetings, newest first. */
  list(): Promise<MeetingSummary[]>;
}

function sha256Of(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMeetingStore(sql: Sql): MeetingStore {
  return {
    async save({ title, source, turns, chunks, embeddings }) {
      if (embeddings.vectors.length !== chunks.length) {
        throw new Error(
          `${chunks.length} chunks but ${embeddings.vectors.length} embeddings: they must match one to one`,
        );
      }
      const sha256 = sha256Of(source);
      return sql.begin(async (tx) => {
        const [meeting] = await tx<{ id: string }[]>`
          insert into meetings (title, source_text, source_sha256, embedding_model)
          values (${title}, ${source}, ${sha256}, ${embeddings.model})
          on conflict (source_sha256) do nothing
          returning id`;
        if (!meeting) {
          const [existing] = await tx<{ id: string }[]>`
            select id from meetings where source_sha256 = ${sha256}`;
          if (!existing) throw new Error("insert into meetings returned no row");
          return { id: existing.id, created: false };
        }
        if (turns.length > 0) {
          await tx`insert into turns ${tx(turns.map((t) => turnRow(meeting.id, t)))}`;
        }
        if (chunks.length > 0) {
          await tx`insert into chunks ${tx(
            chunks.map((c, i) => chunkRow(meeting.id, c, embeddings.vectors[i] ?? [])),
          )}`;
        }
        return { id: meeting.id, created: true };
      });
    },

    async findBySource(source) {
      const [meeting] = await sql<{ id: string; title: string }[]>`
        select id, title from meetings where source_sha256 = ${sha256Of(source)}`;
      return meeting ? { id: meeting.id, title: meeting.title } : undefined;
    },

    async get(id) {
      if (!UUID.test(id)) return undefined;
      const [meeting] = await sql<MeetingRow[]>`
        select id, title, source_text, source_sha256, embedding_model, created_at
        from meetings where id = ${id}`;
      if (!meeting) return undefined;
      const turnRows = await sql<TurnRow[]>`
        select * from turns where meeting_id = ${id} order by turn_index`;
      const chunkRows = await sql<ChunkRow[]>`
        select ${sql(CHUNK_COLUMNS)} from chunks where meeting_id = ${id} order by chunk_index`;
      return {
        id: meeting.id,
        title: meeting.title,
        sourceText: meeting.source_text,
        sourceSha256: meeting.source_sha256,
        embeddingModel: meeting.embedding_model,
        createdAt: meeting.created_at,
        turns: turnRows.map(toTurn),
        chunks: chunkRows.map(toChunk),
      };
    },

    async list() {
      const rows = await sql<
        (Pick<MeetingRow, "id" | "title" | "created_at"> & { turn_count: number })[]
      >`
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
