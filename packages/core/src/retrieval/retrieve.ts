import { fuseRankings } from "./fuse.ts";
import type { ChunkSearch, Embedder, RetrievedChunk, SearchHit } from "./types.ts";

export interface RetrieveOptions {
  readonly embedder: Embedder;
  readonly search: ChunkSearch;
  /** Chunks returned after fusion. Provisional, settled by the retrieval eval. */
  readonly limit?: number;
  /** Chunks fetched from each of keyword and vector search before fusion. */
  readonly candidates?: number;
  readonly meetingId?: string;
}

export const DEFAULT_RETRIEVE_OPTIONS = { limit: 8, candidates: 30 } as const;

/**
 * Hybrid retrieval: keyword and vector search over chunks, fused with reciprocal
 * rank fusion. Each result keeps its rank in both searches, so a reviewer can see
 * why it was retrieved.
 */
export async function retrieve(
  question: string,
  {
    embedder,
    search,
    limit = DEFAULT_RETRIEVE_OPTIONS.limit,
    candidates = DEFAULT_RETRIEVE_OPTIONS.candidates,
    meetingId,
  }: RetrieveOptions,
): Promise<{ chunks: RetrievedChunk[]; embeddingTokens: number }> {
  const query = question.trim();
  if (query === "") return { chunks: [], embeddingTokens: 0 };
  const scope = { limit: candidates, ...(meetingId === undefined ? {} : { meetingId }) };

  const [keywordHits, { vectorHits, tokens }] = await Promise.all([
    search.keyword(query, scope),
    (async () => {
      const { vectors, tokens } = await embedder.embed([query], "query");
      const [vector] = vectors;
      if (!vector) throw new Error(`${embedder.model} returned no vector for the question`);
      return {
        vectorHits: await search.vector(vector, { ...scope, model: embedder.model }),
        tokens,
      };
    })(),
  ]);

  const key = (hit: SearchHit) => `${hit.meetingId}:${hit.chunk.index}`;
  const chunks = fuseRankings([keywordHits, vectorHits], key)
    .slice(0, limit)
    .map(({ item, score, ranks: [keywordRank = null, vectorRank = null] }) => ({
      ...item,
      score,
      keywordRank,
      vectorRank,
    }));
  return { chunks, embeddingTokens: tokens };
}
