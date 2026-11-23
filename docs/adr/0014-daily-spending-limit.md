---
status: accepted
---

# A daily spending limit for the web app

## Context

Anyone past sign-in can ask questions and add meetings, and both make paid calls:
Claude to answer or extract, and Voyage to embed. Each call logged its cost to stderr,
but nothing added the calls up or stopped them. A shared access code, a script on a
loop, or one large transcript pasted many times could spend the whole API budget.

## Decision

- **Record every paid call the web app makes** in a `spend` table (migration 0006):
  the day, provider, model, tokens and cost. It is written after the call, from the
  same usage callback that logs it. A failed write is logged, not thrown: the call has
  already been made.
- **Check before paying.** `checkBudget` (core) adds the call's upper estimate to
  what today has spent, and refuses if that passes the limit. Asking uses $0.10 an
  answer: the measured average is $0.028, and the longest so far $0.044 (ADR-0013).
  Adding a meeting uses the cost the "Check cost" step showed.
- **The limit is `MNEMON_DAILY_LIMIT_USD`**, $5 by default. That's about 180 answers at
  the measured average, and a twentieth of the project's API budget. `0` turns paid calls
  off, and a value that isn't a number refuses paid calls rather than run without a limit.
- **A refusal says what happened:** "Today's spending limit is reached: $4.98 of $5.00
  used. It resets at midnight; MNEMON_DAILY_LIMIT_USD sets it." Nothing is called.
- "Today" is the server's calendar day, as for dates in answers (ADR-0012).

Checked by a live run on the dev database: one question recorded two rows (Voyage
$0.0000002, Claude $0.0225), and with the limit at 0 the next question was refused
before any call.

## Consequences

- Two requests checked at the same moment can both pass, so the limit can be exceeded
  by the calls in flight: a few cents for answers, one meeting's extraction for adds.
- The limit covers the web app. CLI commands are run by an operator who is shown the
  cost first, and they don't write to the ledger.
- The ledger gives a per-model record of spend that can be read back with SQL, not
  just log lines.

## Considered options

- **Reserve the estimate before the call, and settle it after.** Closes the
  in-flight gap; needs a transaction per call and cleanup for calls that crash. Worth
  it once there are many users at once.
- **A per-user limit.** There is one shared access code, so there are no users to
  limit separately (ADR-0009).
- **Rely on the provider's spend limits.** They protect the account, not the app: hitting
  one stops every use of the key, including the demo, without a message the app shows.
