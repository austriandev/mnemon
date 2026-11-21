import { describe, expect, it } from "vitest";
import { createVoyageEmbedder, type EmbeddingUsage } from "../src/index.ts";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: { input: string[]; model: string; input_type: string; output_dimension: number };
}

/** A fetch that records requests and answers like the Voyage embeddings API. */
function fakeVoyage(options: { dims?: number; status?: number; shuffle?: boolean } = {}) {
  const requests: Recorded[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Recorded["body"];
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    if (options.status && options.status !== 200) {
      return new Response(JSON.stringify({ detail: "Invalid API key" }), {
        status: options.status,
      });
    }
    const dims = options.dims ?? body.output_dimension;
    const data = body.input.map((text, index) => ({
      object: "embedding",
      index,
      // Encode the text length so tests can check vectors come back in input order.
      embedding: Array.from({ length: dims }, (_, d) => (d === 0 ? text.length : 0)),
    }));
    if (options.shuffle) data.reverse();
    const tokens = body.input.reduce((sum, text) => sum + text.split(" ").length, 0);
    return new Response(
      JSON.stringify({ object: "list", data, model: body.model, usage: { total_tokens: tokens } }),
      { status: 200 },
    );
  };
  return { fetch, requests };
}

describe("createVoyageEmbedder", () => {
  it("embeds texts with the configured model, input type and dimension", async () => {
    const { fetch, requests } = fakeVoyage();
    const embedder = createVoyageEmbedder({ apiKey: "test-key", fetch, onUsage: () => {} });

    const result = await embedder.embed(["hold the dose", "vendor audit plan"], "document");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(requests[0]?.headers.authorization).toBe("Bearer test-key");
    expect(requests[0]?.body).toEqual({
      input: ["hold the dose", "vendor audit plan"],
      model: "voyage-4-lite",
      input_type: "document",
      output_dimension: 1024,
    });
    expect(result.tokens).toBe(6);
    expect(result.vectors.map((v) => [v.length, v[0]])).toEqual([
      [1024, 13],
      [1024, 17],
    ]);
    expect(embedder.model).toBe("voyage-4-lite");
    expect(embedder.dimensions).toBe(1024);
  });

  it("returns vectors in input order even when the API answers out of order", async () => {
    const { fetch } = fakeVoyage({ shuffle: true });
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch, onUsage: () => {} });

    const { vectors } = await embedder.embed(["a", "bbb"], "query");

    expect(vectors.map((v) => v[0])).toEqual([1, 3]);
  });

  it("splits large inputs into batches and sums their tokens", async () => {
    const { fetch, requests } = fakeVoyage();
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch, batchSize: 2, onUsage: () => {} });

    const { vectors, tokens } = await embedder.embed(
      ["one", "two", "three four", "five"],
      "document",
    );

    expect(requests.map((r) => r.body.input)).toEqual([
      ["one", "two"],
      ["three four", "five"],
    ]);
    expect(vectors.map((v) => v[0])).toEqual([3, 3, 10, 4]);
    expect(tokens).toBe(5);
  });

  it("reports tokens and list-price cost for every request", async () => {
    const usage: EmbeddingUsage[] = [];
    const { fetch } = fakeVoyage();
    const embedder = createVoyageEmbedder({
      apiKey: "k",
      fetch,
      batchSize: 1,
      onUsage: (u) => usage.push(u),
    });

    await embedder.embed(["one two", "three"], "document");

    // voyage-4-lite lists at $0.02 per million tokens.
    expect(usage).toEqual([
      {
        provider: "voyage",
        model: "voyage-4-lite",
        inputType: "document",
        tokens: 2,
        costUsd: 4e-8,
      },
      {
        provider: "voyage",
        model: "voyage-4-lite",
        inputType: "document",
        tokens: 1,
        costUsd: 2e-8,
      },
    ]);
  });

  it("makes no request for an empty input", async () => {
    const { fetch, requests } = fakeVoyage();
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch, onUsage: () => {} });

    expect(await embedder.embed([], "document")).toEqual({ vectors: [], tokens: 0 });
    expect(requests).toHaveLength(0);
  });

  it("fails with the HTTP status and the API's message, without echoing the key", async () => {
    const { fetch } = fakeVoyage({ status: 401 });
    const embedder = createVoyageEmbedder({ apiKey: "secret-key", fetch, onUsage: () => {} });

    const failure = embedder.embed(["x"], "query");

    await expect(failure).rejects.toThrow(/401.*Invalid API key/);
    await expect(failure).rejects.not.toThrow(/secret-key/);
  });

  it("fails when the API returns vectors of the wrong dimension", async () => {
    const { fetch } = fakeVoyage({ dims: 512 });
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch, onUsage: () => {} });

    await expect(embedder.embed(["x"], "query")).rejects.toThrow(/512.*1024/);
  });

  it("retries rate-limited and server-error responses with backoff, then succeeds", async () => {
    const { fetch: ok } = fakeVoyage();
    const statuses = [429, 503];
    const waits: number[] = [];
    const flaky: typeof globalThis.fetch = async (url, init) => {
      const status = statuses.shift();
      if (status === 429) {
        return new Response("{}", { status, headers: { "retry-after": "7" } });
      }
      if (status) return new Response("{}", { status });
      return ok(url, init);
    };
    const embedder = createVoyageEmbedder({
      apiKey: "k",
      fetch: flaky,
      onUsage: () => {},
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    const { vectors } = await embedder.embed(["x"], "query");

    expect(vectors).toHaveLength(1);
    // Retry-After (7 s) is honoured; without it, backoff doubles from 1 s.
    expect(waits).toEqual([7000, 2000]);
  });

  it("gives up after the last retry with the API's error", async () => {
    const waits: number[] = [];
    const embedder = createVoyageEmbedder({
      apiKey: "k",
      fetch: async () => new Response('{"detail":"slow down"}', { status: 429 }),
      onUsage: () => {},
      maxRetries: 2,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(embedder.embed(["x"], "query")).rejects.toThrow(/429.*slow down/);
    expect(waits).toEqual([1000, 2000]);
  });

  it("does not retry a client error such as a bad key", async () => {
    let calls = 0;
    const embedder = createVoyageEmbedder({
      apiKey: "k",
      fetch: async () => {
        calls++;
        return new Response("{}", { status: 401 });
      },
      onUsage: () => {},
      sleep: async () => {},
    });

    await expect(embedder.embed(["x"], "query")).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it("refuses to start without an API key", () => {
    expect(() => createVoyageEmbedder({ apiKey: "" })).toThrow(/MNEMON_VOYAGE_API_KEY/);
  });
});
