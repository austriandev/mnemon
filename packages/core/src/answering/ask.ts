import type { LanguageModel } from "../extraction/types.ts";
import { type RetrieveOptions, retrieve } from "../retrieval/retrieve.ts";
import type { RetrievedChunk } from "../retrieval/types.ts";
import { answer } from "./answer.ts";
import type { AskResult, Excerpt, TranscriptSource } from "./types.ts";

export interface AskOptions extends RetrieveOptions {
  readonly transcripts: TranscriptSource;
  readonly model: LanguageModel;
}

/**
 * Answers a question about the stored meetings: retrieves chunks, shows the model the
 * turns they cover (meetings in order of their best chunk, turns in order), and checks
 * every citation in the answer. Returns what was retrieved and shown, so an answer can
 * be traced back to why each excerpt was in front of the model.
 */
export async function ask(question: string, options: AskOptions): Promise<AskResult> {
  const { transcripts, model, ...retrieveOptions } = options;
  const { chunks, embeddingTokens } = await retrieve(question, retrieveOptions);

  const excerpts: Excerpt[] = [];
  for (const [meetingId, turnIndices] of turnsByMeeting(chunks)) {
    const excerpt = await transcripts.excerpt(meetingId, turnIndices);
    if (excerpt) excerpts.push(excerpt);
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
