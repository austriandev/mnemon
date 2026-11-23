// pnpm ingest <transcript.txt> [--title "Title"]
// Parse, chunk, extract records with Claude, embed with Voyage, and store one
// transcript. Prints the expected cost before any paid call.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { CHOSEN_MODELS } from "@mnemon/anthropic";
import { planIngest, runIngest } from "@mnemon/core";
import { describeResult, expectedCost } from "./ingest-report.ts";
import { connect, paidOnUse } from "./wiring.ts";

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
// `||`, not `??`: an empty --title falls back too, rather than failing the plan.
const title = values.title?.trim() || basename(path);
const app = await connect();
const { sql, store } = app;
try {
  const plan = await planIngest(source, title, store);
  if (plan.kind === "invalid") {
    console.error(`${path} was not ingested: ${plan.errors.length} problem(s).`);
    for (const error of plan.errors) console.error(`  ${error.code}: ${error.message}`);
    process.exitCode = 1;
  } else {
    if (plan.kind !== "unchanged") {
      console.log(`Expected cost: ${expectedCost(plan, CHOSEN_MODELS.extraction.model).line}.`);
    }
    const result = await runIngest(plan, paidOnUse(app));
    for (const line of describeResult(result)) console.log(line);
  }
} finally {
  await sql.end();
}
