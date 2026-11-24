"use server";

import { speakersOf, type Utterance } from "@mnemon/core";
import { estimateTranscriptionUsd, readAudio } from "@/server/audio.ts";
import { requireSession } from "@/server/auth.ts";
import { overLimitMessage } from "@/server/budget.ts";
import { mnemon } from "@/server/mnemon.ts";

export type TranscribeResult =
  | {
      readonly kind: "transcribed";
      readonly utterances: readonly Utterance[];
      readonly speakers: readonly { readonly label: string; readonly firstWords: string }[];
      readonly durationSeconds: number;
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * Turns a recording into speaker-labelled utterances. Nothing is stored: the browser
 * writes them into the transcript box, the person names the speakers, and the meeting
 * is then checked and added like any pasted transcript (ADR-0018).
 */
export async function transcribeAudio(form: FormData): Promise<TranscribeResult> {
  const session = await requireSession();
  const audio = await readAudio(form);
  if (!audio.ok) return { kind: "error", message: audio.message };
  if (!process.env.MNEMON_ASSEMBLYAI_API_KEY) {
    return {
      kind: "error",
      message:
        "Recordings aren't set up on this server: it needs an AssemblyAI key (MNEMON_ASSEMBLYAI_API_KEY). Paste a transcript instead.",
    };
  }
  const app = (await mnemon()).forSession(session);
  try {
    const budget = await app.budget(estimateTranscriptionUsd(audio.bytes.length));
    if (!budget.ok) return { kind: "error", message: overLimitMessage(budget) };
    const { utterances, durationSeconds } = await app.transcriber.transcribe(audio.bytes);
    if (utterances.length === 0) {
      return { kind: "error", message: "No speech was found in the recording." };
    }
    return { kind: "transcribed", utterances, speakers: speakersOf(utterances), durationSeconds };
  } catch (error) {
    console.error(JSON.stringify({ event: "transcribe_failed", error: String(error) }));
    return {
      kind: "error",
      message: "The recording couldn't be transcribed. Try again in a moment.",
    };
  } finally {
    await app.recorded();
  }
}
