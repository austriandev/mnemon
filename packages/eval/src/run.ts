// pnpm eval [--yes] [--only retrieval,extraction,answers] [--configs <substring>] [--questions n]
// pnpm eval --rescore packages/eval/results/<run>.json
// Runs the labelled eval: retrieval, record extraction and answering, each model
// configuration over the same data. Prints the expected cost and spends nothing
// without --yes. Uses its own database (mnemon_eval), never the dev data.
// --rescore scores a saved run again with the current labels, without calling a model.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  ANTHROPIC_PRICE_PER_MILLION_TOKENS,
  type AnthropicModelId,
  createAnthropicModel,
  type Effort,
  type ModelUsage,
} from "@mnemon/anthropic";
import {
  ANSWER_SCHEMA,
  ANSWER_SYSTEM_PROMPT,
  type Answer,
  ask,
  buildExtractionPrompt,
  chunkTurns,
  type Embedder,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  type Extraction,
  extractRecords,
  parseTranscript,
  retrieve,
  type SearchHit,
  type Turn,
} from "@mnemon/core";
import { createChunkSearch, createMeetingStore, databaseUrl } from "@mnemon/db";
import { migrate } from "@mnemon/db/migrate";
import { createVoyageEmbedder } from "@mnemon/voyage";
import postgres from "postgres";
import {
  GOLD_RECORDS,
  type GoldQuestion,
  MEETINGS,
  type MeetingKey,
  QUESTIONS,
} from "./dataset.ts";
import {
  type AnswerScore,
  type ExtractionScore,
  type RetrievalScore,
  scoreAnswer,
  scoreExtraction,
  scoreRetrieval,
} from "./score.ts";

interface ModelConfig {
  readonly model: AnthropicModelId;
  readonly effort: Effort;
}
const label = (c: ModelConfig) => `${c.model}/${c.effort}`;

interface ExtractionCase {
  readonly config: ModelConfig;
  readonly meeting: MeetingKey;
  readonly ms: number;
  readonly usage: readonly ModelUsage[];
  readonly extraction?: Extraction;
  readonly score?: ExtractionScore;
  readonly error?: string;
}
interface AnswerCase {
  readonly config: ModelConfig;
  readonly question: string;
  readonly ms: number;
  readonly usage: readonly ModelUsage[];
  readonly answer?: Answer;
  readonly score?: AnswerScore;
  readonly error?: string;
}
type RetrievalRows = Record<string, { recallAt: Record<number, number>; mrr: number }>;
interface SavedRun {
  readonly ids: Record<MeetingKey, string>;
  readonly retrieval?: RetrievalRows;
  readonly extraction?: readonly ExtractionCase[];
  readonly answers?: readonly AnswerCase[];
}

// The current choices first (ADR-0006: extraction at high; ADR-0007: answering at medium).
const EXTRACTION_CONFIGS: readonly ModelConfig[] = [
  { model: "claude-opus-5-5", effort: "high" },
  { model: "claude-opus-5-5", effort: "medium" },
  { model: "claude-sonnet-5-5", effort: "high" },
  { model: "claude-sonnet-5-5", effort: "medium" },
  { model: "claude-haiku-5-5", effort: "medium" },
];
const ANSWER_CONFIGS: readonly ModelConfig[] = [
  { model: "claude-opus-5-5", effort: "medium" },
  { model: "claude-opus-5-5", effort: "high" },
  { model: "claude-sonnet-5-5", effort: "medium" },
  { model: "claude-haiku-5-5", effort: "medium" },
];
const RETRIEVAL_KS = [2, 4, 8] as const;
const CONCURRENCY = 4;

// Cost estimate inputs (ADR-0006): ~2 characters per token on these prompts. Opus 5.5,
// Sonnet 5.5 and Haiku 5.5 counted the same input tokens for the same prompt in run 1.
// Output allowances are upper estimates: run 1's largest were 3,206 tokens for an
// extraction and 884 for an answer.
const CHARS_PER_TOKEN = 2;
const EXTRACTION_OUTPUT_ALLOWANCE = 6_000;
const ANSWER_INPUT_ALLOWANCE = 6_000;
const ANSWER_OUTPUT_ALLOWANCE = 1_200;

