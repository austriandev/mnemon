// Composition root shared by the CLI commands: real adapters, configured from env.
import { CHOSEN_MODELS, createAnthropicModel, type ModelUse } from "@mnemon/anthropic";
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
  return {
    sql,
    store: createMeetingStore(sql),
    search: createChunkSearch(sql),
    embedder: createVoyageEmbedder({ apiKey: process.env.MNEMON_VOYAGE_API_KEY ?? "" }),
    // Created on first use, so commands that never call Claude don't need its key.
    languageModel: (use: ModelUse) =>
      createAnthropicModel({
        apiKey: process.env.MNEMON_ANTHROPIC_API_KEY ?? "",
        ...CHOSEN_MODELS[use],
      }),
  };
}
