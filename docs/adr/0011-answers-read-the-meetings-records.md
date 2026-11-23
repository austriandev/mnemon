---
status: accepted
---

# Answers read the meetings' records, not just the retrieved turns

## Context

An answer was built from the turns of the 8 retrieved chunks. A question that asks for
every item of a kind ("list every action item from the CRM meeting") can't be answered
that way once a meeting is longer than what retrieval returns. On a 157-turn meeting the
answer missed 10 actions, though ingest had already extracted 18 of them, each cited,
from the whole transcript.

## Decision

`ask()` gives the model, for each meeting retrieval found:

- the meeting's extracted records (decisions, action items, topics), one line each, with
  owner, deadline and the turns it rests on; and
- those cited turns, added to the retrieved ones.

The system prompt says to use the records to answer completely when the question asks
for every item of a kind, and that records are a summary, not evidence: the model cites
turns, never a record. The citation check is unchanged, so every quoted sentence still
traces to a turn the model was shown. `records: false` turns it off; the eval uses that
for the comparison below.

## Eval

Sonnet 5.5 at medium, three new questions asking for every action item of one meeting,
scored against the gold action items. A retrieval limit of 3 stands in for a meeting
longer than what retrieval shows. The eval database's records come from the production
extraction model, extracted once (`$0.104` for three meetings).

| Retrieval limit | Records | List questions correct | Oct actions found | Cost / question | Run |
| --- | --- | --- | --- | --- | --- |
| 3 | off | 1/3 | 1/5 | $0.0084 | `2026-11-23-00-52` |
| 3 | on | **3/3** | 5/5 | $0.0140 | `2026-11-23-00-55-06` |
| 8 (default) | off | 2/3 | 3/5 | $0.0141 | `2026-11-23-00-53` |

All 25 questions at the default limit with records on: **25/25** (22/22 answerable,
3/3 not found, 21/21 citing the evidence turns, 0 rejected, 0 sentences naming a meeting
by number), $0.0189 per question against $0.0125 without records (run
`2026-11-23-00-54`). Runs `00-52` and `00-53` were rescored with the corrected label
below (`pnpm eval --rescore`).

One label was wrong. The October list question required the word "contract"; a complete
answer said "agreements", which turn 11 also uses. It now accepts either. Spent on this
decision: $0.71.

On the CRM meeting in the dev database, the register question now lists 20 actions
(the 18 extracted ones and two only retrieval found), one call, $0.035.

## Consequences

- Answers cost about 50% more per question, from the records and their cited turns in
  the prompt. A meeting with many records adds more.
- An answer is now only as complete as extraction plus retrieval. On the CRM meeting, two
  actions found by an earlier, retrieval-only answer (an escalation flag, a playbook
  entry) were in neither the records nor this run's retrieved chunks. Extraction recall
  is the next thing to measure on long meetings.
- Every retrieved meeting brings all its records, even for a narrow question. With
  many meetings in scope, records should be filtered to the question, or capped.

## Considered options

- **Route list questions to the records alone.** Cheaper, but a router is another model
  call or a brittle keyword rule, and records-only answers lose what extraction missed.
- **Retrieve more chunks.** Grows with meeting length and still can't promise every item.
- **Show the whole transcript.** Exact for one meeting, but doesn't scale across meetings,
  and a 157-turn meeting is already ~20k tokens.
