# Mnemon

Ask questions about your meetings — decisions, action items, who said what —
and get answers that cite the exact moment in the transcript.

Work in progress. Setup, architecture and design notes land here as they are built.

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

```sh
pnpm ingest packages/core/fixtures/steering-committee.txt --title "AMT-208 steering committee"
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
turn it cites on the meeting's page. The web server doesn't migrate the database: run
`pnpm db:migrate` first. Session cookies are `Secure` in production, so serve it over
HTTPS. ADR-0009 has the design.

## Eval

```sh
pnpm eval                     # prints the plan and the expected cost; spends nothing
pnpm eval --yes               # runs it: retrieval, record extraction, answers
pnpm eval --only answers --configs sonnet --questions 5 --yes   # a slice
```

Three synthetic meetings (`packages/core/fixtures`) with hand-labelled gold records and
22 questions, 3 of them unanswerable (`packages/eval/src/dataset.ts`). Each model
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
