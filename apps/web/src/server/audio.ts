// A recording sent from the browser to be transcribed: what the form holds, and what
// transcribing it may cost, worked out before anything is paid for (ADR-0018).
import { transcriptionCostUsd } from "@mnemon/assemblyai";

/**
 * Under Vercel's 4.5 MB request limit, with room for the form around it. At the
 * browser's voice recording rate that is about 15 minutes; longer files need a direct
 * upload to storage (ADR-0018).
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** The lowest bitrate a voice recording uses, so a file's size bounds its length. */
const MIN_VOICE_BITS_PER_SECOND = 16_000;

export type Audio =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly name: string }
  | { readonly ok: false; readonly message: string };

export async function readAudio(form: FormData): Promise<Audio> {
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Record something or choose an audio file." };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      message:
        "The recording is over 4 MB, the most the server accepts. Record up to about 15 minutes in the browser, or trim the file.",
    };
  }
  // Browsers label recordings audio/webm, or video/webm when no audio-only type exists.
  if (!/^(audio\/|video\/webm|video\/mp4)/.test(file.type)) {
    return {
      ok: false,
      message: "That isn't an audio file. Choose a recording, such as .m4a, .mp3 or .webm.",
    };
  }
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
}

/**
 * An upper estimate of what transcribing this many bytes costs: the longest recording
 * they could hold. The browser could report a duration, but the server can't trust it.
 */
export function estimateTranscriptionUsd(bytes: number): number {
  return transcriptionCostUsd((bytes * 8) / MIN_VOICE_BITS_PER_SECOND);
}
