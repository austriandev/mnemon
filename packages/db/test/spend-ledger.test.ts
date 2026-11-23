import type { Spend } from "@mnemon/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpendLedger } from "../src/index.ts";
import { migrate } from "../src/migrate.ts";
import { createTestDatabase } from "./test-database.ts";

let sql: Sql;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ sql, drop } = await createTestDatabase());
  await migrate(sql);
});
afterAll(async () => drop());

const call = (day: string, costUsd: number): Spend => ({
  day,
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  inputTokens: 9_444,
  outputTokens: 4_400,
  costUsd,
});

describe("spend ledger", () => {
  it("sums the recorded cost of one day, to the micro-dollar", async () => {
    const ledger = createSpendLedger(sql);
    await ledger.record(call("2026-11-23", 0.062888));
    await ledger.record(call("2026-11-23", 0.0000083));
    await ledger.record(call("2026-11-22", 3));

    expect(await ledger.spentOn("2026-11-23")).toBeCloseTo(0.0628963, 7);
    expect(await ledger.spentOn("2026-11-22")).toBe(3);
    expect(await ledger.spentOn("2026-11-21")).toBe(0);
  });

  it("keeps each call's tokens and model, so spend can be read back by model", async () => {
    const ledger = createSpendLedger(sql);
    await ledger.record({
      ...call("2026-11-20", 0.01),
      provider: "voyage",
      model: "voyage-4-lite",
    });

    const rows = await sql`
      select provider, model, input_tokens, output_tokens from spend where day = '2026-11-20'`;
    expect(rows).toEqual([
      { provider: "voyage", model: "voyage-4-lite", input_tokens: 9_444, output_tokens: 4_400 },
    ]);
  });
});
