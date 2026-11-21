# Mnemon

Ask questions about your meetings — decisions, action items, who said what —
and get answers that cite the exact moment in the transcript.

Work in progress. Setup, architecture and design notes land here as they are built.

## Setup

Requires Node 24 and pnpm 9 (`corepack enable` picks up the pinned version).

```sh
pnpm install
pnpm typecheck   # strict TypeScript across the workspace
pnpm lint        # Biome lint + format check (`pnpm format` to fix)
pnpm test        # Vitest, including property tests
```

## Layout

- `packages/core` (`@mnemon/core`): framework-free core. Transcript parsing and
  chunking today; extraction, retrieval and answering in later slices.
- `packages/core/fixtures`: synthetic transcripts (fictional company and people).
- `docs/adr`: one record per architectural decision.
- `GLOSSARY.md`: the domain language.
