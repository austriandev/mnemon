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

export type ParseResult = { readonly ok: true; readonly turns: readonly Turn[] };
