---
status: accepted; model and effort superseded by ADR-0008
---

# Record extraction at ingest: Claude with structured outputs, checked citations in the core

When a meeting is ingested, Claude extracts its records: decisions, action items and
topics. Every record cites one or more turns, and every citation carries a short quote
copied from the turn it points at. Records are stored with the meeting, in the same
transaction, so questions like "who owns the vendor audit?" can be answered from
records rather than re-read from chunks each time.

## How it works

- **The core owns the prompt and the checks.** `extractRecords` (in `@mnemon/core`)
  builds the system prompt and the user prompt, defines the output's JSON Schema, and
  validates what comes back. The prompt is plain text in `extraction/extract.ts`, so a
  reviewer can read exactly what the model is told. Claude sits behind a
  `LanguageModel` port; `@mnemon/anthropic` is the adapter (official SDK, pinned).
- **Structured outputs** (`output_config.format` with a JSON Schema) guarantee the shape
  of the response. They do not guarantee that it is true.
- **Rejected, never repaired**, in the spirit of ADR-0002. A record is dropped, and
  reported in `rejected` with its reason, if it cites a turn that doesn't exist, if its
  quote is not found verbatim in the cited turn, if it is an action item without an
  owner, or if its kind or summary is invalid. A verbatim quote is a cheap, mechanical
  check that the model is pointing at words someone actually said.
- **The database enforces the citation**: `record_citations (meeting_id, turn_index)`
  is a foreign key to `turns`, so a stored record can't cite a turn the meeting doesn't
  have. A meeting's records are written once; a meeting stored before extraction
  existed gets its records on its next ingest.
- **The transcript is fenced as data.** It goes in `<transcript>` tags, and the system
  prompt says text inside it is part of the meeting, not an instruction. A transcript
  is user-supplied input.

## Model: provisionally `claude-opus-5-5` at `high`; settled as `claude-sonnet-5-5` at `medium`

The provisional choice was Claude Opus 5.5, the default model, at `high` effort because
extraction errors are what an auditor finds. On the fixture (47 turns) the estimate was
up to $0.13 and the first live run cost $0.065 at list price ($4 / $20 per million
tokens), most of it output and thinking. *Hypothesis:* Claude Sonnet 5.5 or Haiku 5.5,
or a lower effort, holds quality at a fraction of the cost.

The eval (ADR-0008, three meetings, 25 gold records) confirmed it for Sonnet 5.5:

| Model | Effort | Record precision | Record recall | Rejected | Cost / meeting |
| --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | high | 100% | 100% | 0 | $0.056 |
| claude-opus-5-5 | medium | 95% | 100% | 0 | $0.046 |
| claude-sonnet-5-5 | high | 100% | 100% | 0 | $0.028 |
| **claude-sonnet-5-5** | **medium** | **100%** | **100%** | **0** | **$0.021** |
| claude-haiku-5-5 | medium | 95% | 100% | 0 | $0.002 |

**First live run** (one run on the fixture, not an eval): 3,401 input and 2,567 output
tokens, $0.065, 15 records (5 decisions, 5 action items, 5 topics), 0 rejected. Every
summary checked by hand against the transcript. The prompt came to ~2.25 characters per
token, so `pnpm ingest` estimates extraction input at 2 characters per token, not 4.

**Server-side fallback is on** (`fallbacks: "default"`): if a safety classifier
declines, the API re-runs the request on a fallback model in the same call. The model
that actually answered is what gets stored (`meetings.records_model`) and logged
(`servedBy`), so a fallback is never invisible.

## Considered options

- **Extract at question time, from retrieved chunks.** No ingest cost, but every answer
  pays for extraction again, and "list every action item" would need every chunk.
  Extracting once at ingest makes records a queryable table.
- **Tool use instead of structured outputs.** Equivalent here; Opus 5.5 rejects forced
  tool choice, so structured outputs are the direct way to require one JSON result.
- **The API's built-in citations.** They cite character ranges in a document, but are
  incompatible with structured outputs. Turn-level citations with verbatim quotes fit
  the domain (who said it, when) and are checked by our own code.
- **Repair invalid records** (fuzzy-match quotes, guess owners). Rejected: a repaired
  citation is one nobody can trust, and the rejected list shows how often the model
  misses, which is what the eval needs.

## Consequences

- Ingest now needs `MNEMON_ANTHROPIC_API_KEY`, and costs money per meeting. The cost is
  printed before the call and logged after it.
- Transcript text is sent to Anthropic. As with Voyage (ADR-0005), that makes Anthropic
  a sub-processor for a real deployment.
- A strict verbatim check can reject a good record over a typographic difference
  (curly vs straight apostrophe). The rejected list makes that visible; whether to
  normalise is a question for the eval.
- Extraction runs before embedding, so a failed extraction costs no embedding tokens,
  but a failed save after a successful extraction loses that spend.
