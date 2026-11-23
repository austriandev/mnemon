import { describe, expect, it } from "vitest";
import { checkBudget, type Spend, type SpendLedger } from "../src/index.ts";

function ledger(spent: Record<string, number>): SpendLedger & { recorded: Spend[] } {
  const recorded: Spend[] = [];
  return {
    recorded,
    record: async (spend) => {
      recorded.push(spend);
    },
    spentOn: async (day) => spent[day] ?? 0,
  };
}

describe("checkBudget", () => {
  it("allows a call whose estimate fits in what is left of today's limit", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 4.5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 0.5,
    });

    expect(check).toEqual({ ok: true, spentUsd: 4.5, limitUsd: 5 });
  });

  it("refuses a call that would take today's spend past the limit", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 4.5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 0.51,
    });

    expect(check).toEqual({ ok: false, spentUsd: 4.5, limitUsd: 5 });
  });

  it("counts only the given day's spend", async () => {
    const check = await checkBudget(ledger({ "2026-11-22": 5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 1,
    });

    expect(check.ok).toBe(true);
  });
});
