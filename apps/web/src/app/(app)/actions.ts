"use server";

import { ask } from "@mnemon/core";
import { requireSession } from "@/server/auth.ts";
import { mnemon } from "@/server/mnemon.ts";
import { type AnswerView, presentAnswer } from "@/server/present.ts";

export type AskState =
  | { readonly kind: "idle" }
  | { readonly kind: "answer"; readonly question: string; readonly view: AnswerView }
  | { readonly kind: "error"; readonly question: string; readonly message: string };

const MAX_QUESTION = 500;

export async function askQuestion(_: AskState, form: FormData): Promise<AskState> {
  await requireSession();
  const question = String(form.get("question") ?? "").trim();
  if (!question) return { kind: "idle" };
  if (question.length > MAX_QUESTION) {
    return {
      kind: "error",
      question,
      message: `Keep the question under ${MAX_QUESTION} characters.`,
    };
  }
  try {
    const app = await mnemon();
    const result = await ask(question, {
      embedder: app.embedder,
      search: app.search,
      transcripts: app.store,
      model: app.languageModel("answering"),
      // The server's calendar day: this app runs where its users are (local, per ADR-0009).
      today: new Date().toLocaleDateString("en-CA"),
    });
    if (result.answer.status === "rejected") {
      console.warn(JSON.stringify({ event: "answer_withheld", reason: result.answer.reason }));
    }
    return { kind: "answer", question, view: presentAnswer(result) };
  } catch (error) {
    // The detail goes to the server log; the browser gets a plain sentence.
    console.error(JSON.stringify({ event: "ask_failed", error: String(error) }));
    return {
      kind: "error",
      question,
      message: "Something went wrong while answering. Try again in a moment.",
    };
  }
}
