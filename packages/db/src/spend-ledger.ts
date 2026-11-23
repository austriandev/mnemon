import type { Spend, SpendLedger } from "@mnemon/core";
import type { Sql } from "postgres";

/** The spend ledger in Postgres: one row per paid call, summed by day or by access code. */
export function createSpendLedger(sql: Sql): SpendLedger {
  return {
    async record(spend: Spend) {
      await sql`
        insert into spend (day, provider, model, input_tokens, output_tokens, cost_usd, access_code)
        values (${spend.day}, ${spend.provider}, ${spend.model}, ${spend.inputTokens},
                ${spend.outputTokens}, ${spend.costUsd}, ${spend.accessCode ?? null})`;
    },
    async spentOn(day: string, accessCode?: string) {
      // numeric comes back as text; summed in the database, converted once here.
      const [row] = await sql<{ usd: string }[]>`
        select coalesce(sum(cost_usd), 0)::text as usd from spend
        where day = ${day} ${accessCode === undefined ? sql`` : sql`and access_code = ${accessCode}`}`;
      return Number(row?.usd ?? 0);
    },
  };
}
