import Anthropic from "@anthropic-ai/sdk";
import type { LanguageModel, StructuredRequest } from "@mnemon/core";

/**
 * List prices in USD per million tokens (Anthropic first-party API, 2026-11-03).
 * The logged cost is an estimate at the price of the model that answered.
 */
export const ANTHROPIC_PRICE_PER_MILLION_TOKENS = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
} as const satisfies Record<string, { input: number; output: number }>;

export type AnthropicModelId = keyof typeof ANTHROPIC_PRICE_PER_MILLION_TOKENS;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelUsage {
  readonly provider: "anthropic";
  /** The model asked for. */
  readonly model: string;
  /** The model that answered: different only after a server-side fallback. */
  readonly servedBy: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Null when the answering model has no entry in the price table. */
  readonly costUsd: number | null;
}

export interface AnthropicModelOptions {
  readonly apiKey: string;
  readonly model?: AnthropicModelId;
  /** Thinking depth and token spend. Provisional until the extraction eval runs. */
  readonly effort?: Effort;
  readonly maxTokens?: number;
  /** Called once per API call; defaults to a JSON line on stderr. */
  readonly onUsage?: (usage: ModelUsage) => void;
  readonly fetch?: typeof globalThis.fetch;
  /** The SDK's own retries (429, 5xx, connection errors). */
  readonly maxRetries?: number;
}

// Server-side fallback: if a safety classifier declines, the API re-runs the request on
// a fallback model inside the same call. The answering model is reported, never hidden.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createAnthropicModel({
  apiKey,
  model = "claude-opus-5-5",
  effort = "high",
  maxTokens = 16_000,
  onUsage = logUsage,
  fetch,
  maxRetries = 2,
}: AnthropicModelOptions): LanguageModel {
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key: set MNEMON_ANTHROPIC_API_KEY in .env (see .env.example).",
    );
  }
  const client = new Anthropic({ apiKey, maxRetries, ...(fetch ? { fetch } : {}) });

  return {
    model,
    async generateObject({ system, prompt, schema }: StructuredRequest) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort, format: { type: "json_schema", schema: { ...schema } } },
      });

      const usage = response.usage;
      onUsage({
        provider: "anthropic",
        model,
        servedBy: response.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        costUsd: costOf(response.model, usage),
      });

      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? "unspecified";
        throw new Error(`Claude declined the request (category: ${category}).`);
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error(
          `Output stopped at max_tokens (${maxTokens}) before the JSON was complete.`,
        );
      }
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      return { value: JSON.parse(text) as unknown, model: response.model };
    },
  };
}

/** List-price cost of a call with these token counts, for estimates printed before a run. */
export function estimateCostUsd(
  model: AnthropicModelId,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = ANTHROPIC_PRICE_PER_MILLION_TOKENS[model];
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

function costOf(
  served: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  },
): number | null {
  const price = ANTHROPIC_PRICE_PER_MILLION_TOKENS[served as AnthropicModelId];
  if (!price) return null;
  // Cache reads bill at 0.1x input, cache writes (5-minute TTL) at 1.25x.
  const micro =
    usage.input_tokens * price.input +
    (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
    (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
    usage.output_tokens * price.output;
  return Number((micro / 1e6).toPrecision(6));
}

function logUsage(usage: ModelUsage): void {
  console.error(JSON.stringify({ event: "model_call", ...usage }));
}
