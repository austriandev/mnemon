import { describe, expect, it } from "vitest";
import { createAnthropicModel, type ModelUsage } from "../src/index.ts";

interface Recorded {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records requests and answers like the Messages API, streamed or not. */
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
    if (requests.at(-1)?.body.stream === true) {
      return new Response(serverSentEvents(message), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

/** The message as the streaming API sends it: one event per block, usage at the end. */
function serverSentEvents(message: Record<string, unknown>): string {
  const { content, stop_reason, stop_details, usage, ...rest } = message as {
    content: { type: string; text: string }[];
    stop_reason: string;
    stop_details: unknown;
    usage: Record<string, number>;
  };
  const events: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: {
        ...rest,
        content: [],
        stop_reason: null,
        stop_details: null,
        usage: { ...usage, output_tokens: 1 },
      },
    },
    ...content.flatMap((block, index) => [
      { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
      { type: "content_block_stop", index },
    ]),
    { type: "message_delta", delta: { stop_reason, stop_details, stop_sequence: null }, usage },
    { type: "message_stop" },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
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

  it("streams the call, so a long meeting's extraction has room for its output", async () => {
    const { fetch, requests } = fakeMessages();
    const model = createAnthropicModel({ apiKey: "k", fetch, onUsage: () => {} });

    await model.generateObject(request);

    expect(requests[0]?.body).toMatchObject({ stream: true, max_tokens: 32_000 });
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
