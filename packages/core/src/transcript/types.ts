/** One speaker's uninterrupted contribution to a meeting. */
export interface Turn {
  /** 0-based position of the turn in the meeting. */
  readonly index: number;
  readonly speaker: string;
  /** Offset from the start of the recording, in whole seconds. */
  readonly startSeconds: number;
  readonly text: string;
  /** 1-based, inclusive line range in the source file the turn came from. */
  readonly sourceLines: { readonly start: number; readonly end: number };
}

export type ParseErrorCode =
  /** A line starts with a bracketed timestamp that is not [HH:MM:SS] or [MM:SS]. */
  | "invalid-timestamp"
  /** A timestamp is not followed by "Speaker: ". */
  | "missing-speaker"
  /** The speaker before ": " is empty. */
  | "empty-speaker"
  /** A turn has a speaker but no text, on its own line or on continuation lines. */
  | "empty-text"
  /** Text appears before the first timestamped turn, so it belongs to no speaker. */
  | "orphan-line";

export interface ParseError {
  readonly code: ParseErrorCode;
  /** 1-based source line the error points at, or null when it concerns the whole file. */
  readonly line: number | null;
  readonly message: string;
}

/**
 * The outcome of parsing a transcript. Malformed input is never repaired:
 * any error rejects the whole transcript, and every error found is reported.
 */
export type ParseResult =
  | { readonly ok: true; readonly turns: readonly Turn[] }
  | { readonly ok: false; readonly errors: readonly ParseError[] };
