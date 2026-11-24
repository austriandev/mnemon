// Scoring a transcription against a reference transcript (ADR-0018): how many words it
// got wrong, and how many turns it attributed to the right person.
import type { Turn, Utterance } from "@mnemon/core";

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * Lower case, punctuation and hyphens as spaces, and spelled-out numbers as digits, so
 * "BX-17", "one hundred eighty" and "180" compare the way a reader would.
 */
export function normalizeWords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out: string[] = [];
  let current: number | null = null;
  const flush = () => {
    if (current !== null) out.push(String(current));
    current = null;
  };
  for (const token of tokens) {
    const unit = UNITS[token] ?? TENS[token];
    if (unit !== undefined) {
      current = (current ?? 0) + unit;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/** Word error rate: edits (substitutions, insertions, deletions) over the reference's words. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const substitute = (previous[j - 1] ?? 0) + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      row.push(Math.min(substitute, (previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1));
    }
    previous = row;
  }
  return (previous[hyp.length] ?? 0) / ref.length;
}

export interface SpeakerScore {
  /** Utterances whose label maps to the person speaking at that moment in the reference. */
  readonly correct: number;
  readonly turns: number;
  /** Each label, mapped to the person it most often lands on. */
  readonly labels: Readonly<Record<string, string>>;
  readonly speakersFound: number;
  readonly speakersExpected: number;
}

/**
 * Who was speaking when each utterance started, by the reference's turn times (a second
 * of slack for where the service places the start), then each label is mapped to the
 * person it lands on most. Merging two people into one label costs the minority's turns.
 */
export function scoreSpeakers(
  reference: readonly Turn[],
  utterances: readonly Utterance[],
): SpeakerScore {
  const speakerAt = (ms: number) =>
    [...reference].reverse().find((t) => t.startSeconds * 1000 <= ms + 1000)?.speaker ??
    reference[0]?.speaker ??
    "";
  const landed = utterances.map((u) => ({ label: u.speaker, person: speakerAt(u.startMs) }));

  const votes = new Map<string, Map<string, number>>();
  for (const { label, person } of landed) {
    const forLabel = votes.get(label) ?? new Map<string, number>();
    forLabel.set(person, (forLabel.get(person) ?? 0) + 1);
    votes.set(label, forLabel);
  }
  const labels: Record<string, string> = {};
  for (const [label, people] of votes) {
    labels[label] = [...people].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  return {
    correct: landed.filter(({ label, person }) => labels[label] === person).length,
    turns: utterances.length,
    labels,
    speakersFound: votes.size,
    speakersExpected: new Set(reference.map((t) => t.speaker)).size,
  };
}
