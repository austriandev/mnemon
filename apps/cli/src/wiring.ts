// Composition root shared by the CLI commands: real adapters, configured from env.
import { type AnthropicModelId, createAnthropicModel, type Effort } from "@mnemon/anthropic";
import { createChunkSearch, createMeetingStore, databaseUrl, migrate } from "@mnemon/db";
import { createVoyageEmbedder } from "@mnemon/voyage";
import postgres from "postgres";

// CLI users get the error message, not a stack trace. MNEMON_DEBUG=1 shows the stack.
process.on("uncaughtException", (error: Error & { code?: string }) => {
  // A refused connection is an AggregateError with an empty message but a code.
  const summary = error.message || error.code || String(error);
  console.error(process.env.MNEMON_DEBUG ? error : `Error: ${summary}`);
  process.exit(1);
});

// The model for each use, settled by the eval (ADR-0008): Sonnet 5.5 at medium matched
// Opus 5.5 at high on every score, at under half the cost.
const MODELS = {
  extraction: { model: "claude-sonnet-5-5", effort: "medium" },
  answering: { model: "claude-sonnet-5-5", effort: "medium" },
} as const satisfies Record<string, { model: AnthropicModelId; effort: Effort }>;

export async function connect() {
  const sql = postgres(databaseUrl(), { onnotice: () => {} });
  await migrate(sql);
  return {
    sql,
    store: createMeetingStore(sql),
    search: createChunkSearch(sql),
    embedder: createVoyageEmbedder({ apiKey: process.env.MNEMON_VOYAGE_API_KEY ?? "" }),
    // Created on first use, so commands that never call Claude don't need its key.
    languageModel: (use: keyof typeof MODELS) =>
      createAnthropicModel({ apiKey: process.env.MNEMON_ANTHROPIC_API_KEY ?? "", ...MODELS[use] }),
  };
}
