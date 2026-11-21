---
status: accepted
---

# TypeScript end to end, as a pnpm workspace

Mnemon is written in TypeScript throughout and laid out as a pnpm workspace.
`packages/core` (`@mnemon/core`) holds ingest, chunking and, later, extraction,
retrieval and answering. It is framework-free: no Next.js, no database driver, no
model SDK imports. Those arrive as adapters passed in by the caller. `apps/web`
(Next.js) is a thin shell around the core and comes in a later slice. The reason:
one language across the core and the Next.js shell, and one container to deploy.

Tooling: strict TypeScript, ESM only, Node 24, Vitest for tests, Biome for lint
and format. The core is exported as TypeScript source (`exports: "./src/index.ts"`)
with no build step. Relative imports carry the `.ts` extension, and the compiler
allows only erasable syntax, so Node 24 can run the source directly with type
stripping.

## Considered options

- **Python core** (e.g. FastAPI). Richer ML and NLP libraries. Rejected because
  Mnemon calls a hosted model and a hosted embeddings API rather than running
  models itself, so those libraries buy little. A Python core would mean two
  languages, two toolchains and a network boundary inside a small app. If local
  ML work appears later, it goes behind a separate worker; the core is not
  rewritten.

## Consequences

- Shipping source instead of a build means every consumer must handle `.ts`
  (Vitest and Node 24 do natively; Next.js via `transpilePackages`). It is a
  hypothesis, not yet verified, that Next.js resolves `.ts`-extension imports
  inside a transpiled workspace package. If it doesn't, a build step for the core
  is the fallback.
