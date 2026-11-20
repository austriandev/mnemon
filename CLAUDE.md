# Mnemon — agent instructions

Mnemon answers questions about meetings: what was discussed, what was decided,
who owns which action item. It works over speaker-labelled, timestamped
transcripts, and every answer cites the moment in the transcript it came from.
Target users are teams in regulated life-sciences settings, where an answer
has to trace back to who said it and when.

One name everywhere: **Mnemon** in prose and UI, `mnemon` in the repo,
packages, containers and database, `MNEMON_` as the env-var prefix.

## Explain every change

Each change you hand back carries four short lines, in this order:

1. **What** it does.
2. **Why** this way.
3. **Better with more time**: what a production version would do instead.
4. **Attack and answer**: the strongest objection a reviewer would raise, and
   the reply.

Label anything unverified as a hypothesis.

## Engineering standards

- **Red-green-refactor.** A failing test before behaviour code (`/tdd`).
- **Deep core module.** Ingest, extraction, retrieval and answering live in a
  framework-free core with a small interface; Next.js is a thin shell around it.
- **Context assembly is ours.** Call Claude through the official Anthropic SDK;
  build prompts and context in our own code, where a reviewer can read them.
- **Evals decide.** Model, chunking and retrieval choices are settled by an eval
  run, with the numbers recorded in the ADR that made the choice.
- **Decisions go in `docs/adr/`**, one per decision, written when it is made.
- **Cost is observable.** Log tokens and cost for every model call. State the
  expected cost before any batch run (eval sweeps, synthetic data generation).

## Data

Demo data is synthetic: fictional companies, people and products. Real
company names, brands and patient data stay out of the repo.
