import type { LanguageModel } from "../extraction/types.ts";
import { type RetrieveOptions, retrieve } from "../retrieval/retrieve.ts";
import type { RetrievedChunk } from "../retrieval/types.ts";
import { answer } from "./answer.ts";
import type { AskResult, Excerpt, TranscriptSource } from "./types.ts";

export interface AskOptions extends RetrieveOptions {
  readonly transcripts: TranscriptSource;
  readonly model: LanguageModel;
  /**
   * Show each retrieved meeting's extracted records, and the turns they cite, beside the
   * retrieved turns. Default true: retrieval alone can't list every item of a long
   * meeting (ADR-0011).
   */
  readonly records?: boolean;
}

/**
 * Answers a question about the stored meetings: retrieves chunks, shows the model the
 * turns they cover (meetings in order of their best chunk, turns in order) with each
 * meeting's extracted records, and checks every citation in the answer. Returns what was retrieved and shown, so an answer can
 * be traced back to why each excerpt was in front of the model.
 */
export async function ask(question: string, options: AskOptions): Promise<AskResult> {
  const { transcripts, model, records: withRecords = true, ...retrieveOptions } = options;
  const { chunks, embeddingTokens } = await retrieve(question, retrieveOptions);

  const excerpts: Excerpt[] = [];
  for (const [meetingId, retrievedTurns] of turnsByMeeting(chunks)) {
    if (!withRecords) {
      const excerpt = await transcripts.excerpt(meetingId, retrievedTurns);
      if (excerpt) excerpts.push(excerpt);
      continue;
    }
    // The records' cited turns join the retrieved ones, so any record can be checked
    // against, and cited from, the transcript itself.
    const records = await transcripts.records(meetingId);
    const cited = records.flatMap((r) => r.citations.map((c) => c.turnIndex));
    const turnIndices = [...new Set([...retrievedTurns, ...cited])].sort((a, b) => a - b);
    const excerpt = await transcripts.excerpt(meetingId, turnIndices);
    if (excerpt) excerpts.push(records.length > 0 ? { ...excerpt, records } : excerpt);
  }
  return {
    answer: await answer(question, excerpts, model),
    retrieved: chunks,
    excerpts,
    embeddingTokens,
  };
}

/** Each meeting's turn indices covered by its retrieved chunks, meetings in rank order. */
function turnsByMeeting(chunks: readonly RetrievedChunk[]): Map<string, number[]> {
  const sets = new Map<string, Set<number>>();
  for (const { meetingId, chunk } of chunks) {
    const set = sets.get(meetingId) ?? new Set<number>();
    for (let i = chunk.turnRange.first; i <= chunk.turnRange.last; i++) set.add(i);
    sets.set(meetingId, set);
  }
  return new Map([...sets].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]));
}
