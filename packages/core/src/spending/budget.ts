/** One paid call, as the ledger keeps it. */
export interface Spend {
  /** The calendar day the call counts against, YYYY-MM-DD. */
  readonly day: string;
  readonly provider: "anthropic" | "voyage";
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

/** Where paid calls are recorded, and how much a day has cost so far. */
export interface SpendLedger {
  record(spend: Spend): Promise<void>;
  spentOn(day: string): Promise<number>;
}

export interface BudgetCheck {
  /** False: the call would take the day past its limit, so it must not be made. */
  readonly ok: boolean;
  readonly spentUsd: number;
  readonly limitUsd: number;
}

/**
 * Whether a call estimated at `estimateUsd` fits in what is left of `day`'s limit.
 * Checked before the call; what the call really cost is recorded after it. Two calls
 * checked at the same moment can both pass, so the limit can be exceeded by at most
 * the calls in flight.
 */
export async function checkBudget(
  ledger: SpendLedger,
  { day, limitUsd, estimateUsd }: { day: string; limitUsd: number; estimateUsd: number },
): Promise<BudgetCheck> {
  const spentUsd = await ledger.spentOn(day);
  return { ok: spentUsd + estimateUsd <= limitUsd, spentUsd, limitUsd };
}
