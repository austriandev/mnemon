// pnpm eval:transcription [--yes]
// Transcribes the synthetic sample recording with each AssemblyAI model and scores it
// against the script it was spoken from: word error rate and speaker attribution
// (ADR-0018). Prints the plan and its cost; spends nothing without --yes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type AssemblyAiModel,
  createAssemblyAiTranscriber,
  TRANSCRIPTION_PRICE_PER_HOUR,
  transcriptionCostUsd,
} from "@mnemon/assemblyai";
import { parseTranscript, toTranscript } from "@mnemon/core";
import { scoreSpeakers, wordErrorRate } from "./transcription-score.ts";

const ROOT = new URL("../../../", import.meta.url);
const AUDIO = new URL("apps/web/public/samples/bx17-line-huddle.m4a", ROOT);
const REFERENCE = new URL("packages/core/fixtures/audio/bx17-line-huddle.txt", ROOT);
const SAMPLE_SECONDS = 77;

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
const models = Object.keys(TRANSCRIPTION_PRICE_PER_HOUR) as AssemblyAiModel[];
const reference = parseTranscript(readFileSync(REFERENCE, "utf8"));
if (!reference.ok) throw new Error("The reference transcript does not parse.");

const estimate = models.reduce((sum, m) => sum + transcriptionCostUsd(SAMPLE_SECONDS, m), 0);
console.log(`Transcription eval: the ${SAMPLE_SECONDS} s sample, ${models.join(" and ")}.`);
console.log(`Expected cost: ~$${estimate.toFixed(4)}.`);
if (!values.yes) {
  console.log("Run again with --yes to run it.");
  process.exit(0);
}

const audio = new Uint8Array(readFileSync(AUDIO));
const referenceText = reference.turns.map((t) => t.text).join(" ");
const results = [];
for (const model of models) {
  let costUsd = 0;
  const started = Date.now();
  const transcriber = createAssemblyAiTranscriber({
    apiKey: process.env.MNEMON_ASSEMBLYAI_API_KEY ?? "",
    model,
    onUsage: (u) => {
      costUsd = u.costUsd;
      console.error(JSON.stringify({ event: "model_call", ...u }));
    },
  });
  const { utterances, durationSeconds } = await transcriber.transcribe(audio);
  const hypothesis = utterances.map((u) => u.text).join(" ");
  const speakers = scoreSpeakers(reference.turns, utterances);
  const result = {
    model,
    wer: wordErrorRate(referenceText, hypothesis),
    speakerTurnsCorrect: `${speakers.correct}/${speakers.turns}`,
    speakersFound: `${speakers.speakersFound}/${speakers.speakersExpected}`,
    meanStartOffsetMs: speakers.meanStartOffsetMs,
    labels: speakers.labels,
    durationSeconds,
    costUsd,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    transcript: toTranscript(utterances, speakers.labels),
  };
  results.push(result);
  console.log(
    `\n${model}: WER ${(result.wer * 100).toFixed(1)}% · speaker turns ${result.speakerTurnsCorrect} · speakers ${result.speakersFound} · starts off by ${(result.meanStartOffsetMs / 1000).toFixed(1)} s on average · $${costUsd.toFixed(4)} · ${result.seconds} s`,
  );
  for (const line of result.transcript.split("\n")) console.log(`  ${line}`);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const dir = new URL("packages/eval/results/", ROOT);
mkdirSync(dir, { recursive: true });
const file = `transcription-${stamp}.json`;
writeFileSync(new URL(file, dir), `${JSON.stringify({ date: new Date(), results }, null, 2)}\n`);
console.log(`\nSaved packages/eval/results/${file}`);
