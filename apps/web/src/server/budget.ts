// The web app's daily spending limit: anyone past sign-in can start paid calls, so a day
// has a ceiling. The check itself is the core's checkBudget; this is its configuration.
import type { BudgetCheck } from "@mnemon/core";

const DEFAULT_DAILY_LIMIT_USD = 5;

/**
 * An upper estimate for one answer, checked before asking. Measured (ADR-0013): $0.0277
 * a question on average, $0.044 for the longest, listing a 165-turn meeting's actions.
 */
export const ASK_ESTIMATE_USD = 0.1;

/** MNEMON_DAILY_LIMIT_USD, in dollars; $5 when unset. 0 turns paid calls off. */
export function dailyLimitUsd(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.MNEMON_DAILY_LIMIT_USD?.trim();
  if (!raw) return DEFAULT_DAILY_LIMIT_USD;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`MNEMON_DAILY_LIMIT_USD must be a number of dollars, 0 or more; got "${raw}".`);
  }
  return usd;
}

/** The day spend counts against: the server's calendar day (local app, ADR-0009). */
export function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function overLimitMessage(check: BudgetCheck): string {
  return (
    `Today's spending limit is reached: $${check.spentUsd.toFixed(2)} of ` +
    `$${check.limitUsd.toFixed(2)} used. It resets at midnight; MNEMON_DAILY_LIMIT_USD sets it.`
  );
}
