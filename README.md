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

`MNEMON_DATABASE_URL` defaults to the local container. See `.env.example`.

## Layout

- `packages/core` (`@mnemon/core`): framework-free core. Transcript parsing and
  chunking today; extraction, retrieval and answering in later slices.
- `packages/core/fixtures`: synthetic transcripts (fictional company and people).
- `packages/db` (`@mnemon/db`): Postgres storage and SQL migrations, outside the core.
- `docs/adr`: one record per architectural decision.
- `GLOSSARY.md`: the domain language.
