---
status: accepted
---

# Adding a meeting from the browser: check the cost, then add

People can add a meeting from the web app at `/meetings/new`: paste a transcript or
choose a `.txt` file, give it a title, and add it. It runs the same core flow as
`pnpm ingest`: `planIngest`, then `runIngest`.

## Decision

- **Two steps.** "Check cost" plans the transcript and shows its turns, speakers and
  an upper estimate of the cost, or every problem with its line number. Nothing is
  paid for. "Add meeting" carries out the plan. Anything else would spend money on a
  click without saying how much, which CLAUDE.md rules out.
- **The cost shown is the cost paid.** The check returns a fingerprint (SHA-256 of
  title and transcript). "Add" plans again and runs only if the fingerprint matches.
  If the text was edited after the check, the new plan and its cost are shown instead.
  The server keeps no state between the steps.
- **One estimate, shared.** `ingestTokens(plan)` in the core estimates the tokens a
  plan pays for. The CLI and the web app price it with the adapters' list prices. It
  is tested against the fixture's measured extraction call (ADR-0006).
- **Limits before parsing.** Transcripts over 512 KB and titles over 200 characters
  are refused before any work. An hour-long meeting is about 60 KB.
- **API clients on first use.** A check, or a transcript already stored, needs no
  API keys.

## Measured

An 8-turn synthetic huddle added through the browser: estimate "about $0.06" (an
upper bound that allows 6,000 output tokens), actual $0.009 from Claude (1,426 in, 620
out) plus $0.000005 from Voyage, 5.2 s end to end.

## Considered options

- **One step with a confirm dialog.** Needs JavaScript, and a dialog can't show the
  plan's problems with their line numbers.
- **Keep the pending plan on the server between steps.** Needs a store and expiry for
  abandoned plans. The fingerprint gives the same guarantee with no state.
- **Upload only through the CLI.** Reviewers and users would need a terminal to try
  their own transcript.

## Consequences

- Anyone signed in can spend on extraction. That's fine behind the access code for a
  demo; real accounts would add per-user budgets and an audit of who added what.
- Extraction runs inside the request, which takes 5–30 s. A queue would let a long
  transcript finish after the browser closes.
