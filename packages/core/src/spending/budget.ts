/** One paid call, as the ledger keeps it. */
export interface Spend {
  /** The calendar day the call counts against, YYYY-MM-DD. */
  readonly day: string;
  readonly provider: "anthropic" | "voyage" | "assemblyai";
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  /** The access code the call was made under, by name; absent when there is none. */
  readonly accessCode?: string | null;
}

/** Where paid calls are recorded, and how much a day has cost so far. */
export interface SpendLedger {
  record(spend: Spend): Promise<void>;
  /** The day's spend: all of it, or only what was made under one access code. */
  spentOn(day: string, accessCode?: string): Promise<number>;
}

export interface BudgetCheck {
  /** False: the call would pass a limit, so it must not be made. */
  readonly ok: boolean;
  /** Which limit this is: the access code's own, or the day's, which all codes share. */
  readonly scope: "access-code" | "day";
  readonly spentUsd: number;
  readonly limitUsd: number;
}

export interface BudgetOptions {
  readonly day: string;
  /** The day's limit across every access code. */
  readonly limitUsd: number;
  readonly estimateUsd: number;
  /** The code the call is made under, and its own daily limit, if it has one. */
  readonly accessCode?: { readonly name: string; readonly limitUsd: number | null };
}

/**
 * Whether a call estimated at `estimateUsd` fits in what is left of `day`'s limits: the
 * access code's own, then the day's. Checked before the call; what the call really cost
 * is recorded after it. Two calls checked at the same moment can both pass, so a limit
 * can be exceeded by at most the calls in flight.
 */
export async function checkBudget(
  ledger: SpendLedger,
  { day, limitUsd, estimateUsd, accessCode }: BudgetOptions,
): Promise<BudgetCheck> {
  if (accessCode && accessCode.limitUsd !== null) {
    const spentUsd = await ledger.spentOn(day, accessCode.name);
    if (spentUsd + estimateUsd > accessCode.limitUsd) {
      return { ok: false, scope: "access-code", spentUsd, limitUsd: accessCode.limitUsd };
    }
  }
  const spentUsd = await ledger.spentOn(day);
  return { ok: spentUsd + estimateUsd <= limitUsd, scope: "day", spentUsd, limitUsd };
}
