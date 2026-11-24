import type { Transcriber, Transcription, Utterance } from "@mnemon/core";

/**
 * List prices in USD per hour of audio, pre-recorded, from
 * https://www.assemblyai.com/pricing (page dated 2026-11-10). Speaker diarization is an
 * add-on on top. New accounts get $50 of free credit, so the logged cost is what the
 * call would cost past it.
 */
export const TRANSCRIPTION_PRICE_PER_HOUR = {
  "assemblyai-stt-3-7": 0.21,
  "universal-2": 0.15,
} as const;
const DIARIZATION_PER_HOUR = 0.02;

export type AssemblyAiModel = keyof typeof TRANSCRIPTION_PRICE_PER_HOUR;

/** What `seconds` of audio cost to transcribe with speaker labels, at list price. */
export function transcriptionCostUsd(
  seconds: number,
  model: AssemblyAiModel = "assemblyai-stt-3-7",
): number {
  return round((seconds / 3600) * (TRANSCRIPTION_PRICE_PER_HOUR[model] + DIARIZATION_PER_HOUR));
}

export interface TranscriptionUsage {
  readonly provider: "assemblyai";
  readonly model: AssemblyAiModel;
  readonly audioSeconds: number;
  readonly costUsd: number;
}

export interface AssemblyAiTranscriberOptions {
  readonly apiKey: string;
  readonly model?: AssemblyAiModel;
  /** Called once per transcription; defaults to a JSON line on stderr. */
  readonly onUsage?: (usage: TranscriptionUsage) => void;
  /** How long to wait between status checks. */
  readonly pollIntervalMs?: number;
  /** Give up after this long. Under a serverless function's 300 s, with room to spare. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const API = "https://api.assemblyai.com/v2";

interface TranscriptResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  audio_duration?: number;
  utterances?: { speaker: string; start: number; end: number; text: string }[] | null;
}

/**
 * Transcribes a recording with speaker labels: upload it, ask for a transcript with
 * `speaker_labels`, poll until it's done, then delete it from AssemblyAI. The delete
 * is best effort: the transcript has been read, so a failed delete is logged, not
 * thrown.
 */
export function createAssemblyAiTranscriber({
  apiKey,
  model = "assemblyai-stt-3-7",
  onUsage = logUsage,
  pollIntervalMs = 3_000,
  timeoutMs = 240_000,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: AssemblyAiTranscriberOptions): Transcriber {
  if (!apiKey) {
    throw new Error(
      "No AssemblyAI API key: set MNEMON_ASSEMBLYAI_API_KEY in .env (see .env.example).",
    );
  }
  const auth = { authorization: apiKey };

  async function call<T>(what: string, url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AssemblyAI ${what} failed: HTTP ${response.status} ${detail}`);
    }
    return (await response.json()) as T;
  }

  return {
    async transcribe(audio: Uint8Array): Promise<Transcription> {
      const { upload_url } = await call<{ upload_url: string }>("upload", `${API}/upload`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/octet-stream" },
        // A copy backed by a plain ArrayBuffer, the body type fetch accepts.
        body: new Uint8Array(audio),
      });
      const { id } = await call<{ id: string }>("request", `${API}/transcript`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          audio_url: upload_url,
          speaker_labels: true,
          speech_models: [model],
        }),
      });

      const started = now();
      let transcript: TranscriptResponse;
      for (;;) {
        transcript = await call<TranscriptResponse>("status check", `${API}/transcript/${id}`, {
          headers: auth,
        });
        if (transcript.status === "completed") break;
        if (transcript.status === "error") {
          throw new Error(
            `AssemblyAI could not transcribe the recording: ${transcript.error ?? "no reason given"}`,
          );
        }
        if (now() - started >= timeoutMs) {
          throw new Error(`AssemblyAI had not finished after ${Math.round(timeoutMs / 1000)} s.`);
        }
        await sleep(pollIntervalMs);
      }

      const raw = transcript.utterances ?? [];
      const utterances: Utterance[] = raw.map((u) => ({
        speaker: u.speaker,
        startMs: u.start,
        text: u.text,
      }));
      // audio_duration is in seconds; the last utterance's end is the fallback.
      const durationSeconds = transcript.audio_duration ?? Math.ceil((raw.at(-1)?.end ?? 0) / 1000);
      onUsage({
        provider: "assemblyai",
        model,
        audioSeconds: durationSeconds,
        costUsd: transcriptionCostUsd(durationSeconds, model),
      });

      // The transcript is ours now; it needn't stay with a sub-processor.
      await fetch(`${API}/transcript/${id}`, { method: "DELETE", headers: auth })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({ event: "transcript_not_deleted", id, error: String(error) }),
          );
        });

      return { utterances, durationSeconds, model };
    },
  };
}

const round = (usd: number) => Math.round(usd * 1e7) / 1e7;

function logUsage(usage: TranscriptionUsage): void {
  console.error(JSON.stringify({ event: "model_call", ...usage }));
}