const { values } = parseArgs({
  options: {
    yes: { type: "boolean", default: false },
    only: { type: "string", default: "retrieval,extraction,answers" },
    configs: { type: "string" },
    questions: { type: "string" },
    rescore: { type: "string" },
  },
});
const parts = new Set(values.only.split(","));
const pick = (configs: readonly ModelConfig[]) =>
  configs.filter((c) => !values.configs || label(c).includes(values.configs));
const extractionConfigs = parts.has("extraction") ? pick(EXTRACTION_CONFIGS) : [];
const answerConfigs = parts.has("answers") ? pick(ANSWER_CONFIGS) : [];
const questions = QUESTIONS.slice(0, values.questions ? Number(values.questions) : undefined);

const meetings = MEETINGS.map((m) => {
  const source = readFileSync(new URL(`../../core/fixtures/${m.file}`, import.meta.url), "utf8");
  const parsed = parseTranscript(source);
  if (!parsed.ok) throw new Error(`${m.file} does not parse`);
  return { ...m, source, turns: parsed.turns, chunks: chunkTurns(parsed.turns) };
});

if (values.rescore) {
  const run = JSON.parse(readFileSync(values.rescore, "utf8")) as SavedRun;
  if (run.retrieval) printRetrieval(run.retrieval, "saved, not rescored");
  if (run.extraction) {
    printExtraction(
      run.extraction.map((c) =>
        c.extraction
          ? { ...c, score: scoreExtraction(c.extraction.records, GOLD_RECORDS[c.meeting]) }
          : c,
      ),
    );
  }
  if (run.answers) {
    printAnswers(
      run.answers.map((c) => {
        const question = QUESTIONS.find((q) => q.id === c.question);
        return c.answer && question ? { ...c, score: scoreAnswer(c.answer, question, run.ids) } : c;
      }),
    );
  }
  process.exit(0);
}

// --- Expected cost, before anything is spent ---------------------------------------

function usd(model: AnthropicModelId, input: number, output: number) {
  const price = ANTHROPIC_PRICE_PER_MILLION_TOKENS[model];
  return (input * price.input + output * price.output) / 1e6;
}
const extractionInput = (turns: readonly Turn[]) =>
  Math.ceil(
    (EXTRACTION_SYSTEM_PROMPT.length +
      buildExtractionPrompt(turns).length +
      JSON.stringify(EXTRACTION_SCHEMA).length) /
      CHARS_PER_TOKEN,
  );
const answerInput = Math.max(
  ANSWER_INPUT_ALLOWANCE,
  Math.ceil((ANSWER_SYSTEM_PROMPT.length + JSON.stringify(ANSWER_SCHEMA).length) / CHARS_PER_TOKEN),
);
const plan = [
  ...extractionConfigs.map((c) => ({
    what: `extraction ${label(c)} x ${meetings.length} meetings`,
    usd: meetings.reduce(
      (sum, m) => sum + usd(c.model, extractionInput(m.turns), EXTRACTION_OUTPUT_ALLOWANCE),
      0,
    ),
  })),
  ...answerConfigs.map((c) => ({
    what: `answers ${label(c)} x ${questions.length} questions`,
    usd: questions.length * usd(c.model, answerInput, ANSWER_OUTPUT_ALLOWANCE),
  })),
];
console.log("Plan:");
if (parts.has("retrieval")) console.log("  retrieval: Voyage query embeddings only (~$0)");
for (const p of plan) console.log(`  ${p.what}: up to ~$${p.usd.toFixed(3)}`);
const expected = plan.reduce((sum, p) => sum + p.usd, 0);
console.log(`Expected cost: up to ~$${expected.toFixed(3)} at list price.`);
if (!values.yes) {
  console.log("Nothing spent. Run again with --yes to start.");
  process.exit(0);
}

