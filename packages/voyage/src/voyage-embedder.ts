import type { Embedder, EmbeddingInputType } from "@mnemon/core";

/**
 * List prices in USD per million tokens, from https://docs.voyageai.com/docs/pricing
 * (page dated 2026-09-29). Each account's first 200M tokens on these models are free,
 * so the logged cost is what the call would cost past the free tier.
 */
export const VOYAGE_PRICE_PER_MILLION_TOKENS = {
  "voyage-4-lite": 0.02,
  "voyage-4": 0.06,
  "voyage-4-large": 0.12,
} as const;

export type VoyageModel = keyof typeof VOYAGE_PRICE_PER_MILLION_TOKENS;

export interface EmbeddingUsage {
  readonly provider: "voyage";
  readonly model: VoyageModel;
  readonly inputType: EmbeddingInputType;
  readonly tokens: number;
  readonly costUsd: number;
}

export interface VoyageEmbedderOptions {
  readonly apiKey: string;
  readonly model?: VoyageModel;
  /** 2048, 1024, 512 or 256 for the voyage-4 family. Must match the database column. */
  readonly dimensions?: 256 | 512 | 1024 | 2048;
  /** Texts per request. The API allows up to 1,000 and a per-request token cap. */
  readonly batchSize?: number;
  /** Called once per API request; defaults to a JSON line on stderr. */
  readonly onUsage?: (usage: EmbeddingUsage) => void;
  readonly fetch?: typeof globalThis.fetch;
}

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

interface VoyageResponse {
  data: { index: number; embedding: number[] }[];
  usage: { total_tokens: number };
}

export function createVoyageEmbedder({
  apiKey,
  model = "voyage-4-lite",
  dimensions = 1024,
  batchSize = 128,
  onUsage = logUsage,
  fetch = globalThis.fetch,
}: VoyageEmbedderOptions): Embedder {
  if (!apiKey) {
    throw new Error("No Voyage API key: set MNEMON_VOYAGE_API_KEY in .env (see .env.example).");
  }

  async function embedBatch(texts: string[], inputType: EmbeddingInputType) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        input: texts,
        model,
        input_type: inputType,
        output_dimension: dimensions,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Voyage embeddings request failed: HTTP ${response.status} ${detail}`);
    }
    const body = (await response.json()) as VoyageResponse;
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length) {
      throw new Error(`Voyage returned ${vectors.length} vectors for ${texts.length} texts`);
    }
    for (const vector of vectors) {
      if (vector.length !== dimensions) {
        throw new Error(
          `Voyage returned a ${vector.length}-dimension vector; expected ${dimensions}`,
        );
      }
    }
    const tokens = body.usage.total_tokens;
    onUsage({
      provider: "voyage",
      model,
      inputType,
      tokens,
      costUsd: (tokens * VOYAGE_PRICE_PER_MILLION_TOKENS[model]) / 1_000_000,
    });
    return { vectors, tokens };
  }

  return {
    model,
    dimensions,
    async embed(texts, inputType) {
      const vectors: number[][] = [];
      let tokens = 0;
      // Sequential on purpose: keeps well inside rate limits at Mnemon's volume.
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = await embedBatch(texts.slice(start, start + batchSize), inputType);
        vectors.push(...batch.vectors);
        tokens += batch.tokens;
      }
      return { vectors, tokens };
    },
  };
}

function logUsage(usage: EmbeddingUsage): void {
  console.error(JSON.stringify({ event: "model_call", ...usage }));
}
