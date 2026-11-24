// pnpm sample:recording
// Builds the synthetic sample recording behind "Try the sample recording" (ADR-0018): a
// short fictional meeting spoken by three ElevenLabs voices in a small room, with
// hesitations, a laugh, uneven pauses and a little talking over each other, on a steady
// room hum. Writes:
//   apps/web/public/samples/bx17-line-huddle.m4a        the recording (AAC, mono, 32 kbps)
//   packages/core/fixtures/audio/bx17-line-huddle.txt   the reference transcript, each turn
//                                                       at the moment it starts in the audio
// Needs ELEVENLABS_API_KEY (in .env.local, from `npx @elevenlabs/cli onboard init`) and
// ffmpeg. Costs about 1,600 ElevenLabs characters; the count is printed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const ROOT = new URL("../", import.meta.url).pathname;
const AUDIO_OUT = join(ROOT, "apps/web/public/samples/bx17-line-huddle.m4a");
const TEXT_OUT = join(ROOT, "packages/core/fixtures/audio/bx17-line-huddle.txt");

// Fictional people and product (CLAUDE.md: demo data is synthetic). Pre-made voices, so
// any plan can use them; each person sits at a different distance from the microphone.
const PEOPLE = {
  "Rui Almeida": { voiceId: "iP95p4xoKVk53GoZ742B", distance: 0.15 }, // Chris
  "Dr. Grace Mensah": { voiceId: "Xb7hH8MSUJpSbSDYk0k2", distance: 0.35 }, // Alice
  "Tomas Berg": { voiceId: "IKne3meq5aSn9XLyUdCD", distance: 0.5 }, // Charlie
} as const;
type Person = keyof typeof PEOPLE;

// `gapMs` is the pause after the previous line ends; negative means talking over it.
const LINES: { who: Person; text: string; gapMs: number }[] = [
  {
    who: "Rui Almeida",
    gapMs: 300,
    text: "Okay, morning, everyone. Let's, uh, let's keep this quick. This is the BX-17 blister line huddle for Tuesday.",
  },
  {
    who: "Dr. Grace Mensah",
    gapMs: 450,
    text: "Morning. So, the sealer drifted again overnight. It got up to 190 degrees before the alarm went off.",
  },
  { who: "Rui Almeida", gapMs: 250, text: "190? Again?" },
  { who: "Dr. Grace Mensah", gapMs: 200, text: "Yeah. Second time this month." },
  {
    who: "Tomas Berg",
    gapMs: 600,
    text: "So maintenance swapped the thermocouple at about six this morning, and it's been holding at 180 degrees since. Nice and steady.",
  },
  {
    who: "Rui Almeida",
    gapMs: 400,
    text: "Okay, good. And did anything from the night shift fail the seal check?",
  },
  {
    who: "Dr. Grace Mensah",
    gapMs: 500,
    text: "Two trays failed. They're in quarantine, and I've opened a deviation.",
  },
  { who: "Tomas Berg", gapMs: -350, text: "Right." },
  {
    who: "Rui Almeida",
    gapMs: 700,
    text: "Right. So here's the decision, then. The line restarts at ten, and we do a seal check every thirty minutes for the rest of the week.",
  },
  {
    who: "Tomas Berg",
    gapMs: 350,
    text: "Fine by me. I'll log every reading in the batch record and, um, send the summary to quality by Thursday.",
  },
  {
    who: "Dr. Grace Mensah",
    gapMs: -200,
    text: "And I'll close the deviation once the root cause report is in. So, by Friday.",
  },
  {
    who: "Rui Almeida",
    gapMs: 550,
    text: "[laughs] Great. Shortest huddle we've had in a while. Thanks, both.",
  },
];

const client = new ElevenLabsClient();
const work = mkdtempSync(join(tmpdir(), "mnemon-sample-"));
let characters = 0;

const seconds = (file: string) =>
  Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]).toString(),
  );

const placed: { who: Person; text: string; file: string; startMs: number }[] = [];
let endMs = 0;
for (const [i, line] of LINES.entries()) {
  const { data, rawResponse } = await client.textToSpeech
    .convert(PEOPLE[line.who].voiceId, {
      text: line.text,
      modelId: "eleven_v4",
      outputFormat: "mp3_44100_128",
      voiceSettings: { stability: 0.4, similarityBoost: 0.75 },
      audioEffects: {
        environmentId: "small_room",
        distance: PEOPLE[line.who].distance,
        sendLevel: 0.3,
      },
      // The lines around it, so each one is delivered as part of the conversation.
      ...(LINES[i - 1] ? { previousText: LINES[i - 1]?.text } : {}),
      ...(LINES[i + 1] ? { nextText: LINES[i + 1]?.text } : {}),
    })
    .withRawResponse();
  characters += Number(rawResponse.headers.get("x-character-count") ?? line.text.length);
  const file = join(work, `${i}.mp3`);
  writeFileSync(file, new Uint8Array(await new Response(data).arrayBuffer()));
  const startMs = Math.max(0, endMs + line.gapMs);
  placed.push({ who: line.who, text: line.text, file, startMs });
  endMs = Math.max(endMs, startMs + seconds(file) * 1000);
  console.log(`  ${i + 1}/${LINES.length} ${line.who}`);
}

// Every line at its moment, over a quiet room hum, mixed down to one channel.
const totalSeconds = endMs / 1000 + 0.8;
const inputs = placed.flatMap((p) => ["-i", p.file]);
const delays = placed.map(
  (p, k) => `[${k}:a]adelay=${Math.round(p.startMs)}:all=1,volume=1.0[a${k}]`,
);
const hum = `anoisesrc=color=brown:amplitude=0.012:duration=${totalSeconds.toFixed(2)}:sample_rate=44100,lowpass=f=400[hum]`;
const mix = `${placed.map((_, k) => `[a${k}]`).join("")}[hum]amix=inputs=${placed.length + 1}:normalize=0:duration=longest,alimiter=limit=0.95[out]`;
execFileSync("ffmpeg", [
  "-y",
  "-v",
  "error",
  ...inputs,
  "-filter_complex",
  [...delays, hum, mix].join(";"),
  "-map",
  "[out]",
  "-ac",
  "1",
  "-ar",
  "16000",
  "-c:a",
  "aac",
  "-b:a",
  "32k",
  "-t",
  totalSeconds.toFixed(2),
  AUDIO_OUT,
]);

// The reference: what each person said, from the moment they started. Stage cues such
// as [laughs] aren't words, so they stay out.
const stamp = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
const reference = placed
  .map((p) => `[${stamp(p.startMs)}] ${p.who}: ${p.text.replace(/\[[^\]]*\]\s*/g, "").trim()}`)
  .join("\n");
writeFileSync(TEXT_OUT, `${reference}\n`);

console.log(`${AUDIO_OUT}: ${totalSeconds.toFixed(1)} s, ${readFileSync(AUDIO_OUT).length} bytes`);
console.log(`${TEXT_OUT}: ${placed.length} turns`);
console.log(`ElevenLabs characters used: ${characters}`);
