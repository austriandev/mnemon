// Public interface of @mnemon/core. Everything a caller may use is exported here.

export {
  ANSWER_SCHEMA,
  ANSWER_SYSTEM_PROMPT,
  answer,
  buildPrompt as buildAnswerPrompt,
} from "./answering/answer.ts";
export { type AskOptions, ask } from "./answering/ask.ts";
export type {
  Answer,
  AnswerCitation,
  AnswerSentence,
  AskResult,
  Excerpt,
  TranscriptSource,
} from "./answering/types.ts";

export { chunkTurns, DEFAULT_CHUNK_OPTIONS } from "./chunking/chunk.ts";
export { approximateTokenCounter } from "./chunking/tokens.ts";
export type { Chunk, ChunkOptions, TokenCounter } from "./chunking/types.ts";
export {
  buildPrompt as buildExtractionPrompt,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  extractRecords,
} from "./extraction/extract.ts";
export type {
  Citation,
  Extraction,
  JsonSchema,
  LanguageModel,
  MeetingRecord,
  RecordKind,
  RejectedRecord,
  StructuredRequest,
} from "./extraction/types.ts";
export {
  type IngestDeps,
  type IngestError,
  type IngestPlan,
  type IngestResult,
  type MeetingRepository,
  type NewMeeting,
  type NewRecords,
  planIngest,
  runIngest,
} from "./ingest/ingest.ts";
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
export { formatTimestamp } from "./transcript/timestamp.ts";
export type { ParseError, ParseErrorCode, ParseResult, Turn } from "./transcript/types.ts";
