// pnpm ingest <transcript.txt> [--title "Title"]
// Parse, chunk, embed and store one transcript. Prints the expected cost first.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { approximateTokenCounter, chunkTurns, parseTranscript } from "@mnemon/core";
import { VOYAGE_PRICE_PER_MILLION_TOKENS } from "@mnemon/voyage";
import { connect } from "./wiring.ts";

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

const chunks = chunkTurns(parsed.turns);
const estimatedTokens = chunks.reduce((sum, c) => sum + approximateTokenCounter.count(c.text), 0);
const price = VOYAGE_PRICE_PER_MILLION_TOKENS["voyage-4-lite"];
console.log(
  `${parsed.turns.length} turns -> ${chunks.length} chunks, ~${estimatedTokens} tokens to embed. ` +
    `Expected cost: ~$${((estimatedTokens * price) / 1e6).toFixed(6)} at list price ` +
    "($0 inside the free tier).",
);

const { sql, store, embedder } = await connect();
try {
  // A transcript is stored once; check before paying to embed it again.
  const existing = await store.findBySource(source);
  if (existing) {
    console.log(
      `Already ingested as meeting ${existing.id} ("${existing.title}"). Nothing embedded.`,
    );
  } else {
    const { vectors, tokens } = await embedder.embed(
      chunks.map((c) => c.text),
      "document",
    );
    const { id, created } = await store.save({
      title: values.title ?? basename(path),
      source,
      turns: parsed.turns,
      chunks,
      embeddings: { model: embedder.model, vectors },
    });
    console.log(
      created
        ? `Stored meeting ${id}. Embedded ${tokens} tokens with ${embedder.model}.`
        : `Already ingested as meeting ${id} (saved by another run meanwhile).`,
    );
  }
} finally {
  await sql.end();
}
