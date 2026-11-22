import { describe, expect, it } from "vitest";
import { createAnthropicModel, type ModelUsage } from "../src/index.ts";

interface Recorded {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records requests and answers like the Messages API. */
function fakeMessages(reply: Record<string, unknown> = {}, status = 200) {
  const requests: Recorded[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    if (status !== 200) {
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
        { status, headers: { "content-type": "application/json" } },
      );
    }
    const message = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: '{"records":[]}' }],
      stop_reason: "end_turn",
      stop_details: null,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      ...reply,
    };
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

const request = {
  system: "Extract records.",
  prompt: "<transcript>…</transcript>",
  schema: { type: "object", properties: {}, additionalProperties: false },
};

describe("createAnthropicModel", () => {
  it("asks Claude for JSON matching the schema and returns the parsed value", async () => {
    const { fetch, requests } = fakeMessages();
    const model = createAnthropicModel({ apiKey: "test-key", fetch, onUsage: () => {} });

    const result = await model.generateObject(request);

    expect(result).toEqual({ value: { records: [] }, model: "claude-opus-5-5" });
    expect(requests).toHaveLength(1);
    const sent = requests[0];
    expect(sent?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent?.headers.get("authorization")).toBe("Bearer test-key");
    expect(sent?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(sent?.body).toMatchObject({
      model: "claude-opus-5-5",
      system: "Extract records.",
      messages: [{ role: "user", content: "<transcript>…</transcript>" }],
      output_config: { effort: "high", format: { type: "json_schema", schema: request.schema } },
      fallbacks: "default",
    });
    expect(model.model).toBe("claude-opus-5-5");
  });

  it("reports the model that actually answered when a fallback served the request", async () => {
    const { fetch } = fakeMessages({ model: "claude-opus-5" });
    const model = createAnthropicModel({ apiKey: "k", fetch, onUsage: () => {} });

    expect((await model.generateObject(request)).model).toBe("claude-opus-5");
  });

  it("reports tokens and list-price cost for every call", async () => {
    const usage: ModelUsage[] = [];
    const { fetch } = fakeMessages();
    const model = createAnthropicModel({ apiKey: "k", fetch, onUsage: (u) => usage.push(u) });

    await model.generateObject(request);

    // claude-opus-5-5 lists at $4 in / $20 out per million: 1000 * 4e-6 + 500 * 20e-6.
    expect(usage).toEqual([
      {
        provider: "anthropic",
        model: "claude-opus-5-5",
        servedBy: "claude-opus-5-5",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.014,
      },
    ]);
  });

  it("fails, naming the category, when Claude declines", async () => {
    const { fetch } = fakeMessages({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "bio", explanation: null },
      content: [],
    });
    const model = createAnthropicModel({ apiKey: "k", fetch, onUsage: () => {} });

    await expect(model.generateObject(request)).rejects.toThrow(/declined.*bio/);
  });

  it("fails rather than parse output cut off at max_tokens", async () => {
    const { fetch } = fakeMessages({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"records":[' }],
    });
    const model = createAnthropicModel({ apiKey: "k", fetch, onUsage: () => {} });

    await expect(model.generateObject(request)).rejects.toThrow(/max_tokens/);
  });

  it("fails with the HTTP status, without echoing the key", async () => {
    const { fetch } = fakeMessages({}, 400);
    const model = createAnthropicModel({
      apiKey: "secret-key",
      fetch,
      onUsage: () => {},
      maxRetries: 0,
    });

    const failure = model.generateObject(request);

    await expect(failure).rejects.toThrow(/400/);
    await expect(failure).rejects.not.toThrow(/secret-key/);
  });

  it("refuses to start without an API key", () => {
    expect(() => createAnthropicModel({ apiKey: "" })).toThrow(/MNEMON_ANTHROPIC_API_KEY/);
  });
});
