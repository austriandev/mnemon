import type { TokenCounter } from "./types.ts";

/**
 * Rough token count: one token per four characters, rounded up. A placeholder until
 * the real tokenizer of the embedding and answering models is wired in. It is
 * typically within ~25% for English prose and undercounts digit- and
 * punctuation-heavy text, so treat budgets built on it as approximate (hypothesis,
 * not yet measured on our data).
 */
export const approximateTokenCounter: TokenCounter = {
  count: (text) => Math.ceil(text.length / 4),
};
