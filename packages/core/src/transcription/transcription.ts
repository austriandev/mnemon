import { formatTimestamp } from "../transcript/timestamp.ts";

/**
 * One stretch of speech, as a speech-to-text service returns it once it has told the
 * speakers apart: a label for who ("A", "B", …), when it started, and the words.
 */
export interface Utterance {
  readonly speaker: string;
  /** Milliseconds from the start of the recording. */
  readonly startMs: number;
  readonly text: string;
}

export interface Transcription {
  readonly utterances: readonly Utterance[];
  /** The recording's length, which is what transcription is billed by. */
  readonly durationSeconds: number;
  /** The model that transcribed it. */
  readonly model: string;
}

/** Turns a recording into speaker-labelled text. Implementations call a speech-to-text service. */
export interface Transcriber {
  transcribe(audio: Uint8Array): Promise<Transcription>;
}

/**
 * Writes utterances as a Mnemon transcript, one turn per line:
 * `[HH:MM:SS] Name: text`. A label without a name becomes "Speaker A". Consecutive
 * utterances by the same name become one turn. Whatever is typed as a name can't
 * break the format: colons and line breaks are taken out, and a blank name falls back
 * to the label.
 */
export function toTranscript(
  utterances: readonly Utterance[],
  names: Readonly<Record<string, string>> = {},
): string {
  const turns: { name: string; startMs: number; text: string }[] = [];
  const ordered = [...utterances].sort((a, b) => a.startMs - b.startMs);
  for (const u of ordered) {
    const text = oneLine(u.text);
    if (text === "") continue;
    const name = nameFor(u.speaker, names);
    const last = turns.at(-1);
    if (last && last.name === name) last.text = `${last.text} ${text}`;
    else turns.push({ name, startMs: u.startMs, text });
  }
  return turns
    .map((t) => `[${formatTimestamp(Math.floor(t.startMs / 1000))}] ${t.name}: ${t.text}`)
    .join("\n");
}

/** Each speaker label once, in order of first appearance, with what they first said. */
export function speakersOf(
  utterances: readonly Utterance[],
): { label: string; firstWords: string }[] {
  const seen = new Map<string, string>();
  for (const u of [...utterances].sort((a, b) => a.startMs - b.startMs)) {
    const text = oneLine(u.text);
    if (text !== "" && !seen.has(u.speaker)) seen.set(u.speaker, truncate(text, 90));
  }
  return [...seen].map(([label, firstWords]) => ({ label, firstWords }));
}

function nameFor(label: string, names: Readonly<Record<string, string>>): string {
  const typed = oneLine((names[label] ?? "").replaceAll(":", " - "));
  return typed === "" ? `Speaker ${label}` : typed.replace(/\s+-\s+/g, " - ");
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
