import type { Spend, SpendLedger } from "@mnemon/core";
import type { Sql } from "postgres";

/** The spend ledger in Postgres: one row per paid call, summed by day. */
export function createSpendLedger(sql: Sql): SpendLedger {
  return {
    async record(spend: Spend) {
      await sql`
        insert into spend (day, provider, model, input_tokens, output_tokens, cost_usd)
        values (${spend.day}, ${spend.provider}, ${spend.model}, ${spend.inputTokens},
                ${spend.outputTokens}, ${spend.costUsd})`;
    },
    async spentOn(day: string) {
      // numeric comes back as text; summed in the database, converted once here.
      const [row] = await sql<{ usd: string }[]>`
        select coalesce(sum(cost_usd), 0)::text as usd from spend where day = ${day}`;
      return Number(row?.usd ?? 0);
    },
  };
}
