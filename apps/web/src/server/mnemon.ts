// Composition root for the web app: the same core and adapters as the CLI, created once
// per server process. Next.js is a thin shell; everything here is wiring, not behaviour.
import { CHOSEN_MODELS, createAnthropicModel, type ModelUse } from "@mnemon/anthropic";
import type { Embedder } from "@mnemon/core";
import { createChunkSearch, createMeetingStore, databaseUrl } from "@mnemon/db";
import { createVoyageEmbedder } from "@mnemon/voyage";
import postgres from "postgres";

function create() {
  const sql = postgres(databaseUrl(), { onnotice: () => {}, max: 5 });
  // The schema is not the web server's: migrations run as their own step before it
  // starts (`pnpm db:migrate`, or the migrate service in deployment).
  let embedder: Embedder | undefined;
  return {
    sql,
    store: createMeetingStore(sql),
    search: createChunkSearch(sql),
    // API clients are created on first use: listing and reading meetings needs no keys.
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

type Mnemon = ReturnType<typeof create>;
// Kept on globalThis so development reloads reuse one connection pool.
const holder = globalThis as typeof globalThis & { __mnemon?: Mnemon };

export async function mnemon(): Promise<Mnemon> {
  holder.__mnemon ??= create();
  return holder.__mnemon;
}
