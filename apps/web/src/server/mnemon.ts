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
import type { Session } from "./session.ts";

function create() {
  const sql = postgres(databaseUrl(), { onnotice: () => {}, max: 5 });
  // The schema is not the web server's: migrations run as their own step before it
  // starts (`pnpm db:migrate`, or the migrate container in docker-compose.yml).
  const ledger = createSpendLedger(sql);

  /**
   * The paid clients for one request, charged to its session's access code. Every paid
   * call is logged, then recorded against today's limits; `recorded()` waits for those
   * writes, so a serverless function isn't frozen with one still in flight. A failed
   * write is logged, never thrown: the call it records has already been paid for.
   */
  function paid(session: Session) {
    const code = session.accessCode;
    const pending: Promise<void>[] = [];
    const spent = (spend: Omit<Spend, "day" | "accessCode">, log: object) => {
      console.error(JSON.stringify({ event: "model_call", accessCode: code?.name, ...log }));
      pending.push(
        ledger
          .record({ day: today(), accessCode: code?.name ?? null, ...spend })
          .catch((error: unknown) => {
            console.error(JSON.stringify({ event: "spend_not_recorded", error: String(error) }));
          }),
      );
    };
    let embedder: Embedder | undefined;
    return {
      /** Whether a call estimated at `estimateUsd` fits in what is left of today's limits. */
      budget: (estimateUsd: number): Promise<BudgetCheck> =>
        checkBudget(ledger, {
          day: today(),
          limitUsd: dailyLimitUsd(process.env),
          estimateUsd,
          ...(code ? { accessCode: { name: code.name, limitUsd: code.dailyLimitUsd } } : {}),
        }),
      // Created on first use: a request that never pays needs no keys.
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
                  u.costUsd ??
                  estimateCostUsd(CHOSEN_MODELS[use].model, inputTokens, u.outputTokens),
              },
              u,
            );
          },
        }),
      /** Resolves once every paid call so far has been written to the ledger. */
      recorded: async () => {
        await Promise.all(pending);
      },
    };
  }

  return { sql, store: createMeetingStore(sql), search: createChunkSearch(sql), paid };
}

type Mnemon = ReturnType<typeof create>;
export type PaidClients = ReturnType<Mnemon["paid"]>;
// Kept on globalThis so development reloads reuse one connection pool.
const holder = globalThis as typeof globalThis & { __mnemon?: Mnemon };

export async function mnemon(): Promise<Mnemon> {
  holder.__mnemon ??= create();
  return holder.__mnemon;
}
