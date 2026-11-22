import { createHash } from "node:crypto";
import type { Chunk, Excerpt, MeetingRecord, Turn } from "@mnemon/core";
import type { Sql, TransactionSql } from "postgres";
import {
  CHUNK_COLUMNS,
  type ChunkRow,
  type CitationRow,
  chunkRow,
  type MeetingRow,
  type RecordRow,
  recordRows,
  type TurnRow,
  toChunk,
  toRecords,
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
  /** The meeting's extracted records. Absent means not extracted yet. */
  readonly records?: NewRecords;
}

export interface NewRecords {
  /** The model that produced the records (the one that answered, after any fallback). */
  readonly model: string;
  readonly items: readonly MeetingRecord[];
}

export interface StoredMeeting {
  readonly id: string;
  readonly title: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly embeddingModel: string;
  /** The model that extracted the records, or null if the meeting has not been extracted. */
  readonly recordsModel: string | null;
  readonly createdAt: Date;
  readonly turns: readonly Turn[];
  readonly chunks: readonly Chunk[];
  readonly records: readonly MeetingRecord[];
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
  findBySource(
    source: string,
  ): Promise<{ id: string; title: string; recordsModel: string | null } | undefined>;
  /** Adds records to a meeting stored without them. A meeting's records are written once. */
  addRecords(meetingId: string, records: NewRecords): Promise<void>;
  /** The meeting with that id, or undefined if there is none (including malformed ids). */
  get(id: string): Promise<StoredMeeting | undefined>;
  /** All meetings, newest first. */
  list(): Promise<MeetingSummary[]>;
  /** The meeting's title and the turns with these indices, in turn order (the core's TranscriptSource). */
  excerpt(meetingId: string, turnIndices: readonly number[]): Promise<Excerpt | undefined>;
}

async function insertRecords(
  tx: TransactionSql,
  meetingId: string,
  items: readonly MeetingRecord[],
): Promise<void> {
  const { records, citations } = recordRows(meetingId, items);
  if (records.length > 0) await tx`insert into records ${tx(records)}`;
  if (citations.length > 0) await tx`insert into record_citations ${tx(citations)}`;
}

function sha256Of(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMeetingStore(sql: Sql): MeetingStore {
  return {
    async save({ title, source, turns, chunks, embeddings, records }) {
      if (embeddings.vectors.length !== chunks.length) {
        throw new Error(
          `${chunks.length} chunks but ${embeddings.vectors.length} embeddings: they must match one to one`,
        );
      }
      const sha256 = sha256Of(source);
      return sql.begin(async (tx) => {
        const [meeting] = await tx<{ id: string }[]>`
          insert into meetings (title, source_text, source_sha256, embedding_model, records_model)
          values (${title}, ${source}, ${sha256}, ${embeddings.model}, ${records?.model ?? null})
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
        if (records) await insertRecords(tx, meeting.id, records.items);
        return { id: meeting.id, created: true };
      });
    },

    async findBySource(source) {
      const [meeting] = await sql<Pick<MeetingRow, "id" | "title" | "records_model">[]>`
        select id, title, records_model from meetings where source_sha256 = ${sha256Of(source)}`;
      return meeting
        ? { id: meeting.id, title: meeting.title, recordsModel: meeting.records_model }
        : undefined;
    },

    async addRecords(meetingId, { model, items }) {
      await sql.begin(async (tx) => {
        const [claimed] = await tx`
          update meetings set records_model = ${model}
          where id = ${meetingId} and records_model is null
          returning id`;
        if (!claimed) {
          const [exists] = await tx`select 1 from meetings where id = ${meetingId}`;
          throw new Error(
            exists ? `Meeting ${meetingId} already has records` : `No meeting ${meetingId}`,
          );
        }
        await insertRecords(tx, meetingId, items);
      });
    },

    async get(id) {
      if (!UUID.test(id)) return undefined;
      const [meeting] = await sql<MeetingRow[]>`
        select id, title, source_text, source_sha256, embedding_model, records_model, created_at
        from meetings where id = ${id}`;
      if (!meeting) return undefined;
      const turnRows = await sql<TurnRow[]>`
        select * from turns where meeting_id = ${id} order by turn_index`;
      const chunkRows = await sql<ChunkRow[]>`
        select ${sql(CHUNK_COLUMNS)} from chunks where meeting_id = ${id} order by chunk_index`;
      const recordRowsFound = await sql<RecordRow[]>`
        select * from records where meeting_id = ${id} order by record_index`;
      const citationRows = await sql<CitationRow[]>`
        select * from record_citations where meeting_id = ${id}
        order by record_index, citation_index`;
      return {
        id: meeting.id,
        title: meeting.title,
        sourceText: meeting.source_text,
        sourceSha256: meeting.source_sha256,
        embeddingModel: meeting.embedding_model,
        recordsModel: meeting.records_model,
        createdAt: meeting.created_at,
        turns: turnRows.map(toTurn),
        chunks: chunkRows.map(toChunk),
        records: toRecords(recordRowsFound, citationRows),
      };
    },

    async excerpt(meetingId, turnIndices) {
      if (!UUID.test(meetingId)) return undefined;
      const [meeting] = await sql<Pick<MeetingRow, "title">[]>`
        select title from meetings where id = ${meetingId}`;
      if (!meeting) return undefined;
      const rows = await sql<TurnRow[]>`
        select * from turns
        where meeting_id = ${meetingId} and turn_index = any(${sql.array([...turnIndices])}::int[])
        order by turn_index`;
      return { meetingId, title: meeting.title, turns: rows.map(toTurn) };
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
