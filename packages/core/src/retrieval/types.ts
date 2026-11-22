import type { Chunk } from "../chunking/types.ts";

/** Whether text is stored for retrieval or is a question searching it. */
export type EmbeddingInputType = "document" | "query";

/** Turns text into vectors. Implementations call an embedding model. */
export interface Embedder {
  /** Model identifier; vectors from different models must never be compared. */
  readonly model: string;
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    inputType: EmbeddingInputType,
  ): Promise<{ vectors: number[][]; tokens: number }>;
}

export interface SearchOptions {
  readonly limit: number;
  /** Restrict the search to one meeting; all meetings when absent. */
  readonly meetingId?: string;
}

export interface SearchHit {
  readonly meetingId: string;
  readonly chunk: Chunk;
}

/** Ranked chunk lookups, best match first. Implementations sit over a store. */
export interface ChunkSearch {
  keyword(query: string, options: SearchOptions): Promise<SearchHit[]>;
  vector(
    embedding: readonly number[],
    options: SearchOptions & { readonly model: string },
  ): Promise<SearchHit[]>;
}

export interface RetrievedChunk extends SearchHit {
  /** Reciprocal-rank-fusion score; higher is better. */
  readonly score: number;
  /** 1-based rank in the keyword results, or null if keyword search missed it. */
  readonly keywordRank: number | null;
  /** 1-based rank in the vector results, or null if vector search missed it. */
  readonly vectorRank: number | null;
}
