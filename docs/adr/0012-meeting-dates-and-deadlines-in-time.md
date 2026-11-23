---
status: accepted
---

# Meeting dates: answers place deadlines in time

## Context

People ask "what is overdue?" and "is this due yet?". A transcript gives offsets from
the start of the recording, not dates, and the answer prompt said "never convert a
deadline to a date". So "by the end of the month" could never become 30 November, and
the model didn't know today's date.

## Decision

- **A meeting may have the day it was held** (`meetings.held_on`, migration 0005),
  given on ingest: `pnpm ingest --date`, the "Held on" field when adding a meeting, and
  `demo-meetings.json` for the seed. A meeting stored without a date can be dated once,
  for free (`setHeldOn`, from the same planIngest/runIngest path). A date is never
  changed once set.
- **The answer prompt shows each meeting's date** (`<meeting … held="2026-11-14">`) and
  today's date. The CLI and the web app pass the local calendar day; the eval fixes it at
  2026-11-23.
- **New rules:** deadlines stay as said. Only when the question asks what is due, overdue
  or done does the model place a deadline in time, in the sentence citing it, and show
  how ("by the twenty-fourth", said on 2026-10-15, is 24 October 2026). An action is done
  only when a turn says so. What the meetings don't confirm, such as completion, goes in
  gaps, never in an uncited sentence.
- The demo meetings are dated to fit what they say: October on 2026-10-15 (it sets the
  next meeting for the fourteenth of November), November on 2026-11-14, the CMC group
  on 2026-11-19 (it plans for "mid-January").

## Eval

Sonnet 5.5 at medium. Three new questions, scored on facts worked out from the meeting's
date (`derived` facts, such as "30 November" for "by the end of the month"):

| Dates shown | Dated questions correct | All questions | Run |
| --- | --- | --- | --- |
| no (dates hidden) | 1/3 | | `2026-11-23-01-09-51` |
| yes | 3/3 | **28/28** (25/25 answerable, 3/3 not found, 24/24 cite evidence, 0 rejected) | `2026-11-23-01-12-06` |

$0.0196 per question. No sentence names a meeting by number.

The first wording of the rules failed. It said 'otherwise say "deadline passed,
completion not confirmed"', and the model wrote that as an uncited sentence. The citation
check rejected 3 answers, one of them (`stability-owner`) a question that passed before
(run `2026-11-23-01-09-03`, 25/28). Moving "not confirmed" into gaps, and dating
deadlines only when asked, fixed all three (`2026-11-23-01-09-34`, 4/4). The check worked
as designed: it rejected the answers rather than showing uncited claims. With dates
hidden, the first wording also scored 1/3 (`2026-11-23-01-08-34`).

Spent on this decision: $1.31.

## Consequences

- "Today" is the server's calendar day. Fine for a local app; a hosted one would take the
  user's time zone.
- Relative deadlines ("by Friday") are resolved by the model, and the model shows its
  working in the answer. An exact calendar would need a date parser for spoken English,
  which isn't worth it for a demo. The eval covers one such case (the October follow-ups).
- A meeting with no date still answers, and says the deadline can't be placed.

## Considered options

- **Resolve deadlines to dates at extraction time.** Stores a guess as if it were fact,
  and a wrong date is then repeated in every answer. Keeping the words as said and
  placing them per question keeps the transcript the source of truth.
- **Infer the meeting date from the transcript.** Unreliable ("the fourteenth of
  November" is the next meeting, not this one), and silent when wrong.
