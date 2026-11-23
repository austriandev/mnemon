// pnpm seed [--yes]
// Loads the synthetic demo meetings (packages/core/fixtures/demo-meetings.json) so the
// app has something to answer from. Prints what each will cost and spends nothing
// without --yes. Meetings already stored are skipped, so it is safe to run again.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CHOSEN_MODELS } from "@mnemon/anthropic";
import { type IngestPlan, planIngest, runIngest } from "@mnemon/core";
import { describeResult, expectedCost } from "./ingest-report.ts";
import { connect, paidOnUse } from "./wiring.ts";

const FIXTURES = new URL("../../../packages/core/fixtures/", import.meta.url);

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
const demo = JSON.parse(readFileSync(new URL("demo-meetings.json", FIXTURES), "utf8")) as {
  file: string;
  title: string;
  heldOn: string;
}[];

const app = await connect();
const { sql, store } = app;
try {
  const modelId = CHOSEN_MODELS.extraction.model;
  const plans: { title: string; plan: IngestPlan }[] = [];
  for (const { file, title, heldOn } of demo) {
    const source = readFileSync(new URL(file, FIXTURES), "utf8");
    plans.push({ title, plan: await planIngest(source, title, store, { heldOn }) });
  }

  console.log("Demo meetings:");
  let total = 0;
  for (const { title, plan } of plans) {
    const cost = expectedCost(plan, modelId);
    total += cost.usd;
    console.log(`  ${title}: ${cost.line}`);
  }
  // Dating a meeting already stored is free, so it happens even without --yes.
  for (const { title, plan } of plans) {
    if (plan.kind === "unchanged" && plan.dateToAdd) {
      await runIngest(plan, paidOnUse(app));
      console.log(`  ${title}: dated ${plan.dateToAdd}`);
    }
  }
  const todo = plans.filter(({ plan }) => plan.kind === "new" || plan.kind === "extract-only");
  if (plans.some(({ plan }) => plan.kind === "invalid")) {
    throw new Error("A demo transcript does not parse; run pnpm test to see which.");
  }

  if (todo.length === 0) {
    console.log("All demo meetings are stored. Nothing to do.");
  } else if (!values.yes) {
    console.log(`Expected cost: up to ~$${total.toFixed(3)}. Run again with --yes to load them.`);
  } else {
    console.log(`Expected cost: up to ~$${total.toFixed(3)}. Loading ${todo.length}…`);
    // One at a time: Voyage's free tier allows 3 requests a minute.
    for (const { title, plan } of todo) {
      console.log(`\n${title}`);
      const result = await runIngest(plan, paidOnUse(app));
      for (const line of describeResult(result)) console.log(`  ${line}`);
    }
  }
} finally {
  await sql.end();
}
