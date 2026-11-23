import { createHash } from "node:crypto";
import type {
  Chunk,
  Excerpt,
  MeetingRecord,
  MeetingRepository,
  NewMeeting,
  NewRecords,
  TranscriptSource,
  Turn,
} from "@mnemon/core";
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
  UUID,
} from "./rows.ts";
import { ALL_MEETINGS, ownerOf, seenBy, type Visibility } from "./visibility.ts";

// NewMeeting and NewRecords are the core's: the store implements its MeetingRepository.
export type { NewMeeting, NewRecords };

export interface StoredMeeting {
  readonly id: string;
  readonly title: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly embeddingModel: string;
  /** The model that extracted the records, or null if the meeting has not been extracted. */
  readonly recordsModel: string | null;
  readonly createdAt: Date;
  /** The day the meeting was held, YYYY-MM-DD, or null when not known. */
  readonly heldOn: string | null;
  readonly turns: readonly Turn[];
  readonly chunks: readonly Chunk[];
  readonly records: readonly MeetingRecord[];
}

export interface MeetingSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly heldOn: string | null;
  readonly turnCount: number;
}

/** The core's MeetingRepository and TranscriptSource, plus reads for the apps. */
export interface MeetingStore extends MeetingRepository, TranscriptSource {
  /**
   * Saves a meeting with all its turns and chunks, or nothing at all. A transcript
   * is stored once: saving the same source again stores nothing and returns the
   * meeting already stored, with `created: false`.
   */
  save(meeting: NewMeeting): Promise<{ id: string; created: boolean }>;
  /** The meeting stored from exactly this transcript, if any. Checked before paying to embed. */
  findBySource(
    source: string,
  ): Promise<
    { id: string; title: string; recordsModel: string | null; heldOn: string | null } | undefined
  >;
  /** Adds records to a meeting stored without them. A meeting's records are written once. */
  addRecords(meetingId: string, records: NewRecords): Promise<void>;
  /** The meeting with that id, or undefined if there is none (including malformed ids). */
  get(id: string): Promise<StoredMeeting | undefined>;
  /** The meetings this store sees, newest first. */
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

/**
 * The Postgres meeting store, seeing and saving meetings as `visibility` allows: a
 * meeting it can't see reads as missing, everywhere (ADR-0017). Operator tools pass
 * nothing and see every meeting.
 */
export function createMeetingStore(sql: Sql, visibility: Visibility = ALL_MEETINGS): MeetingStore {
  const owner = ownerOf(visibility);
  const seen = () => seenBy(sql, visibility);
  const isSeen = async (meetingId: string) => {
    if (!UUID.test(meetingId)) return false;
    const [row] = await sql`select 1 from meetings m where m.id = ${meetingId} and ${seen()}`;
    return row !== undefined;
  };

  const readRecords = async (meetingId: string) => {
    if (!(await isSeen(meetingId))) return [];
    const recordRows = await sql<RecordRow[]>`
      select * from records where meeting_id = ${meetingId} order by record_index`;
    const citationRows = await sql<CitationRow[]>`
      select * from record_citations where meeting_id = ${meetingId}
      order by record_index, citation_index`;
    return toRecords(recordRows, citationRows);
  };

  return {
    async save({ title, source, turns, chunks, embeddings, records, heldOn }) {
      if (embeddings.vectors.length !== chunks.length) {
        throw new Error(
          `${chunks.length} chunks but ${embeddings.vectors.length} embeddings: they must match one to one`,
        );
      }
      const sha256 = sha256Of(source);
      return sql.begin(async (tx) => {
        // A copy this store already sees (common, or its own) is the meeting: no second copy.
        const [visible] = await tx<{ id: string }[]>`
          select m.id from meetings m where m.source_sha256 = ${sha256} and ${seenBy(tx, visibility)}
          order by m.owner nulls first limit 1`;
        if (visible) return { id: visible.id, created: false };
        const [meeting] = await tx<{ id: string }[]>`
          insert into meetings
            (title, source_text, source_sha256, embedding_model, records_model, held_on, owner)
          values (${title}, ${source}, ${sha256}, ${embeddings.model}, ${records?.model ?? null},
                  ${heldOn ?? null}::date, ${owner})
          on conflict ((coalesce(owner, '')), source_sha256) do nothing
          returning id`;
        if (!meeting) {
          // Another request saved the same transcript for the same owner in the meantime.
          const [existing] = await tx<{ id: string }[]>`
            select id from meetings
            where source_sha256 = ${sha256} and coalesce(owner, '') = ${owner ?? ""}`;
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
      const [meeting] = await sql<Pick<MeetingRow, "id" | "title" | "records_model" | "held_on">[]>`
        select m.id, m.title, m.records_model, m.held_on::text
        from meetings m where m.source_sha256 = ${sha256Of(source)} and ${seen()}
        order by m.owner nulls first limit 1`;
      return meeting
        ? {
            id: meeting.id,
            title: meeting.title,
            recordsModel: meeting.records_model,
            heldOn: meeting.held_on,
          }
        : undefined;
    },

    async setHeldOn(meetingId, heldOn) {
      await sql`
        update meetings m set held_on = ${heldOn}::date
        where m.id = ${meetingId} and m.held_on is null and ${seen()}`;
    },

    async addRecords(meetingId, { model, items }) {
      await sql.begin(async (tx) => {
        const [claimed] = await tx`
          update meetings m set records_model = ${model}
          where m.id = ${meetingId} and m.records_model is null and ${seenBy(tx, visibility)}
          returning m.id`;
        if (!claimed) {
          const [exists] = await tx`
            select 1 from meetings m where m.id = ${meetingId} and ${seenBy(tx, visibility)}`;
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
        select m.id, m.title, m.source_text, m.source_sha256, m.embedding_model,
               m.records_model, m.created_at, m.held_on::text
        from meetings m where m.id = ${id} and ${seen()}`;
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
        recordsModel: meeting.records_model,
        createdAt: meeting.created_at,
        heldOn: meeting.held_on,
        turns: turnRows.map(toTurn),
        chunks: chunkRows.map(toChunk),
        records: await readRecords(id),
      };
    },

    records: readRecords,

    async excerpt(meetingId, turnIndices) {
      if (!UUID.test(meetingId)) return undefined;
      const [meeting] = await sql<Pick<MeetingRow, "title" | "held_on">[]>`
        select m.title, m.held_on::text from meetings m where m.id = ${meetingId} and ${seen()}`;
      if (!meeting) return undefined;
      const rows = await sql<TurnRow[]>`
        select * from turns
        where meeting_id = ${meetingId} and turn_index = any(${sql.array([...turnIndices])}::int[])
        order by turn_index`;
      return { meetingId, title: meeting.title, heldOn: meeting.held_on, turns: rows.map(toTurn) };
    },

    async list() {
      const rows = await sql<
        (Pick<MeetingRow, "id" | "title" | "created_at" | "held_on"> & { turn_count: number })[]
      >`
        select m.id, m.title, m.created_at, m.held_on::text,
               (select count(*)::int from turns t where t.meeting_id = m.id) as turn_count
        from meetings m
        where ${seen()}
        order by m.created_at desc, m.id`;
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        heldOn: r.held_on,
        turnCount: r.turn_count,
      }));
    },
  };
}
