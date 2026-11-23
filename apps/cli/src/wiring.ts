// Composition root shared by the CLI commands: real adapters, configured from env.
import { CHOSEN_MODELS, createAnthropicModel, type ModelUse } from "@mnemon/anthropic";
import type { Embedder, IngestDeps } from "@mnemon/core";
import { createChunkSearch, createMeetingStore, databaseUrl } from "@mnemon/db";
import { migrate } from "@mnemon/db/migrate";
import { createVoyageEmbedder } from "@mnemon/voyage";
import postgres from "postgres";

// CLI users get the error message, not a stack trace. MNEMON_DEBUG=1 shows the stack.
process.on("uncaughtException", (error: Error & { code?: string }) => {
  // A refused connection is an AggregateError with an empty message but a code.
  const summary = error.message || error.code || String(error);
  console.error(process.env.MNEMON_DEBUG ? error : `Error: ${summary}`);
  process.exit(1);
});

export async function connect() {
  const sql = postgres(databaseUrl(), { onnotice: () => {} });
  await migrate(sql);
  let embedder: Embedder | undefined;
  return {
    sql,
    store: createMeetingStore(sql),
    search: createChunkSearch(sql),
    // Both API clients are created on first use, so a command that never calls Voyage
    // or Claude doesn't need that key.
    get embedder(): Embedder {
      embedder ??= createVoyageEmbedder({ apiKey: process.env.MNEMON_VOYAGE_API_KEY ?? "" });
      return embedder;
    },
    languageModel: (use: ModelUse) =>
      createAnthropicModel({
        apiKey: process.env.MNEMON_ANTHROPIC_API_KEY ?? "",
        ...CHOSEN_MODELS[use],
      }),
  };
}

/**
 * Ingest dependencies whose API clients are created only when runIngest reaches a paid
 * step, so an unchanged meeting, or a dry run, needs no API keys.
 */
export function paidOnUse(app: Awaited<ReturnType<typeof connect>>): IngestDeps {
  return {
    repository: app.store,
    get embedder() {
      return app.embedder;
    },
    get model() {
      return app.languageModel("extraction");
    },
  };
}
