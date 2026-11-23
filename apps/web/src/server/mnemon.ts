// Composition root for the web app: the same core and adapters as the CLI, created once
// per server process. Next.js is a thin shell; everything here is wiring, not behaviour.
import {
  CHOSEN_MODELS,
  createAnthropicModel,
  estimateCostUsd,
  type ModelUse,
} from "@mnemon/anthropic";
import { type BudgetCheck, checkBudget, type Embedder, type Spend } from "@mnemon/core";
import { createChunkSearch, createMeetingStore, createSpendLedger, databaseUrl } from "@mnemon/db";
import { createVoyageEmbedder } from "@mnemon/voyage";
import postgres from "postgres";
import { dailyLimitUsd, today } from "./budget.ts";

function create() {
  const sql = postgres(databaseUrl(), { onnotice: () => {}, max: 5 });
  // The schema is not the web server's: migrations run as their own step before it
  // starts (`pnpm db:migrate`, or the migrate service in deployment).
  const ledger = createSpendLedger(sql);
  // Every paid call is logged, then recorded against today's limit. A failed write is
  // logged, never thrown: the call it records has already been made and paid for.
  const spent = (spend: Omit<Spend, "day">, log: object) => {
    console.error(JSON.stringify({ event: "model_call", ...log }));
    ledger.record({ day: today(), ...spend }).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "spend_not_recorded", error: String(error) }));
    });
  };
  let embedder: Embedder | undefined;
  return {
    sql,
    store: createMeetingStore(sql),
    search: createChunkSearch(sql),
    /** Whether a call estimated at `estimateUsd` fits in what is left of today's limit. */
    budget: (estimateUsd: number): Promise<BudgetCheck> =>
      checkBudget(ledger, { day: today(), limitUsd: dailyLimitUsd(process.env), estimateUsd }),
    // API clients are created on first use: listing and reading meetings needs no keys.
    get embedder(): Embedder {
      embedder ??= createVoyageEmbedder({
        apiKey: process.env.MNEMON_VOYAGE_API_KEY ?? "",
        onUsage: (u) =>
          spent(
            {
              provider: "voyage",
              model: u.model,
              inputTokens: u.tokens,
              outputTokens: 0,
              costUsd: u.costUsd,
            },
            u,
          ),
      });
      return embedder;
    },
    languageModel: (use: ModelUse) =>
      createAnthropicModel({
        apiKey: process.env.MNEMON_ANTHROPIC_API_KEY ?? "",
        ...CHOSEN_MODELS[use],
        onUsage: (u) => {
          const inputTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
          spent(
            {
              provider: "anthropic",
              model: u.servedBy,
              inputTokens,
              outputTokens: u.outputTokens,
              // A fallback model missing from the price table is charged as the model
              // asked for, so the limit never counts a paid call as free.
              costUsd:
                u.costUsd ?? estimateCostUsd(CHOSEN_MODELS[use].model, inputTokens, u.outputTokens),
            },
            u,
          );
        },
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
