import { type AnswerCitation, type AskResult, formatTimestamp } from "@mnemon/core";

/** What the answer card renders: plain, serialisable data. */
export interface AnswerView {
  readonly status: "answered" | "not_found" | "rejected";
  readonly sentences: readonly { readonly text: string; readonly sources: readonly number[] }[];
  readonly sources: readonly SourceView[];
  readonly gaps: string | null;
  /**
   * Why an answer was withheld, as a fixed phrase. Neither the withheld text nor the
   * check's detail (which quotes the model) is sent to the browser; the server logs it.
   */
  readonly reason: string | null;
  readonly model: string | null;
  readonly searched: { readonly chunks: number; readonly meetings: number };
}

export interface SourceView {
  readonly n: number;
  readonly meetingTitle: string;
  readonly time: string;
  readonly speaker: string;
  readonly turnIndex: number;
  readonly lines: string;
  readonly quote: string;
  /** The turn on its meeting page. */
  readonly href: string;
}

export function presentAnswer({ answer, retrieved, excerpts }: AskResult): AnswerView {
  const searched = { chunks: retrieved.length, meetings: excerpts.length };
  const empty = { sentences: [], sources: [], gaps: null, searched, model: answer.model };
  if (answer.status === "not_found") return { ...empty, status: "not_found", reason: null };
  if (answer.status === "rejected") {
    return { ...empty, status: "rejected", reason: withheldBecause(answer.reason) };
  }

  const numbers = new Map<string, number>();
  const sources: SourceView[] = [];
  const numberOf = (c: AnswerCitation) => {
    const key = `${c.meetingId}:${c.turnIndex}:${c.quote}`;
    const known = numbers.get(key);
    if (known) return known;
    const n = sources.length + 1;
    numbers.set(key, n);
    sources.push(source(n, c));
    return n;
  };
  const source = (n: number, c: AnswerCitation): SourceView => {
    const excerpt = excerpts.find((e) => e.meetingId === c.meetingId);
    const turn = excerpt?.turns.find((t) => t.index === c.turnIndex);
    const { start, end } = turn?.sourceLines ?? { start: 0, end: 0 };
    return {
      n,
      meetingTitle: excerpt?.title ?? "Unknown meeting",
      time: turn ? formatTimestamp(turn.startSeconds) : "",
      speaker: turn?.speaker ?? "",
      turnIndex: c.turnIndex,
      lines: start === end ? `line ${start}` : `lines ${start}-${end}`,
      quote: c.quote,
      href: `/meetings/${encodeURIComponent(c.meetingId)}#turn-${c.turnIndex}`,
    };
  };

  return {
    status: "answered",
    sentences: answer.sentences.map((s) => ({
      text: s.text,
      sources: [...new Set(s.citations.map(numberOf))],
    })),
    sources,
    gaps: answer.gaps,
    reason: null,
    model: answer.model,
    searched,
  };
}

/** The check's reason, reduced to a phrase that repeats nothing the model wrote. */
function withheldBecause(reason: string): string {
  if (reason.includes(" quote ")) return "a quote didn't match the transcript";
  if (reason.includes("not in the excerpts")) return "it cited a passage it wasn't shown";
  if (reason.includes("no citation")) return "a sentence had no citation";
  return "it didn't have the expected shape";
}
