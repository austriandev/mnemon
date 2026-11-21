---
status: accepted (defaults provisional)
---

# Turn-based chunking

A chunk is a run of whole, consecutive turns. A turn is never split, and
consecutive chunks overlap by a configurable number of turns. Each chunk keeps its
turn index range, the start time of its first and last turns, its distinct speakers,
and its text rendered one turn per line as `[HH:MM:SS] Speaker: text`. Every
retrieved passage therefore already carries who spoke and when, which is what a
citation needs.

`chunkTurns(turns, { maxTokens, overlapTurns, tokenCounter })` packs turns
greedily under `maxTokens`. The rules at the edges:

- **Oversize turns.** A single turn longer than `maxTokens` becomes its own chunk,
  flagged `oversize`, and is not split.
- **Overlap.** Each chunk after the first repeats the previous chunk's last
  `overlapTurns` turns. It carries fewer when the previous chunk is not longer than
  that, or when carrying them all would push the next new turn over budget. The
  budget wins over the overlap, so every chunk except an oversize one fits it.
  Every chunk adds at least one new turn.
- **Token counting** sits behind a `TokenCounter` interface. The default,
  `approximateTokenCounter`, is `ceil(characters / 4)`. The real tokenizer replaces
  it once the embedding model is chosen.

## Provisional defaults

`maxTokens: 300`, `overlapTurns: 1`. **These are provisional.** They are a
reasoned starting point, not a measured one: big enough to hold a short exchange,
such as a proposal, its objection and the decision, and small enough that a
retrieved chunk is mostly about one thing. On the 47-turn fixture they give
5 chunks of 240–298 approximate tokens. A retrieval eval in a later slice settles
both values, and its numbers are recorded here.

| Setting | Recall@k | MRR | Notes |
| --- | --- | --- | --- |
| _pending retrieval eval_ | | | |

## Considered options

- **Fixed-size token windows.** These cut turns in half, so a passage can lose its
  speaker or timestamp, and a citation can point at half a sentence.
- **One chunk per turn.** Short turns ("Agreed.", "I'll take it.") carry no
  context on their own. They are exactly the turns that state decisions and owners,
  and they would retrieve poorly.
- **Topic segmentation.** Splitting at topic boundaries would make better chunk
  edges, but it needs a model call per meeting at ingest. Worth revisiting once
  evals exist to show it pays for itself.
