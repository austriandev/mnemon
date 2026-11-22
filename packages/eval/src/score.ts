import type { Answer, MeetingRecord, SearchHit } from "@mnemon/core";
import type { Evidence, GoldQuestion, GoldRecord, MeetingKey } from "./dataset.ts";

export interface ExtractionScore {
  /** Gold records (not optional) matched by a predicted record. */
  readonly hits: number;
  /** Gold records (not optional) no predicted record matched. */
  readonly misses: readonly GoldRecord[];
  /** Predicted decisions and action items that match no gold record, or repeat a matched one. */
  readonly extras: readonly MeetingRecord[];
  /** Matched action items whose owner names the gold owner. */
  readonly ownersCorrect: number;
  readonly ownersChecked: number;
}

/**
 * Matches predicted decisions and action items to gold records: same kind, and the
 * prediction cites at least one of the gold record's turns. Each gold record matches
 * once; required gold records are matched before optional ones.
 */
export function scoreExtraction(
  predicted: readonly MeetingRecord[],
  gold: readonly GoldRecord[],
): ExtractionScore {
  const matched = new Set<GoldRecord>();
  const extras: MeetingRecord[] = [];
  let ownersCorrect = 0;
  let ownersChecked = 0;
  const ordered = [...gold.filter((g) => !g.optional), ...gold.filter((g) => g.optional)];

  for (const record of predicted) {
    if (record.kind === "topic") continue;
    const cited = new Set(record.citations.map((c) => c.turnIndex));
    const candidates = ordered.filter(
      (g) => g.kind === record.kind && g.turns.some((t) => cited.has(t)),
    );
    const match = candidates.find((g) => !matched.has(g));
    if (!match) {
      // Citing only optional records is neutral; anything else unmatched is noise.
      if (!(candidates.length > 0 && candidates.every((g) => g.optional))) extras.push(record);
      continue;
    }
    matched.add(match);
    if (match.kind === "action_item" && match.owner && !match.optional) {
      ownersChecked++;
      if (sameOwner(record.owner, match.owner)) ownersCorrect++;
    }
  }
  const required = gold.filter((g) => !g.optional);
  return {
    hits: required.filter((g) => matched.has(g)).length,
    misses: required.filter((g) => !matched.has(g)),
    extras,
    ownersCorrect,
    ownersChecked,
  };
}

function sameOwner(predicted: string | null, gold: string): boolean {
  if (!predicted) return false;
  const norm = (name: string) =>
    name
      .toLowerCase()
      .replace(/\bdr\.?\s+/g, "")
      .trim();
  const [p, g] = [norm(predicted), norm(gold)];
  return p.includes(g) || g.includes(p);
}

export interface RetrievalScore {
  /** For each k: the share of evidence turns covered by the top k chunks. */
  readonly recallAt: Readonly<Record<number, number>>;
  /** 1 / rank of the first chunk covering any evidence turn; 0 if none does. */
  readonly reciprocalRank: number;
}

export function scoreRetrieval(
  ranked: readonly SearchHit[],
  evidence: readonly Evidence[],
  ids: Readonly<Record<MeetingKey, string>>,
  ks: readonly number[],
): RetrievalScore {
  const wanted = evidence.flatMap((e) =>
    e.turns.map((turn) => ({ meetingId: ids[e.meeting], turn })),
  );
  const covers = (hit: SearchHit, w: { meetingId: string; turn: number }) =>
    hit.meetingId === w.meetingId &&
    w.turn >= hit.chunk.turnRange.first &&
    w.turn <= hit.chunk.turnRange.last;

  const recallAt: Record<number, number> = {};
  for (const k of ks) {
    const top = ranked.slice(0, k);
    const found = wanted.filter((w) => top.some((hit) => covers(hit, w))).length;
    recallAt[k] = wanted.length === 0 ? 1 : found / wanted.length;
  }
  const first = ranked.findIndex((hit) => wanted.some((w) => covers(hit, w)));
  return { recallAt, reciprocalRank: first === -1 ? 0 : 1 / (first + 1) };
}

export interface AnswerScore {
  readonly outcome: Answer["status"];
  readonly correct: boolean;
  readonly factsFound: number;
  readonly factsTotal: number;
  /** Whether any citation points at an evidence turn; null when there is nothing to cite. */
  readonly citesEvidence: boolean | null;
}

/**
 * Correct means: for an answerable question, answered with every fact (any accepted
 * phrasing, case-insensitive) and at least one citation of an evidence turn; for an
 * unanswerable one, not_found. A rejected answer is never correct.
 */
export function scoreAnswer(
  answer: Answer,
  question: GoldQuestion,
  ids: Readonly<Record<MeetingKey, string>>,
): AnswerScore {
  const factsTotal = question.facts.length;
  if (answer.status !== "answered") {
    const correct =
      answer.status === "not_found" && (!question.answerable || question.acceptNotFound === true);
    return { outcome: answer.status, correct, factsFound: 0, factsTotal, citesEvidence: null };
  }
  const text = normalise([...answer.sentences.map((s) => s.text), answer.gaps ?? ""].join(" "));
  const factsFound = question.facts.filter((alternatives) =>
    alternatives.some((a) => text.includes(normalise(a))),
  ).length;
  const evidence = new Set(
    question.evidence.flatMap((e) => e.turns.map((t) => `${ids[e.meeting]}:${t}`)),
  );
  const citesEvidence =
    question.evidence.length === 0
      ? null
      : answer.sentences.some((s) =>
          s.citations.some((c) => evidence.has(`${c.meetingId}:${c.turnIndex}`)),
        );
  const correct = question.answerable && factsFound === factsTotal && citesEvidence === true;
  return { outcome: "answered", correct, factsFound, factsTotal, citesEvidence };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}
