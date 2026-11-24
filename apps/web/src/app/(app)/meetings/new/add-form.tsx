"use client";

import { ArrowRight, FileUp, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useActionState, useRef, useState } from "react";
import { type AddState, addMeeting } from "./actions.ts";
import { AudioStart } from "./audio-start.tsx";

export function AddForm() {
  const [state, action, pending] = useActionState<AddState, FormData>(addMeeting, {
    kind: "idle",
  });
  const [intent, setIntent] = useState<"check" | "add">("check");
  const title = useRef<HTMLInputElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);

  // A chosen file fills the text area, so what is checked is what you can see.
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !source.current) return;
    source.current.value = await file.text();
    if (title.current && !title.current.value.trim()) {
      title.current.value = file.name.replace(/\.[^.]+$/, "");
    }
  };

  const values =
    state.kind === "checked"
      ? state
      : state.kind === "error"
        ? { ...state, heldOn: "" }
        : { title: "", heldOn: "", source: "" };
  const ready = state.kind === "checked" && state.plan.kind === "ready" ? state.plan : null;

  return (
    <form action={action} className="card add-form">
      <AudioStart
        onTranscript={(text) => {
          if (source.current) source.current.value = text;
        }}
        onTitle={(text) => {
          if (title.current && !title.current.value.trim()) title.current.value = text;
        }}
      />
      {/* A new state remounts the fields with what the server read. */}
      <div key={state.kind === "idle" ? "idle" : `${values.title}:${values.source.length}`}>
        <label className="field">
          <span>Title</span>
          <input
            ref={title}
            className="text-input"
            name="title"
            defaultValue={values.title}
            placeholder="AMT-208 steering committee (Dec)"
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <label className="field" style={{ marginTop: 20 }}>
          <span>
            Held on <span className="quiet">(optional, so deadlines can be dated)</span>
          </span>
          <input
            className="text-input"
            type="date"
            name="heldOn"
            defaultValue={values.heldOn}
            style={{ maxWidth: 220 }}
          />
        </label>
        <label className="field" style={{ marginTop: 20 }}>
          <span className="field-head">
            Transcript
            <span className="file-pick">
              <FileUp size={16} strokeWidth={1.75} />
              Choose a .txt file
              <input type="file" name="file" accept=".txt,text/plain" onChange={choose} />
            </span>
          </span>
          <textarea
            ref={source}
            className="text-input transcript-input"
            name="source"
            defaultValue={values.source}
            rows={12}
            spellCheck={false}
            placeholder={
              "[00:00:04] Dana Wu: Good morning, everyone.\n[00:00:21] Marcus Lindqvist: …"
            }
          />
        </label>
      </div>

      {state.kind === "error" ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "checked" ? <PlanCard state={state} /> : null}
      {state.kind === "checked" ? (
        <input type="hidden" name="checked" value={state.checked} />
      ) : null}

      <div className="actions">
        {/* First in the form, so Enter checks again and never spends. */}
        <button
          type="submit"
          name="intent"
          value="check"
          className="btn btn-quiet"
          disabled={pending}
          onClick={() => setIntent("check")}
        >
          {pending && intent === "check" ? "Checking" : ready ? "Check again" : "Check cost"}
        </button>
        {ready ? (
          <button
            type="submit"
            name="intent"
            value="add"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => setIntent("add")}
          >
            {pending && intent === "add" ? "Adding" : `Add meeting, ${ready.cost}`}
            {pending ? null : <ArrowRight size={16} strokeWidth={1.75} />}
          </button>
        ) : null}
      </div>
      {pending && intent === "add" ? (
        <p className="quiet" role="status" style={{ margin: 0 }}>
          Extracting decisions and action items, then indexing the transcript. This can take up to
          half a minute.
        </p>
      ) : null}
    </form>
  );
}

function PlanCard({ state }: { state: Extract<AddState, { kind: "checked" }> }) {
  const { plan } = state;
  if (plan.kind === "invalid") {
    return (
      <div className="plan withheld" role="alert">
        <TriangleAlert className="plan-icon" size={18} strokeWidth={1.75} />
        <div>
          <strong>This can't be added yet</strong>
          <ul>
            {plan.problems.map((p) => (
              <li key={`${p.line}:${p.message}`}>
                {p.line === null ? null : <span className="tabular">Line {p.line}: </span>}
                {p.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (plan.kind === "unchanged") {
    return (
      <div className="plan">
        <Info className="plan-icon" size={18} strokeWidth={1.75} />
        <div>
          <strong>Already stored as {plan.title}</strong>
          <p>
            Nothing to add or pay for.{" "}
            <Link className="text-link" href={`/meetings/${plan.id}`}>
              Open it
            </Link>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="plan ready" role="status">
      <Info className="plan-icon" size={18} strokeWidth={1.75} />
      <div>
        <strong>
          {plan.turns} turns, {plan.speakers} speakers
        </strong>
        <p>
          {plan.embedded
            ? `Already indexed. Extracting its decisions and action items costs ${plan.cost}.`
            : `Extracting its decisions and action items and indexing it for search costs ${plan.cost}, at most.`}
        </p>
        {state.notice ? <p className="notice-line">{state.notice}</p> : null}
      </div>
    </div>
  );
}
