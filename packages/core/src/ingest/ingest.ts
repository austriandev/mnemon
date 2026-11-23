import { chunkTurns } from "../chunking/chunk.ts";
import { approximateTokenCounter } from "../chunking/tokens.ts";
import type { Chunk } from "../chunking/types.ts";
import {
  buildPrompt,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  extractRecords,
} from "../extraction/extract.ts";
import type { Extraction, LanguageModel, MeetingRecord } from "../extraction/types.ts";
import type { Embedder } from "../retrieval/types.ts";
import { parseTranscript } from "../transcript/parse.ts";
import type { ParseError, Turn } from "../transcript/types.ts";

/** A meeting as stored: the transcript, its turns and chunks, their vectors, and its records. */
export interface NewMeeting {
  readonly title: string;
  /** The transcript exactly as received; stored verbatim. */
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

/** Where meetings are kept. The Postgres meeting store implements it. */
export interface MeetingRepository {
  /** The meeting stored from exactly this transcript, if any. */
  findBySource(
    source: string,
  ): Promise<{ id: string; title: string; recordsModel: string | null } | undefined>;
  /** Saves the meeting whole, or nothing. Saving a stored transcript again creates nothing. */
  save(meeting: NewMeeting): Promise<{ id: string; created: boolean }>;
  /** Adds records to a meeting stored without them; a meeting's records are written once. */
  addRecords(meetingId: string, records: NewRecords): Promise<void>;
}

/**
 * What ingesting a transcript will do, worked out before anything is paid for, so a
 * caller can state the cost first.
 */
/** Why a transcript cannot be ingested: a parse error, or a blank title. */
export type IngestError =
  | ParseError
  | { readonly code: "empty-title"; readonly line: null; readonly message: string };

export type IngestPlan =
  | { readonly kind: "invalid"; readonly errors: readonly IngestError[] }
  /** Already stored with its records: nothing to do, nothing to pay. */
  | {
      readonly kind: "unchanged";
      readonly meeting: { readonly id: string; readonly title: string };
    }
  /** Stored before extraction existed: extract its records; its embeddings are already there. */
  | {
      readonly kind: "extract-only";
      readonly meeting: { readonly id: string; readonly title: string };
      readonly turns: readonly Turn[];
    }
  /** New: extract, embed, store. */
  | {
      readonly kind: "new";
      readonly title: string;
      readonly source: string;
      readonly turns: readonly Turn[];
      readonly chunks: readonly Chunk[];
    };

export type IngestResult =
  | { readonly kind: "unchanged"; readonly id: string; readonly title: string }
  | { readonly kind: "backfilled"; readonly id: string; readonly extraction: Extraction }
  | {
      readonly kind: "stored";
      readonly id: string;
      /** False if another run stored the same transcript in the meantime. */
      readonly created: boolean;
      readonly extraction: Extraction;
      readonly embeddingTokens: number;
    };

export interface IngestDeps {
  readonly repository: MeetingRepository;
  readonly embedder: Embedder;
  readonly model: LanguageModel;
}

export async function planIngest(
  source: string,
  title: string,
  repository: MeetingRepository,
): Promise<IngestPlan> {
  const parsed = parseTranscript(source);
  const name = title.trim();
  const errors: IngestError[] = parsed.ok ? [] : [...parsed.errors];
  if (name === "") {
    errors.push({ code: "empty-title", line: null, message: "The meeting needs a title." });
  }
  if (!parsed.ok || errors.length > 0) return { kind: "invalid", errors };
  const existing = await repository.findBySource(source);
  if (existing) {
    const meeting = { id: existing.id, title: existing.title };
    return existing.recordsModel
      ? { kind: "unchanged", meeting }
      : { kind: "extract-only", meeting, turns: parsed.turns };
  }
  return {
    kind: "new",
    title: name,
    source,
    turns: parsed.turns,
    chunks: chunkTurns(parsed.turns),
  };
}

// The extraction prompt (turn labels, timestamps, schema) is denser than prose: the fixture's
// 7,650 characters were 3,401 input tokens, ~2.25 per token (ADR-0006). Count 2 for headroom.
const EXTRACTION_CHARS_PER_TOKEN = 2;
// Room for adaptive thinking plus the JSON; the eval's largest was 3,206. An upper estimate.
const EXPECTED_EXTRACTION_OUTPUT_TOKENS = 6_000;

/** The tokens a plan will pay for, estimated before any call, so a caller can price it. */
export interface IngestTokens {
  readonly extractionInput: number;
  /** An upper estimate: the model is not asked for more. */
  readonly extractionOutput: number;
  readonly embedding: number;
}

export function ingestTokens(plan: IngestPlan): IngestTokens {
  if (plan.kind === "invalid" || plan.kind === "unchanged") {
    return { extractionInput: 0, extractionOutput: 0, embedding: 0 };
  }
  const promptChars =
    EXTRACTION_SYSTEM_PROMPT.length +
    buildPrompt(plan.turns).length +
    JSON.stringify(EXTRACTION_SCHEMA).length;
  const extraction = {
    extractionInput: Math.ceil(promptChars / EXTRACTION_CHARS_PER_TOKEN),
    extractionOutput: EXPECTED_EXTRACTION_OUTPUT_TOKENS,
  };
  if (plan.kind === "extract-only") return { ...extraction, embedding: 0 };
  const embedding = plan.chunks.reduce((n, c) => n + approximateTokenCounter.count(c.text), 0);
  return { ...extraction, embedding };
}

/**
 * Carries out a plan. Extraction runs first: it is the expensive call and the one most
 * likely to be declined, so if it fails nothing is embedded and nothing is saved.
 */
export async function runIngest(plan: IngestPlan, deps: IngestDeps): Promise<IngestResult> {
  switch (plan.kind) {
    case "invalid":
      throw new Error("Cannot ingest: the plan is invalid. Fix the errors it lists.");
    case "unchanged":
      return { kind: "unchanged", id: plan.meeting.id, title: plan.meeting.title };
    case "extract-only": {
      const extraction = await extractRecords(plan.turns, deps.model);
      await deps.repository.addRecords(plan.meeting.id, recordsOf(extraction, deps.model));
      return { kind: "backfilled", id: plan.meeting.id, extraction };
    }
    case "new": {
      const extraction = await extractRecords(plan.turns, deps.model);
      const { vectors, tokens } = await deps.embedder.embed(
        plan.chunks.map((c) => c.text),
        "document",
      );
      const { id, created } = await deps.repository.save({
        title: plan.title,
        source: plan.source,
        turns: plan.turns,
        chunks: plan.chunks,
        embeddings: { model: deps.embedder.model, vectors },
        records: recordsOf(extraction, deps.model),
      });
      return { kind: "stored", id, created, extraction, embeddingTokens: tokens };
    }
  }
}

function recordsOf(extraction: Extraction, model: LanguageModel): NewRecords {
  return { model: extraction.model ?? model.model, items: extraction.records };
}
