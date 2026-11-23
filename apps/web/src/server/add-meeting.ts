// Adding a meeting from the browser: what a submitted form holds, and how a plan is
// shown before anything is paid for. The flow itself is the core's planIngest/runIngest.
import { CHOSEN_MODELS, estimateCostUsd } from "@mnemon/anthropic";
import { type IngestPlan, ingestTokens } from "@mnemon/core";
import { VOYAGE_PRICE_PER_MILLION_TOKENS } from "@mnemon/voyage";

/** An hour-long meeting is ~60 KB of transcript; this leaves room without inviting abuse. */
const MAX_TRANSCRIPT_BYTES = 512 * 1024;
const MAX_TITLE = 200;

export type Submission =
  | {
      readonly ok: true;
      readonly title: string;
      readonly source: string;
      /** YYYY-MM-DD as the date input sends it; checked by planIngest. */
      readonly heldOn?: string;
    }
  | { readonly ok: false; readonly message: string };

/** Reads the form: a pasted transcript, or else an uploaded file. Never parses it. */
export async function readSubmission(form: FormData): Promise<Submission> {
  const title = String(form.get("title") ?? "").trim();
  if (title.length > MAX_TITLE) {
    return { ok: false, message: `Keep the title under ${MAX_TITLE} characters.` };
  }
  const tooBig = {
    ok: false,
    message: "The transcript is over 512 KB. Split it, or ingest it with pnpm ingest.",
  } as const;

  let source = String(form.get("source") ?? "");
  if (Buffer.byteLength(source, "utf8") > MAX_TRANSCRIPT_BYTES) return tooBig;
  const file = form.get("file");
  if (source.trim() === "" && file instanceof File && file.size > 0) {
    if (file.size > MAX_TRANSCRIPT_BYTES) return tooBig;
    source = await file.text();
  }
  if (source.trim() === "") {
    return { ok: false, message: "Paste a transcript or choose a .txt file." };
  }
  const heldOn = String(form.get("heldOn") ?? "").trim();
  return heldOn ? { ok: true, title, source, heldOn } : { ok: true, title, source };
}

export type PlanView =
  | {
      readonly kind: "invalid";
      readonly problems: readonly { readonly line: number | null; readonly message: string }[];
    }
  | { readonly kind: "unchanged"; readonly id: string; readonly title: string }
  | {
      readonly kind: "ready";
      readonly title: string;
      readonly turns: number;
      readonly speakers: number;
      /** Stored before records existed: only extraction is left to pay for. */
      readonly embedded: boolean;
      /** An upper estimate at list price, rounded for reading. */
      readonly cost: string;
    };

export function presentPlan(plan: IngestPlan): PlanView {
  switch (plan.kind) {
    case "invalid":
      return {
        kind: "invalid",
        problems: plan.errors.map((e) => ({
          line: e.line,
          message: e.message.replace(/^Line \d+: /, ""),
        })),
      };
    case "unchanged":
      return { kind: "unchanged", id: plan.meeting.id, title: plan.meeting.title };
    default: {
      const tokens = ingestTokens(plan);
      const usd =
        estimateCostUsd(
          CHOSEN_MODELS.extraction.model,
          tokens.extractionInput,
          tokens.extractionOutput,
        ) +
        (tokens.embedding * VOYAGE_PRICE_PER_MILLION_TOKENS["voyage-4-lite"]) / 1e6;
      return {
        kind: "ready",
        title: plan.kind === "new" ? plan.title : plan.meeting.title,
        turns: plan.turns.length,
        speakers: new Set(plan.turns.map((t) => t.speaker)).size,
        embedded: plan.kind === "extract-only",
        cost: usd < 0.01 ? "under $0.01" : `about $${usd.toFixed(2)}`,
      };
    }
  }
}
