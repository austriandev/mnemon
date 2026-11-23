# Mnemon

Ask questions about your meetings — decisions, action items, who said what —
and get answers that cite the exact moment in the transcript.

Built for teams in regulated settings, where an answer has to trace back to who said
it and when: every sentence of an answer cites a turn, and an answer whose citations
don't check out is not shown.

## Quickstart

Needs Node 24, pnpm 9 (`corepack enable` picks up the pinned version), Docker, and two
API keys: Voyage AI (https://dashboard.voyageai.com) and Anthropic
(https://platform.claude.com/settings/keys).

```sh
pnpm install
pnpm db:up && pnpm db:migrate   # Postgres + pgvector in Docker, schema applied
cp .env.example .env            # then add MNEMON_VOYAGE_API_KEY and MNEMON_ANTHROPIC_API_KEY
pnpm seed --yes                 # three synthetic meetings; prints the cost first (~$0.05)
pnpm web                        # http://localhost:3000
```

Try "What is the current dosing decision for new patients?" (it spans two meetings,
the second reversing the first), then open a source to land on the turn it cites.
Without `--yes`, `pnpm seed` only prints what it would load and cost.

## Architecture

All behaviour lives in `@mnemon/core`, which imports no framework, database or API
client. It defines small interfaces (`MeetingRepository`, `ChunkSearch`, `Embedder`,
`LanguageModel`, `SpendLedger`) and the adapters implement them. The web app, the CLI
and the eval are composition roots that wire the same core to the same adapters, so
the eval measures the code the app runs.

```mermaid
flowchart LR
  web["apps/web<br/>Next.js shell"] --> core
  cli["apps/cli<br/>ingest, ask, seed"] --> core
  eval["packages/eval<br/>labelled set, scoring"] --> core
  web & cli & eval -. wire .-> db & voyage & anthropic
  db["@mnemon/db<br/>Postgres + pgvector"] -->|implements| core
  voyage["@mnemon/voyage<br/>embeddings"] -->|implements| core
  anthropic["@mnemon/anthropic<br/>Claude via the SDK"] -->|implements| core
  core["@mnemon/core<br/>parse, chunk, extract,<br/>retrieve, answer, budget"]
```

**Adding a meeting.** Nothing is paid for until the plan has been priced and accepted.

```mermaid
flowchart LR
  T[transcript] --> P["parseTranscript<br/>speaker-labelled turns"]
  P --> C["chunkTurns<br/>runs of whole turns"]
  C --> Plan["planIngest<br/>new / unchanged / extract-only,<br/>with its cost"]
  Plan -->|accepted| X["extractRecords<br/>Claude: decisions, actions, topics,<br/>each citing its turns"]
  X --> E["embed chunks<br/>Voyage"]
  E --> S[("save whole or nothing<br/>Postgres")]
```

**Asking a question.**

```mermaid
flowchart LR
  Q[question] --> K["keyword search<br/>Postgres full text"]
  Q --> V["vector search<br/>pgvector, Voyage query embedding"]
  K & V --> F["reciprocal rank fusion<br/>top 8 chunks"]
  F --> X["excerpts: the chunks' turns,<br/>plus each meeting's records<br/>and the turns they cite"]
  X --> A["answer<br/>Claude, structured output"]
  A --> CK{"every citation<br/>points at a shown turn?"}
  CK -->|yes| OK[answer with citations]
  CK -->|no| R[rejected, not shown]
```

Where to read each part:

| Part | Code | Decision |
| --- | --- | --- |
| Transcript format and parsing | `packages/core/src/transcript` | ADR-0002 |
| Chunking | `packages/core/src/chunking` | ADR-0003 |
| Storage and search SQL | `packages/db/src`, `packages/db/migrations` | ADR-0004 |
| Hybrid retrieval | `packages/core/src/retrieval` | ADR-0005 |
| Record extraction (prompt, schema) | `packages/core/src/extraction` | ADR-0006, ADR-0013 |
| Answers and citation checks (prompt, schema) | `packages/core/src/answering` | ADR-0007, ADR-0011, ADR-0012 |
| Model choice, settled by the eval | `packages/anthropic/src`, `packages/eval` | ADR-0008 |
| Web shell, sign-in gate | `apps/web` | ADR-0009, ADR-0010 |
| Spending limit | `packages/core/src/spending`, `apps/web/src/server` | ADR-0014 |

Every model call logs its tokens and cost; the web app also records them in the
`spend` table.

## Setup

Requires Node 24, pnpm 9 (`corepack enable` picks up the pinned version) and Docker.

```sh
pnpm install
pnpm db:up       # Postgres 18 + pgvector on localhost:54320 (docker-compose.yml)
pnpm db:migrate  # apply SQL migrations to MNEMON_DATABASE_URL
pnpm typecheck   # strict TypeScript across the workspace
pnpm lint        # Biome lint + format check (`pnpm format` to fix)
pnpm test        # Vitest; database tests use their own throwaway databases
pnpm db:down     # stop Postgres (data is kept in the mnemon-db volume)
```

`MNEMON_DATABASE_URL` defaults to the local container. Copy `.env.example` to
`.env` and set:

- `MNEMON_VOYAGE_API_KEY` (from https://dashboard.voyageai.com) to embed and search;
- `MNEMON_ANTHROPIC_API_KEY` (from https://platform.claude.com/settings/keys) to
  extract records at ingest and to answer questions;
- `MNEMON_ACCESS_CODE` for the web app: the code people enter to sign in. Without
  it the app is open in development and refuses everyone in production.
- `MNEMON_DAILY_LIMIT_USD` (optional, default 5): the most the web app spends on paid
  calls in one day. `0` turns paid calls off.

```sh
pnpm ingest packages/core/fixtures/steering-committee.txt --title "AMT-208 steering committee" --date 2026-10-15
pnpm records <meeting-id>     # decisions, action items and topics, each with its citations
pnpm ask "Who is doing the vendor audit, and by when?"   # an answer citing its turns
pnpm retrieve "Who is doing the vendor audit?"          # the chunks retrieval found, and why
```

`ingest` prints the expected cost before any paid call; every model call logs its
tokens and cost as a JSON line on stderr. Ingesting a transcript that is already
stored does nothing, except extract records for a meeting stored before extraction.

## Web app

```sh
pnpm web                      # http://localhost:3000, reads the root .env
pnpm web:build && pnpm web:start
```

`apps/web` is a thin Next.js shell over the same core and adapters as the CLI. Sign in
with the access code, ask a question, and every sentence of the answer links to the
turn it cites on the meeting's page. Add your own meeting at `/meetings/new`: paste a
transcript or choose a `.txt` file, and Mnemon shows what it will cost before
anything is paid for (ADR-0010). Give the day it was held, and answers can tell what
is due or overdue (ADR-0012). Every paid call is recorded in the `spend` table, and
once a day's spend would pass `MNEMON_DAILY_LIMIT_USD`, questions and new meetings are
refused until midnight (ADR-0014). The web server doesn't migrate the database: run
`pnpm db:migrate` first. Session cookies are `Secure` in production, so serve it over
HTTPS. ADR-0009 has the design.

## Eval

```sh
pnpm eval                     # prints the plan and the expected cost; spends nothing
pnpm eval --yes               # runs it: retrieval, record extraction, answers
pnpm eval --only answers --configs sonnet --questions 5 --yes   # a slice
pnpm eval --only answers --ids list-oct,list-cmc --limit 3 --records off --yes
pnpm eval --only extraction --meetings kr44,joined --configs sonnet --yes   # long meetings
```

Four synthetic meetings (`packages/core/fixtures`) with hand-labelled gold records and
31 questions, 3 of them unanswerable, 4 asking for every action item of a meeting and 3
that need deadlines placed in time
(`packages/eval/src/dataset.ts`). One meeting is long on purpose: 165 turns and 21
action items (`kr44-clinical-operations.txt`). `--meetings joined` extracts from all four
joined into one 275-turn meeting, to see how extraction holds up as meetings grow
(ADR-0013). `--limit` sets how many chunks an answer retrieves,
and `--records off` answers without the meetings' records (ADR-0011). Each model
configuration runs over the same data through the same code the app uses, in its own
database (`mnemon_eval`). Results go to `packages/eval/results/`, and the numbers that
settled a choice go in its ADR.

## Layout

- `packages/core` (`@mnemon/core`): framework-free core. Transcript parsing,
  chunking, record extraction, retrieval and answering (prompts, schemas,
  citation checks).
- `packages/core/fixtures`: synthetic transcripts (fictional company and people).
- `packages/db` (`@mnemon/db`): Postgres storage, SQL migrations and chunk search.
- `packages/voyage` (`@mnemon/voyage`): Voyage AI embeddings, implementing the core's `Embedder`.
- `packages/anthropic` (`@mnemon/anthropic`): Claude via the Anthropic SDK, implementing
  the core's `LanguageModel`.
- `packages/eval` (`@mnemon/eval`): the labelled eval set, its scoring, and the runner.
- `apps/web` (`@mnemon/web`): the Next.js app: sign-in gate, ask, meeting pages.
- `apps/cli`: `ingest`, `records`, `ask` and `retrieve` commands wiring the packages together.
- `docs/adr`: one record per architectural decision.
- `GLOSSARY.md`: the domain language.
