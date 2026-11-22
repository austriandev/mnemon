import type { ChunkSearch, SearchHit } from "@mnemon/core";
import type { Sql } from "postgres";
import { CHUNK_COLUMNS, type ChunkRow, toChunk, toVectorLiteral } from "./rows.ts";

type HitRow = Omit<ChunkRow, "meeting_id"> & { meeting_id: string };

/**
 * Postgres implementation of the core's ChunkSearch.
 *
 * - keyword: full text over the chunk's rendered text (speakers included), ranked
 *   with ts_rank_cd. The question's words are OR-ed, so a chunk needs only some of
 *   them; a natural-language question rarely has every word in one passage. This is
 *   Postgres's built-in ranking, not true BM25 (ADR-0005).
 * - vector: cosine distance via pgvector's HNSW index, restricted to chunks
 *   embedded by the same model as the query.
 */
export function createChunkSearch(sql: Sql): ChunkSearch {
  const toHit = (row: HitRow): SearchHit => ({ meetingId: row.meeting_id, chunk: toChunk(row) });
  const inMeeting = (meetingId: string | undefined) =>
    meetingId === undefined ? sql`true` : sql`c.meeting_id = ${meetingId}`;

  return {
    async keyword(query, { limit, meetingId }) {
      // Stem the question with the same configuration as the index, then OR the
      // resulting lexemes into a tsquery. Each lexeme is quoted, so punctuation in
      // the question can't change the query's structure.
      const rows = await sql<HitRow[]>`
        with q as (
          select string_agg('''' || replace(replace(lexeme, '\\', '\\\\'), '''', '''''') || '''', ' | ')::tsquery as query
          from unnest(tsvector_to_array(to_tsvector('english', ${query}))) as lexeme
        )
        select c.meeting_id, ${sql(CHUNK_COLUMNS.map((col) => `c.${col}`))}
        from chunks c, q
        where q.query is not null and c.search @@ q.query and ${inMeeting(meetingId)}
        order by ts_rank_cd(c.search, q.query) desc, c.meeting_id, c.chunk_index
        limit ${limit}`;
      return rows.map(toHit);
    },

    async vector(embedding, { limit, meetingId, model }) {
      const rows = await sql<HitRow[]>`
        select c.meeting_id, ${sql(CHUNK_COLUMNS.map((col) => `c.${col}`))}
        from chunks c
        join meetings m on m.id = c.meeting_id
        where m.embedding_model = ${model} and ${inMeeting(meetingId)}
        order by c.embedding <=> ${toVectorLiteral(embedding)}::vector, c.meeting_id, c.chunk_index
        limit ${limit}`;
      return rows.map(toHit);
    },
  };
}
