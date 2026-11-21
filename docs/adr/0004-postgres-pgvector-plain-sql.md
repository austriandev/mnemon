---
status: accepted
---

# Postgres + pgvector, plain SQL, storage outside the core

Mnemon stores everything in one Postgres database with the pgvector extension:
meetings, turns and chunks now, and embeddings, full-text indexes and extracted
records in later slices. Hybrid retrieval (BM25-style full text plus vector
similarity, fused with RRF) then runs as a single SQL query in one transaction,
with no second store to keep in sync. Locally it runs from `docker-compose.yml`
(`pgvector/pgvector:0.8.7-pg18`, bound to `127.0.0.1:54320`); CI runs the same
image as a service container.

Storage lives in `packages/db` (`@mnemon/db`). It depends on `@mnemon/core` for
the `Turn` and `Chunk` types; the core never depends on it (ADR-0001). The driver
is postgres.js (`postgres@3.4`): queries are tagged templates, so parameters are
always bound, never concatenated. Migrations are plain `.sql` files applied in
file-name order by a ~40-line runner of our own: one transaction for the whole
run, serialised with an advisory lock, versions recorded in `schema_migrations`.

The schema itself carries traceability:

- The original transcript is stored verbatim with its SHA-256. Any citation can be
  checked against the exact file that was ingested.
- Foreign keys from `chunks (meeting_id, first_turn | last_turn)` to `turns`
  stop a chunk from citing a turn that doesn't exist.
- A meeting is saved whole or not at all.

## Considered options

- **A dedicated vector database** (e.g. Qdrant, Pinecone). Rejected: it means two
  stores, two consistency stories, and fusion in application code. At Mnemon's
  scale (thousands of chunks per team, not billions), pgvector's HNSW index is
  enough. *Hypothesis:* not yet load-tested.
- **An ORM or query builder** (Drizzle, Prisma, Kysely). Rejected for now. The
  queries that matter (hybrid retrieval with CTEs, `tsvector`, `<=>`) are
  hand-written SQL either way, and plain SQL is what a reviewer reads fastest.
  Revisit if the schema grows enough that typed query building pays off.
- **SQLite + sqlite-vec.** Simpler to run, but a weaker fit for a multi-user
  deployment and for the managed Postgres a pharma IT team already operates.

## Consequences

- Row types are mapped to domain types by hand in `meeting-store.ts`. The
  round-trip test (save the fixture, read it back, compare) guards that mapping.
- `pnpm test` needs Postgres running (`pnpm db:up`). Tests create and drop their
  own throwaway database, so they never touch development data.
- postgres.js 4.x existed when this was written but was weeks old. 3.4 is pinned
  for stability.