// --- Eval database, with the meetings ingested once ---------------------------------

const evalUrl = new URL(process.env.MNEMON_EVAL_DATABASE_URL ?? databaseUrl());
if (!process.env.MNEMON_EVAL_DATABASE_URL) evalUrl.pathname = "/mnemon_eval";
const admin = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
const name = evalUrl.pathname.slice(1);
const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
if (!exists) await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
await admin.end();

const sql = postgres(evalUrl.toString(), { onnotice: () => {} });
const spent: { what: string; usd: number }[] = [];
try {
  await migrate(sql);
  const store = createMeetingStore(sql);
  const search = createChunkSearch(sql);
  const voyage = createVoyageEmbedder({ apiKey: process.env.MNEMON_VOYAGE_API_KEY ?? "" });

  const ids = {} as Record<MeetingKey, string>;
  for (const m of meetings) {
    const found = await store.findBySource(m.source);
    if (found) {
      ids[m.key] = found.id;
      continue;
    }
    const { vectors } = await voyage.embed(
      m.chunks.map((c) => c.text),
      "document",
    );
    const saved = await store.save({
      title: m.title,
      source: m.source,
      turns: m.turns,
      chunks: m.chunks,
      embeddings: { model: voyage.model, vectors },
    });
    ids[m.key] = saved.id;
  }

  // One embedding request for every question; retrieval then reads from the cache.
  const { vectors } = await voyage.embed(
    questions.map((q) => q.question),
    "query",
  );
  const cache = new Map(questions.map((q, i) => [q.question.trim(), vectors[i] ?? []]));
  const embedder: Embedder = {
    model: voyage.model,
    dimensions: voyage.dimensions,
    async embed(texts, inputType) {
      const hits = texts.map((t) => cache.get(t.trim()));
      if (inputType === "query" && hits.every((v) => v !== undefined)) {
        return { vectors: hits as number[][], tokens: 0 };
      }
      return voyage.embed(texts, inputType);
    },
  };

  const results: Record<string, unknown> = { date: new Date().toISOString(), ids };

  if (parts.has("retrieval")) {
    results.retrieval = await runRetrieval(questions.filter((q) => q.answerable));
  }
  if (extractionConfigs.length > 0) results.extraction = await runExtraction();
  if (answerConfigs.length > 0) results.answers = await runAnswers();

  results.spentUsd = spent.reduce((sum, s) => sum + s.usd, 0);
  console.log(
    `\nSpent: $${(results.spentUsd as number).toFixed(3)} (expected up to ~$${expected.toFixed(3)}).`,
  );
  mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
  const file = new URL(
    `../results/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`,
    import.meta.url,
  );
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Full results: ${file.pathname}`);

  // --- Retrieval: hybrid against each search alone ----------------------------------

  async function runRetrieval(answerable: readonly GoldQuestion[]) {
    const rows: RetrievalRows = {};
    const searches: Record<string, (q: GoldQuestion) => Promise<SearchHit[]>> = {
      hybrid: async (q) => (await retrieve(q.question, { embedder, search, limit: 8 })).chunks,
      keyword: (q) => search.keyword(q.question, { limit: 8 }),
      vector: async (q) => {
        const { vectors } = await embedder.embed([q.question], "query");
        return search.vector(vectors[0] ?? [], { limit: 8, model: embedder.model });
      },
    };
    for (const [name, run] of Object.entries(searches)) {
      const scores: RetrievalScore[] = [];
      for (const q of answerable)
        scores.push(scoreRetrieval(await run(q), q.evidence, ids, RETRIEVAL_KS));
      rows[name] = {
        recallAt: Object.fromEntries(
          RETRIEVAL_KS.map((k) => [k, mean(scores.map((s) => s.recallAt[k] ?? 0))]),
        ),
        mrr: mean(scores.map((s) => s.reciprocalRank)),
      };
    }
    printRetrieval(rows, `${answerable.length} answerable questions`);
    return rows;
  }

  // --- Extraction: every config over every meeting ----------------------------------

  async function runExtraction() {
    const cases = extractionConfigs.flatMap((config) =>
      meetings.map((meeting) => ({ config, meeting })),
    );
    const done = await pool(cases, async ({ config, meeting }): Promise<ExtractionCase> => {
      const usage: ModelUsage[] = [];
      const started = Date.now();
      try {
        const extraction: Extraction = await extractRecords(meeting.turns, model(config, usage));
        const score = scoreExtraction(extraction.records, GOLD_RECORDS[meeting.key]);
        progress(
          `extraction ${label(config)} ${meeting.key}: ${score.hits} hits, ${score.extras.length} extras`,
        );
        return { config, meeting: meeting.key, ms: Date.now() - started, usage, extraction, score };
      } catch (error) {
        progress(`extraction ${label(config)} ${meeting.key}: ERROR ${String(error)}`);
        return {
          config,
          meeting: meeting.key,
          ms: Date.now() - started,
          usage,
          error: String(error),
        };
      }
    });
    printExtraction(done);
    return done;
  }

  // --- Answers: every config over every question, through ask() ---------------------

  async function runAnswers() {
    const cases = answerConfigs.flatMap((config) =>
      questions.map((question) => ({ config, question })),
    );
    const done = await pool(cases, async ({ config, question }): Promise<AnswerCase> => {
      const usage: ModelUsage[] = [];
      const started = Date.now();
      try {
        const { answer } = await ask(question.question, {
          embedder,
          search,
          transcripts: store,
          model: model(config, usage),
        });
        const score = scoreAnswer(answer, question, ids);
        progress(
          `answer ${label(config)} ${question.id}: ${score.outcome}${score.correct ? "" : " (wrong)"}`,
        );
        return { config, question: question.id, ms: Date.now() - started, usage, answer, score };
      } catch (error) {
        progress(`answer ${label(config)} ${question.id}: ERROR ${String(error)}`);
        return {
          config,
          question: question.id,
          ms: Date.now() - started,
          usage,
          error: String(error),
        };
      }
    });
    printAnswers(done);
    return done;
  }

  function model(config: ModelConfig, usage: ModelUsage[]) {
    return createAnthropicModel({
      apiKey: process.env.MNEMON_ANTHROPIC_API_KEY ?? "",
      model: config.model,
      effort: config.effort,
      onUsage: (u) => {
        usage.push(u);
        spent.push({ what: label(config), usd: u.costUsd ?? 0 });
      },
    });
  }
} finally {
  await sql.end();
}

// --- Tables, from cases fresh or saved -------------------------------------------------

function configsOf(cases: readonly { config: ModelConfig }[]): ModelConfig[] {
  const seen = new Map<string, ModelConfig>();
  for (const c of cases) if (!seen.has(label(c.config))) seen.set(label(c.config), c.config);
  return [...seen.values()];
}

function printRetrieval(rows: RetrievalRows, note: string) {
  console.log(`\nRetrieval (${note}; ${chunkCount()} chunks in all)`);
  console.log("| Search | Recall@2 | Recall@4 | Recall@8 | MRR |\n| --- | --- | --- | --- | --- |");
  for (const [name, r] of Object.entries(rows)) {
    const recalls = RETRIEVAL_KS.map((k) => pct(r.recallAt[k] ?? 0)).join(" | ");
    console.log(`| ${name} | ${recalls} | ${r.mrr.toFixed(2)} |`);
  }
}

function printExtraction(done: readonly ExtractionCase[]) {
  console.log(`\nExtraction (${meetings.length} meetings; decisions and action items)`);
  console.log(
    "| Model | Effort | Precision | Recall | Owners | Rejected | Errors | Cost / meeting | Time / meeting |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const config of configsOf(done)) {
    const rows = done.filter((d) => label(d.config) === label(config));
    const ok = rows.flatMap((r) =>
      r.score && r.extraction ? [{ ...r, score: r.score, extraction: r.extraction }] : [],
    );
    const hits = sum(ok.map((r) => r.score.hits));
    const extras = sum(ok.map((r) => r.score.extras.length));
    const misses = sum(ok.map((r) => r.score.misses.length));
    console.log(
      `| ${config.model} | ${config.effort} | ${pct(hits / (hits + extras))} | ${pct(hits / (hits + misses))} | ` +
        `${sum(ok.map((r) => r.score.ownersCorrect))}/${sum(ok.map((r) => r.score.ownersChecked))} | ` +
        `${sum(ok.map((r) => r.extraction.rejected.length))} | ${rows.length - ok.length} | ` +
        `$${(costOf(rows) / rows.length).toFixed(3)} | ${(mean(rows.map((r) => r.ms)) / 1000).toFixed(0)} s |`,
    );
  }
}

function printAnswers(done: readonly AnswerCase[]) {
  const asked = QUESTIONS.filter((q) => done.some((d) => d.question === q.id));
  const isAnswerable = (id: string) => asked.find((q) => q.id === id)?.answerable === true;
  const answerable = asked.filter((q) => q.answerable).length;
  console.log(
    `\nAnswers (${asked.length} questions: ${answerable} answerable, ${asked.length - answerable} not)`,
  );
  console.log(
    "| Model | Effort | Correct | Answerable correct | Not-found correct | Cites evidence | Rejected | Errors | Cost / question | Median time |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  const wrong: string[] = [];
  for (const config of configsOf(done)) {
    const rows = done.filter((d) => label(d.config) === label(config));
    const ok = rows.flatMap((r) =>
      r.score && r.answer ? [{ ...r, score: r.score, answer: r.answer }] : [],
    );
    const yes = ok.filter((r) => isAnswerable(r.question));
    const no = ok.filter((r) => !isAnswerable(r.question));
    const cited = ok.filter((r) => r.score.citesEvidence !== null);
    console.log(
      `| ${config.model} | ${config.effort} | ${count(ok, rows.length)} | ${count(yes, answerable)} | ` +
        `${count(no, asked.length - answerable)} | ` +
        `${cited.filter((r) => r.score.citesEvidence).length}/${cited.length} | ` +
        `${ok.filter((r) => r.answer.status === "rejected").length} | ${rows.length - ok.length} | ` +
        `$${(costOf(rows) / rows.length).toFixed(4)} | ${(median(rows.map((r) => r.ms)) / 1000).toFixed(1)} s |`,
    );
    for (const r of ok.filter((r) => !r.score.correct)) {
      wrong.push(
        `${label(config)} ${r.question}: ${r.score.outcome}, facts ${r.score.factsFound}/${r.score.factsTotal}, cites evidence ${r.score.citesEvidence}`,
      );
    }
  }
  for (const w of wrong) console.log(`  wrong: ${w}`);
}

function chunkCount() {
  return sum(meetings.map((m) => m.chunks.length));
}
function costOf(rows: readonly { usage: readonly ModelUsage[] }[]) {
  return sum(rows.flatMap((r) => r.usage.map((u) => u.costUsd ?? 0)));
}
function count(rows: readonly { score: { correct: boolean } }[], of: number) {
  return `${rows.filter((r) => r.score.correct).length}/${of}`;
}
function sum(xs: readonly number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function mean(xs: readonly number[]) {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}
function median(xs: readonly number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor((s.length - 1) / 2)] ?? 0);
}
function pct(x: number) {
  return Number.isFinite(x) ? `${Math.round(x * 100)}%` : "-";
}
function progress(line: string) {
  process.stderr.write(`  ${line}\n`);
}

/** Runs tasks with at most CONCURRENCY in flight, keeping input order. */
async function pool<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i] as T);
      }
    }),
  );
  return out;
}
