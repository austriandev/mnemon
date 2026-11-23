import type { Turn } from "@mnemon/core";
import type { GoldRecord } from "./dataset.ts";

/** A pause between joined meetings, so timestamps keep moving forward. */
const GAP_SECONDS = 60;

export interface Labelled {
  readonly turns: readonly Turn[];
  readonly gold: readonly GoldRecord[];
}

/**
 * Joins labelled meetings into one long meeting: turns numbered on, timestamps shifted
 * so each meeting starts a minute after the last turn before it, and every gold
 * record's turns shifted with its meeting. A length probe for extraction: real labels
 * at several times the length of any one meeting.
 */
export function stitch(meetings: readonly Labelled[]): Labelled {
  const turns: Turn[] = [];
  const gold: GoldRecord[] = [];
  for (const m of meetings) {
    const offset = turns.length;
    const last = turns.at(-1);
    const shift = last ? last.startSeconds + GAP_SECONDS : 0;
    for (const t of m.turns) {
      turns.push({ ...t, index: t.index + offset, startSeconds: t.startSeconds + shift });
    }
    for (const g of m.gold) gold.push({ ...g, turns: g.turns.map((t) => t + offset) });
  }
  return { turns, gold };
}
