import type { Citation, MeetingRecord } from "../extraction/types.ts";
import type { RetrievedChunk } from "../retrieval/types.ts";
import type { Turn } from "../transcript/types.ts";

/** The turns of one meeting retrieved for a question, in turn order. */
export interface Excerpt {
  readonly meetingId: string;
  readonly title: string;
  readonly turns: readonly Turn[];
  /** The meeting's extracted records, when shown with it. The turns they cite are in turns. */
  readonly records?: readonly MeetingRecord[];
}

/** Reads turns and records back from stored meetings. Implementations sit over a store. */
export interface TranscriptSource {
  /** The meeting's title and the turns with these indices, in turn order; undefined if no such meeting. */
  excerpt(meetingId: string, turnIndices: readonly number[]): Promise<Excerpt | undefined>;
  /** The meeting's extracted records, in order; empty if it has none or does not exist. */
  records(meetingId: string): Promise<readonly MeetingRecord[]>;
}

/** A citation in an answer: a turn of a particular meeting, and the words in it relied on. */
export interface AnswerCitation extends Citation {
  readonly meetingId: string;
}

export interface AnswerSentence {
  readonly text: string;
  /** At least one. */
  readonly citations: readonly AnswerCitation[];
}

export type Answer =
  /** Every sentence cites turns the model was shown, quoting them verbatim. */
  | {
      readonly status: "answered";
      readonly sentences: readonly AnswerSentence[];
      /** What the excerpts don't cover, when they answer only part of the question. Uncited. */
      readonly gaps: string | null;
      readonly model: string;
    }
  /** The excerpts don't answer the question. model is null when there was nothing to ask about. */
  | { readonly status: "not_found"; readonly model: string | null }
  /** The model's answer failed a check. Shown as a failure, never repaired or shown as an answer. */
  | {
      readonly status: "rejected";
      readonly reason: string;
      readonly output: unknown;
      readonly model: string;
    };

export interface AskResult {
  readonly answer: Answer;
  /** The chunks retrieval returned, with their ranks: why these excerpts were shown. */
  readonly retrieved: readonly RetrievedChunk[];
  /** Exactly what the model was shown. */
  readonly excerpts: readonly Excerpt[];
  readonly embeddingTokens: number;
}
