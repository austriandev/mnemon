import { formatTimestamp } from "./timestamp.ts";
import type { Turn } from "./types.ts";

/** How a turn is shown to a model: "[turn 22] [00:03:39] Dana Wu: text". Citations name the turn number. */
export function turnLine(turn: Turn): string {
  return `[turn ${turn.index}] [${formatTimestamp(turn.startSeconds)}] ${turn.speaker}: ${turn.text}`;
}
