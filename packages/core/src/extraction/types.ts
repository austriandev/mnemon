/** What kind of thing a record is. */
export type RecordKind = "decision" | "action_item" | "topic";

/** A pointer from a record back to one turn, with the words in it that support the record. */
export interface Citation {
  readonly turnIndex: number;
  /** Copied verbatim from the turn's text. */
  readonly quote: string;
}

/** Something extracted from a meeting that people ask about, tied to the turns it rests on. */
export interface MeetingRecord {
  readonly index: number;
  readonly kind: RecordKind;
  /** One sentence, in the meeting's own terms. */
  readonly summary: string;
  /** Who committed to it, as named in the meeting. Required for action items. */
  readonly owner: string | null;
  /** The deadline as said in the meeting ("by Friday"), never a computed date. */
  readonly due: string | null;
  /** At least one. */
  readonly citations: readonly Citation[];
}

/** A JSON Schema object, in the subset that model providers' structured outputs accept. */
export type JsonSchema = { readonly [key: string]: unknown };

export interface StructuredRequest {
  readonly system: string;
  readonly prompt: string;
  /** The output must be one JSON value matching this schema. */
  readonly schema: JsonSchema;
}

/** A language model that answers with JSON constrained to a schema. */
export interface LanguageModel {
  /** The model asked for. */
  readonly model: string;
  generateObject(request: StructuredRequest): Promise<{
    readonly value: unknown;
    /** The model that actually produced the value (may differ after a provider fallback). */
    readonly model: string;
  }>;
}

export interface RejectedRecord {
  /** The model's output for this record, unchanged. */
  readonly output: unknown;
  readonly reason: string;
}

export interface Extraction {
  readonly records: readonly MeetingRecord[];
  /** Records the model proposed that failed validation. Dropped, never repaired. */
  readonly rejected: readonly RejectedRecord[];
  /** The model that produced the records, or null when no model was called. */
  readonly model: string | null;
}
