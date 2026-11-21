-- Hybrid retrieval over chunks: full text (tsvector + GIN) and vectors (pgvector + HNSW).
-- Columns are NOT NULL: a chunk that cannot be retrieved should not be stored.
-- Pre-release, so no backfill: this fails loudly if chunks already exist.

-- The model that produced a meeting's chunk embeddings. Vector search only
-- compares a question with chunks embedded by the same model.
alter table meetings add column embedding_model text not null check (embedding_model <> '');

-- 1024 dimensions: voyage-4-lite's default (ADR-0005). Changing model dimension
-- means a new column or table and a re-embed, never a silent mix.
alter table chunks add column embedding vector(1024) not null;

alter table chunks
  add column search tsvector generated always as (to_tsvector('english', text)) stored;

create index chunks_search_idx on chunks using gin (search);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
