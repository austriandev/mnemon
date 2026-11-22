// pnpm ingest <transcript.txt> [--title "Title"]
// Parse, chunk, extract records with Claude, embed with Voyage, and store one
// transcript. Prints the expected cost before any paid call.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { type AnthropicModelId, estimateCostUsd } from "@mnemon/anthropic";
import {
  approximateTokenCounter,
  buildExtractionPrompt,
  chunkTurns,
  EXTRACTION_SYSTEM_PROMPT,
  type Extraction,
  extractRecords,
  parseTranscript,
} from "@mnemon/core";
import { VOYAGE_PRICE_PER_MILLION_TOKENS } from "@mnemon/voyage";
import { connect } from "./wiring.ts";

// chars/4 undercounted real tokens by ~19% on the fixture (ADR-0003); pad estimates by 25%.
const TOKEN_MARGIN = 1.25;
// Room for adaptive thinking plus the JSON. An upper estimate, not a measurement.
const EXPECTED_EXTRACTION_OUTPUT_TOKENS = 6_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { title: { type: "string" } },
});
const [path] = positionals;
if (!path) {
  console.error('Usage: pnpm ingest <transcript.txt> [--title "Title"]');
  process.exit(2);
}

const source = readFileSync(path, "utf8");
const parsed = parseTranscript(source);
if (!parsed.ok) {
  console.error(`${path} was not ingested: ${parsed.errors.length} problem(s).`);
  for (const error of parsed.errors) console.error(`  ${error.code}: ${error.message}`);
  process.exit(1);
}
const { turns } = parsed;
const chunks = chunkTurns(turns);

const { sql, store, embedder, languageModel } = await connect();
try {
  // A transcript is stored once; check before paying to embed or extract it again.
  const existing = await store.findBySource(source);
  if (existing?.recordsModel) {
    console.log(`Already ingested as meeting ${existing.id} ("${existing.title}"). Nothing to do.`);
  } else {
    const model = languageModel();
    const embedTokens = existing
      ? 0
      : chunks.reduce((sum, c) => sum + approximateTokenCounter.count(c.text), 0);
    printExpectedCost(model.model as AnthropicModelId, embedTokens);

    const extraction = await extractRecords(turns, model);
    report(extraction);
    const records = { model: extraction.model ?? model.model, items: extraction.records };

    if (existing) {
      // Stored before extraction existed: its chunks and embeddings are already there.
      await store.addRecords(existing.id, records);
      console.log(`Added ${records.items.length} records to meeting ${existing.id}.`);
      console.log(`See them with: pnpm records ${existing.id}`);
    } else {
      const { vectors, tokens } = await embedder.embed(
        chunks.map((c) => c.text),
        "document",
      );
      const { id, created } = await store.save({
        title: values.title ?? basename(path),
        source,
        turns,
        chunks,
        embeddings: { model: embedder.model, vectors },
        records,
      });
      if (created) {
        console.log(
          `Stored meeting ${id} with ${records.items.length} records. Embedded ${tokens} tokens.`,
        );
        console.log(`See them with: pnpm records ${id}`);
      } else {
        console.log(`Already ingested as meeting ${id} (saved by another run meanwhile).`);
      }
    }
  }
} finally {
  await sql.end();
}

function printExpectedCost(model: AnthropicModelId, embedTokens: number) {
  const promptChars = EXTRACTION_SYSTEM_PROMPT.length + buildExtractionPrompt(turns).length;
  const inputTokens = Math.ceil((promptChars / 4) * TOKEN_MARGIN);
  const extractUsd = estimateCostUsd(model, inputTokens, EXPECTED_EXTRACTION_OUTPUT_TOKENS);
  const embedUsd = (embedTokens * VOYAGE_PRICE_PER_MILLION_TOKENS["voyage-4-lite"]) / 1e6;
  const embedPart =
    embedTokens > 0
      ? ` + ~$${embedUsd.toFixed(6)} to embed ~${embedTokens} tokens ($0 inside Voyage's free tier)`
      : "";
  console.log(
    `${turns.length} turns -> ${chunks.length} chunks. Expected cost: ~$${extractUsd.toFixed(3)} ` +
      `to extract records with ${model} (~${inputTokens} tokens in, up to ` +
      `~${EXPECTED_EXTRACTION_OUTPUT_TOKENS} out)${embedPart}.`,
  );
}

function report({ records, rejected, model }: Extraction) {
  const count = (kind: string) => records.filter((r) => r.kind === kind).length;
  console.log(
    `Extracted ${count("decision")} decisions, ${count("action_item")} action items and ` +
      `${count("topic")} topics with ${model}. Rejected ${rejected.length}.`,
  );
  for (const r of rejected) console.log(`  rejected (${r.reason}): ${JSON.stringify(r.output)}`);
}
