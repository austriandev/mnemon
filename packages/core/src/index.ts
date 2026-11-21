// Public interface of @mnemon/core. Everything a caller may use is exported here.

export { chunkTurns, DEFAULT_CHUNK_OPTIONS } from "./chunking/chunk.ts";
export { approximateTokenCounter } from "./chunking/tokens.ts";
export type { Chunk, ChunkOptions, TokenCounter } from "./chunking/types.ts";
export { DEFAULT_RRF_K, type Fused, fuseRankings } from "./retrieval/fuse.ts";
export {
  DEFAULT_RETRIEVE_OPTIONS,
  type RetrieveOptions,
  retrieve,
} from "./retrieval/retrieve.ts";
export type {
  ChunkSearch,
  Embedder,
  EmbeddingInputType,
  RetrievedChunk,
  SearchHit,
  SearchOptions,
} from "./retrieval/types.ts";
export { parseTranscript } from "./transcript/parse.ts";
export type { ParseError, ParseErrorCode, ParseResult, Turn } from "./transcript/types.ts";
