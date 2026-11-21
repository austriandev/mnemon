/** Counts tokens the way the model that will read the text does. */
export interface TokenCounter {
  count(text: string): number;
}

export interface ChunkOptions {
  /** Token budget per chunk. A single turn over budget becomes its own, oversize chunk. */
  readonly maxTokens?: number;
  /** Turns repeated from the end of one chunk at the start of the next. */
  readonly overlapTurns?: number;
  readonly tokenCounter?: TokenCounter;
}

/** A run of whole, consecutive turns, sized for retrieval and citable back to its turns. */
export interface Chunk {
  /** 0-based position of the chunk in the meeting. */
  readonly index: number;
  /** Inclusive range of turn indices the chunk covers. */
  readonly turnRange: { readonly first: number; readonly last: number };
  /** Start of the chunk's first turn, in seconds. */
  readonly startSeconds: number;
  /** Start of the chunk's last turn, in seconds: turns carry no end time. */
  readonly endSeconds: number;
  /** Distinct speakers, in order of first appearance. */
  readonly speakers: readonly string[];
  /** One line per turn: "[HH:MM:SS] Speaker: text". */
  readonly text: string;
  readonly tokenCount: number;
  /** True when the chunk is a single turn that alone exceeds maxTokens. */
  readonly oversize: boolean;
}
