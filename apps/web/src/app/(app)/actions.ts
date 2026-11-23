"use server";

import { ask } from "@mnemon/core";
import { requireSession } from "@/server/auth.ts";
import { ASK_ESTIMATE_USD, overLimitMessage, today } from "@/server/budget.ts";
import { mnemon } from "@/server/mnemon.ts";
import { type AnswerView, presentAnswer } from "@/server/present.ts";

export type AskState =
  | { readonly kind: "idle" }
  | { readonly kind: "answer"; readonly question: string; readonly view: AnswerView }
  | { readonly kind: "error"; readonly question: string; readonly message: string };

const MAX_QUESTION = 500;

export async function askQuestion(_: AskState, form: FormData): Promise<AskState> {
  const session = await requireSession();
  const question = String(form.get("question") ?? "").trim();
  if (!question) return { kind: "idle" };
  if (question.length > MAX_QUESTION) {
    return {
      kind: "error",
      question,
      message: `Keep the question under ${MAX_QUESTION} characters.`,
    };
  }
  const app = await mnemon();
  const paid = app.paid(session);
  try {
    const budget = await paid.budget(ASK_ESTIMATE_USD);
    if (!budget.ok) return { kind: "error", question, message: overLimitMessage(budget) };
    const result = await ask(question, {
      embedder: paid.embedder,
      search: app.search,
      transcripts: app.store,
      model: paid.languageModel("answering"),
      today: today(),
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
  } finally {
    await paid.recorded();
  }
}
