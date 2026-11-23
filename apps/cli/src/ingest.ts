// pnpm ingest <transcript.txt> [--title "Title"]
// Parse, chunk, extract records with Claude, embed with Voyage, and store one
// transcript. Prints the expected cost before any paid call.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import type { AnthropicModelId } from "@mnemon/anthropic";
import { planIngest, runIngest } from "@mnemon/core";
import { describeResult, expectedCost } from "./ingest-report.ts";
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
const { sql, store, embedder, languageModel } = await connect();
try {
  const plan = await planIngest(source, values.title ?? basename(path), store);
  if (plan.kind === "invalid") {
    console.error(`${path} was not ingested: ${plan.errors.length} problem(s).`);
    for (const error of plan.errors) console.error(`  ${error.code}: ${error.message}`);
    process.exitCode = 1;
  } else {
    const model = languageModel("extraction");
    if (plan.kind !== "unchanged") {
      console.log(`Expected cost: ${expectedCost(plan, model.model as AnthropicModelId).line}.`);
    }
    const result = await runIngest(plan, { repository: store, embedder, model });
    for (const line of describeResult(result)) console.log(line);
  }
} finally {
  await sql.end();
}
