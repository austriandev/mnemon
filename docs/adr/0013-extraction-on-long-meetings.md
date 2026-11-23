---
status: accepted
---

# Extraction on long meetings: one pass, streamed, with room to grow

## Context

The labelled meetings were short (30 to 47 turns). A real operations review runs an
hour or more, and a test with a longer pasted transcript raised the question of whether
extraction misses action items as meetings grow. The extraction call is one request over
the whole transcript, with a 16,000-token output ceiling. Nothing had measured either.

## Decision

- **A long labelled meeting in the eval.** `kr44-clinical-operations.txt`: 165 turns,
  8 speakers, 7 decisions and 21 action items labelled by hand. They include traps: an
  action given in passing at the end ("I'll update the contact list today"), one handed
  to a new owner (the Portugal resubmission moves from Lea to Rosa), one withdrawn (the
  CRO quote), and a hypothetical that is not an action. 10 smaller commitments and 5
  arguable decisions are labelled optional. Three questions ask about it, one of them for every action item.
- **A length probe.** `--meetings joined` extracts from all four meetings joined into
  one 275-turn transcript, with every gold label shifted to its new turn number
  (`stitch`, tested).
- **Keep one extraction pass**, with Sonnet 5.5 at medium (ADR-0008). Length up to 275
  turns cost no recall, so splitting meetings into windows isn't needed yet.
- **Stream the model call and raise the ceiling to 32,000 output tokens.** The SDK refuses
  a ceiling this high on a non-streamed request. Tokens are paid only when used.
- **Estimate extraction output from the meeting's length:** 6,000 tokens or 50 a turn,
  whichever is more, up to the ceiling. The same function (`extractionTokens`) prices
  the "Check cost" step in the app and the eval's plan. Before this, both assumed 6,000
  for any meeting.

## Eval

Extraction on the long meeting, five configurations (runs `2026-11-23-07-46-57`, and
`2026-11-23-07-51-08` for the joined meeting):

| Model | Effort | kr44 (165 turns): actions, decisions | Output tokens | Joined (275 turns): actions, decisions | Output tokens |
| --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | high | 21/21, 7/7 | 7,974 | | |
| claude-opus-5-5 | medium | 21/21, 7/7 | 4,722 | | |
| claude-sonnet-5-5 | high | 21/21, 7/7 | 8,177 | 31/31, 17/18 | **14,729** |
| **claude-sonnet-5-5** | **medium** | **21/21, 7/7** | **4,400** | **31/31, 17/18** | **5,997** |
| claude-haiku-5-5 | medium | 21/21, 7/7 | 7,169 | | |

Precision 100% and owners 21/21 for every configuration on kr44. The input was 9,444
tokens for kr44 and 15,091 for the joined meeting. Sonnet at medium cost $0.063 on kr44
and $0.090 on the joined meeting.

- **Recall held at this length.** The one decision missed on the joined meeting is
  "March batch on hold": at medium it was filed as a topic. At high, the model merged
  October's "dose held at 20 mg" with November's "hold lifted" into one record. The
  prompt asks for exactly that within one meeting ("record the final position"), so
  that miss comes from joining two meetings about the same programme.
- **The ceiling was the risk.** At high effort the joined meeting used 14,729 of the
  16,000 output tokens. A meeting a little longer would have stopped at `max_tokens`, and
  the call fails rather than return partial records, after the tokens are paid for.
  At medium, output grew from 4,400 to 5,997 tokens between 165 and 275 turns.
  *Hypothesis:* about 22 tokens a turn at medium, so the 32,000 ceiling covers about
  1,400 turns. It is extrapolated from two points, not measured.

Answers, with the long meeting in the corpus (run `2026-11-23-07-55-55`, Sonnet 5.5
at medium): **31/31** (28/28 answerable, 3/3 not found, 27/27 cite evidence, 0
rejected), $0.0277 per question (up from $0.0196: an answer that retrieves the long meeting
also reads its records). The "every action item" question for kr44 listed all 21, with owners and
deadlines. Retrieval on the 19 questions of ADR-0005, now with kr44's chunks in the
index as distractors: hybrid recall@8 98% (was 100%), MRR 0.78 (was 0.82); run
`2026-11-23-07-56-44`.

## Labels corrected after the runs

Each was a mistake in the labels, not in the output, and each is recorded here because
it was changed after seeing the results:

- **"Queries over 30 days closed by month end"** was labelled at turn 46 alone (the
  target). Four of five models cited turn 48 ("I'll send each CRA a list"), how Kenji
  will meet it. It is one commitment over two turns, labelled like the November
  meeting's: now turns 46 and 48.
- **The scorer** matched a record to the first gold record sharing any of its turns. A
  record citing turns 123 and 124 (Lea sends Rosa her draft) took Rosa's resubmission
  and counted Rosa's own record as a duplicate. It now prefers the gold record whose
  owner the record names, then the one sharing the most cited turns. Both cases are
  tested. Rescoring the ADR-0008 runs gives the same numbers.
- **"Reconciliation"** as a fact missed "will finish reconciling". The fact is now the
  stem "reconcil"; the answer was 20/21 before rescoring, 21/21 after.

Spent on this decision: $1.68 ($0.50 on kr44 extraction, $0.27 on the joined meeting,
$0.92 on answers and retrieval).

## Consequences

- A meeting far longer than 275 turns is still unmeasured. If one fails, it fails
  loudly with "Output stopped at max_tokens", and the meeting is not saved half done.
- The cost shown before adding a meeting is now higher for long meetings: it prices the
  output a long meeting can take, not a short meeting's.
- `--meetings joined` stays out of default runs, so their numbers compare with the
  earlier ADRs.

## Considered options

- **Extract in windows of about 150 turns and merge.** Bounded output for any meeting
  length, but a merge step that needs its own rules (one action restated in two
  windows, a change of mind across a window boundary). It isn't needed at measured
  lengths; it is the next step if a longer meeting fails.
- **Refuse meetings above a turn limit.** Simple and honest, but the limit would come
  from an extrapolation, and it blocks real meetings that would probably succeed.
