---
status: accepted (model, limits and fusion constant provisional)
---

# Hybrid retrieval: Postgres full text + Voyage embeddings, fused with RRF in the core

A question is answered from the chunks that two independent searches agree on:

1. **Keyword search** over each chunk's rendered text (speakers included), using a
   generated `tsvector` column with a GIN index. The question is stemmed with the
   same `english` configuration and its words are OR-ed, so a chunk needs only some
   of them. Ranking is Postgres's `ts_rank_cd`.
2. **Vector search** with pgvector: cosine distance over an HNSW index, against
   chunks embedded by the same model as the question.
3. **Reciprocal rank fusion** (`score = Σ 1 / (60 + rank)`) merges the two
   rankings using rank positions only, so text-relevance and cosine scores never
   have to be put on one scale.

Fusion and the orchestration live in the core (`fuseRankings`, `retrieve`), behind
two ports: `Embedder` and `ChunkSearch`. Postgres (`@mnemon/db`) and Voyage
(`@mnemon/voyage`) are adapters; the core tests run against in-memory fakes. This
refines ADR-0004, which expected fusion inside a single SQL query. Fusing in
TypeScript keeps the ranking logic pure and testable without a database, and the
two queries cost one extra round trip.

Every retrieved chunk keeps its keyword rank and its vector rank, so an auditor can
see *why* it was retrieved, not just that it was.

## Embeddings: Voyage `voyage-4-lite`, 1024 dimensions

Anthropic, our model provider, offers no embeddings model and points to Voyage AI.
`voyage-4-lite` at its default 1024 dimensions is $0.02 per million tokens, and every
account's first 200M tokens on the voyage-4 family are free (pricing page dated
2026-09-29). Documents are embedded with `input_type: "document"` and questions with
`"query"`. The adapter is plain `fetch`, with no SDK. It logs tokens and list-price
cost on every request, and retries 429 and 5xx with backoff.

The model is stored per meeting (`meetings.embedding_model`). Vector search only
compares like with like, and changing models means re-embedding, never mixing.

**Provisional** until the retrieval eval runs: the model (`voyage-4-lite` vs
`voyage-4`), the dimension, `limit: 8`, `candidates: 30` and RRF's `k = 60` (the
value from Cormack et al., 2009). The eval's numbers go here.

| Setting | Recall@k | MRR | Notes |
| --- | --- | --- | --- |
| _pending retrieval eval_ | | | |

## Considered options

- **True BM25** (ParadeDB `pg_search` or similar). Better keyword ranking than
  `ts_rank_cd`, but it is an extra extension to install and operate. The roadmap's
  "BM25" is, for now, Postgres full text; the eval shows whether the difference matters.
- **Vector search alone.** It misses exact terms that carry meaning in this domain:
  product codes (AMT-208), doses (20 mg), names.
- **A local embedding model** (e.g. via transformers.js). $0 with no key, and
  transcripts never leave the deployment, which is a real argument for regulated
  customers. Weaker retrieval quality and a heavier container. It stays a drop-in
  alternative behind `Embedder` if data residency requires it.

## Consequences

- Without a payment method on the Voyage account, the API allows **3 requests per
  minute and 10K tokens per minute** (observed in its 429 response). Free tokens
  still apply after a card is added. The demo account should have one.
- Transcript text is sent to Voyage for embedding. For a real deployment that makes
  Voyage a sub-processor to list, unless the local `Embedder` is used.
