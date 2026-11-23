"use server";

import { createHash } from "node:crypto";
import { type IngestDeps, planIngest, runIngest } from "@mnemon/core";
import { redirect } from "next/navigation";
import { type PlanView, planCostUsd, presentPlan, readSubmission } from "@/server/add-meeting.ts";
import { requireSession } from "@/server/auth.ts";
import { overLimitMessage } from "@/server/budget.ts";
import { mnemon } from "@/server/mnemon.ts";

export type AddState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "checked";
      readonly title: string;
      readonly heldOn: string;
      readonly source: string;
      readonly plan: PlanView;
      /** Ties "Add" to exactly what was checked, so the cost shown is the cost paid. */
      readonly checked: string;
      readonly notice?: string;
    }
  | {
      readonly kind: "error";
      readonly title: string;
      readonly source: string;
      readonly message: string;
    };

const fingerprint = (title: string, source: string) =>
  createHash("sha256").update(`${title}\n${source}`, "utf8").digest("hex");

/**
 * Two steps, one action. "check" plans the transcript and shows its cost; nothing is
 * paid for. "add" plans it again and runs it, but only if the title and transcript are
 * the ones that were checked: otherwise it shows the new plan instead.
 */
export async function addMeeting(_: AddState, form: FormData): Promise<AddState> {
  await requireSession();
  const submission = await readSubmission(form);
  const typedTitle = String(form.get("title") ?? "");
  if (!submission.ok) {
    return {
      kind: "error",
      title: typedTitle,
      source: String(form.get("source") ?? ""),
      message: submission.message,
    };
  }
  const { title, source, heldOn } = submission;
  const app = await mnemon();
  const plan = await planIngest(source, title, app.store, heldOn ? { heldOn } : {});
  const checked = fingerprint(`${title}\n${heldOn ?? ""}`, source);
  const shown: AddState = {
    kind: "checked",
    title,
    heldOn: heldOn ?? "",
    source,
    plan: presentPlan(plan),
    checked,
  };

  if (form.get("intent") !== "add" || plan.kind === "invalid") return shown;
  if (plan.kind === "unchanged") {
    // Nothing to pay for; a date given for an undated meeting is still recorded.
    if (plan.dateToAdd) await app.store.setHeldOn(plan.meeting.id, plan.dateToAdd);
    return shown;
  }
  if (form.get("checked") !== checked) {
    return { ...shown, notice: "The transcript or title changed. Here is the new cost." };
  }
  let id: string;
  try {
    const budget = await app.budget(planCostUsd(plan));
    if (!budget.ok) return { ...shown, notice: overLimitMessage(budget) };
    // API clients are created only when runIngest reaches a paid step.
    const deps: IngestDeps = {
      repository: app.store,
      get embedder() {
        return app.embedder;
      },
      get model() {
        return app.languageModel("extraction");
      },
    };
    const result = await runIngest(plan, deps);
    id = result.id;
  } catch (error) {
    console.error(JSON.stringify({ event: "add_meeting_failed", error: String(error) }));
    return {
      kind: "error",
      title,
      source,
      message: "The meeting couldn't be added. Nothing was stored; try again in a moment.",
    };
  }
  redirect(`/meetings/${id}`);
}
