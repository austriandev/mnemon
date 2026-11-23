import { describe, expect, it } from "vitest";
import { checkBudget, type Spend, type SpendLedger } from "../src/index.ts";

/** Spend by day ("2026-11-23") and by day and access code ("2026-11-23/reviewer-a"). */
function ledger(spent: Record<string, number>): SpendLedger & { recorded: Spend[] } {
  const recorded: Spend[] = [];
  return {
    recorded,
    record: async (spend) => {
      recorded.push(spend);
    },
    spentOn: async (day, accessCode) => spent[accessCode ? `${day}/${accessCode}` : day] ?? 0,
  };
}

describe("checkBudget", () => {
  it("allows a call whose estimate fits in what is left of today's limit", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 4.5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 0.5,
    });

    expect(check).toEqual({ ok: true, scope: "day", spentUsd: 4.5, limitUsd: 5 });
  });

  it("refuses a call that would take today's spend past the limit", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 4.5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 0.51,
    });

    expect(check).toEqual({ ok: false, scope: "day", spentUsd: 4.5, limitUsd: 5 });
  });

  it("counts only the given day's spend", async () => {
    const check = await checkBudget(ledger({ "2026-11-22": 5 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 1,
    });

    expect(check.ok).toBe(true);
  });

  it("refuses a call that would take its access code past the code's own limit, with the day's to spare", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 3, "2026-11-23/reviewer-a": 1.95 }), {
      day: "2026-11-23",
      limitUsd: 10,
      estimateUsd: 0.1,
      accessCode: { name: "reviewer-a", limitUsd: 2 },
    });

    expect(check).toEqual({ ok: false, scope: "access-code", spentUsd: 1.95, limitUsd: 2 });
  });

  it("still holds a code within its own limit to the day's limit, which all codes share", async () => {
    const spent = { "2026-11-23": 9.95, "2026-11-23/reviewer-b": 0.2 };
    const check = await checkBudget(ledger(spent), {
      day: "2026-11-23",
      limitUsd: 10,
      estimateUsd: 0.1,
      accessCode: { name: "reviewer-b", limitUsd: 2 },
    });

    expect(check).toEqual({ ok: false, scope: "day", spentUsd: 9.95, limitUsd: 10 });
  });

  it("holds a code with no limit of its own to the day's limit only", async () => {
    const check = await checkBudget(ledger({ "2026-11-23": 1, "2026-11-23/shared": 1 }), {
      day: "2026-11-23",
      limitUsd: 5,
      estimateUsd: 0.1,
      accessCode: { name: "shared", limitUsd: null },
    });

    expect(check).toEqual({ ok: true, scope: "day", spentUsd: 1, limitUsd: 5 });
  });
});
