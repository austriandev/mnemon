// What the CLI says around an ingest: the expected cost of a plan, before anything is
// paid for, and the outcome after. The flow itself is the core's planIngest/runIngest.
import { type AnthropicModelId, estimateCostUsd } from "@mnemon/anthropic";
import { type Extraction, type IngestPlan, type IngestResult, ingestTokens } from "@mnemon/core";
import { VOYAGE_PRICE_PER_MILLION_TOKENS } from "@mnemon/voyage";

export interface PlanCost {
  readonly usd: number;
  /** One line saying what will be paid for, or that nothing will. */
  readonly line: string;
}

export function expectedCost(plan: IngestPlan, model: AnthropicModelId): PlanCost {
  if (plan.kind === "invalid") return { usd: 0, line: "cannot be ingested" };
  if (plan.kind === "unchanged") {
    return { usd: 0, line: `already stored as "${plan.meeting.title}" with its records; $0` };
  }
  const tokens = ingestTokens(plan);
  const extractUsd = estimateCostUsd(model, tokens.extractionInput, tokens.extractionOutput);
  const extract =
    `~$${extractUsd.toFixed(3)} to extract records with ${model} ` +
    `(~${tokens.extractionInput} tokens in, up to ~${tokens.extractionOutput} out)`;
  if (plan.kind === "extract-only") {
    return { usd: extractUsd, line: `${plan.turns.length} turns, already embedded: ${extract}` };
  }
  const embedUsd = (tokens.embedding * VOYAGE_PRICE_PER_MILLION_TOKENS["voyage-4-lite"]) / 1e6;
  return {
    usd: extractUsd + embedUsd,
    line:
      `${plan.turns.length} turns -> ${plan.chunks.length} chunks: ${extract} + ` +
      `~$${embedUsd.toFixed(6)} to embed ~${tokens.embedding} tokens ($0 inside Voyage's free tier)`,
  };
}

export function describeResult(result: IngestResult): string[] {
  if (result.kind === "unchanged") {
    return [`Already ingested as meeting ${result.id} ("${result.title}"). Nothing to do.`];
  }
  const lines = describeExtraction(result.extraction);
  if (result.kind === "backfilled") {
    lines.push(`Added ${result.extraction.records.length} records to meeting ${result.id}.`);
  } else if (result.created) {
    lines.push(
      `Stored meeting ${result.id} with ${result.extraction.records.length} records. ` +
        `Embedded ${result.embeddingTokens} tokens.`,
    );
  } else {
    lines.push(`Already ingested as meeting ${result.id} (saved by another run meanwhile).`);
  }
  lines.push(`See them with: pnpm records ${result.id}`);
  return lines;
}

function describeExtraction({ records, rejected, model }: Extraction): string[] {
  const count = (kind: string) => records.filter((r) => r.kind === kind).length;
  return [
    `Extracted ${count("decision")} decisions, ${count("action_item")} action items and ` +
      `${count("topic")} topics with ${model}. Rejected ${rejected.length}.`,
    ...rejected.map((r) => `  rejected (${r.reason}): ${JSON.stringify(r.output)}`),
  ];
}
