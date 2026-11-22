"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Info,
  Search,
  SearchX,
  ShieldExclamationPoint,
} from "lucide-react";
import { useActionState, useRef } from "react";
import type { AnswerView } from "@/server/present.ts";
import { type AskState, askQuestion } from "./actions.ts";

const SUGGESTIONS = [
  "Who is doing the vendor audit, and by when?",
  "What happened with the dose, and why?",
  "What did we decide about enrollment?",
];

export function AskPanel() {
  const [state, action, pending] = useActionState<AskState, FormData>(askQuestion, {
    kind: "idle",
  });
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const suggest = (question: string) => {
    if (!input.current || !form.current) return;
    input.current.value = question;
    form.current.requestSubmit();
  };

  return (
    <>
      <form ref={form} action={action} className="card ask" aria-label="Ask a question">
        <Search size={19} strokeWidth={2.25} />
        <input
          ref={input}
          name="question"
          placeholder="Ask about a decision, an owner, a deadline…"
          aria-label="Your question"
          maxLength={500}
          autoComplete="off"
          defaultValue={state.kind === "idle" ? "" : state.question}
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <span>{pending ? "Asking" : "Ask"}</span>
          <ArrowRight size={17} strokeWidth={2.25} />
        </button>
      </form>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="suggestion"
            onClick={() => suggest(s)}
            disabled={pending}
          >
            {s}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {pending ? (
          <div className="card answer thinking">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            Reading the transcripts
          </div>
        ) : state.kind === "answer" ? (
          <AnswerCard question={state.question} view={state.view} />
        ) : state.kind === "error" ? (
          <div className="card answer notice withheld">
            <span className="badge">
              <Info size={19} strokeWidth={2.25} />
            </span>
            <div>
              <h2>No answer this time</h2>
              <p>{state.message}</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function searched(view: AnswerView) {
  const { chunks, meetings } = view.searched;
  return `${chunks} ${chunks === 1 ? "passage" : "passages"} in ${meetings} ${meetings === 1 ? "meeting" : "meetings"}`;
}

function AnswerCard({ question, view }: { question: string; view: AnswerView }) {
  if (view.status === "not_found") {
    return (
      <div className="card answer notice">
        <span className="badge">
          <SearchX size={19} strokeWidth={2.25} />
        </span>
        <div>
          <h2>The meetings don't say.</h2>
          <p>
            Searched {searched(view)}. Nothing in them answers “{question}”, so Mnemon won't guess.
          </p>
        </div>
      </div>
    );
  }
  if (view.status === "rejected") {
    return (
      <div className="card answer notice withheld">
        <span className="badge">
          <ShieldExclamationPoint size={19} strokeWidth={2.25} />
        </span>
        <div>
          <h2>No answer shown.</h2>
          <p>
            The answer failed a citation check ({view.reason}). Mnemon withholds answers it can't
            trace to the transcript.
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="card answer">
      <div className="answer-head">
        <h2 className="answer-question">{question}</h2>
        <span className="pill">Cited from {searched(view)}</span>
        {view.model ? <span className="pill quiet">{view.model}</span> : null}
      </div>
      <div className="sentences">
        {view.sentences.map((s) => (
          <p key={s.text}>
            {s.text}
            {s.sources.map((n) => (
              <a key={n} className="cite" href={`#source-${n}`} aria-label={`Source ${n}`}>
                {n}
              </a>
            ))}
          </p>
        ))}
      </div>
      {view.gaps ? (
        <div className="gaps">
          <Info size={16} strokeWidth={2.25} />
          <span>
            <strong>Not covered.</strong> {view.gaps}
          </span>
        </div>
      ) : null}
      <section className="sources" aria-label="Sources">
        <h3>Sources</h3>
        {view.sources.map((src) => (
          <div className="source" id={`source-${src.n}`} key={src.n}>
            <span className="num">{src.n}</span>
            <div>
              <p className="quote">“{src.quote}”</p>
              <div className="meta">
                <span className="tabular">{src.time}</span>
                <strong>{src.speaker}</strong>
                <span>{src.meetingTitle}</span>
                <span>
                  turn {src.turnIndex}, {src.lines}
                </span>
                <a className="text-link" href={src.href}>
                  Open in transcript <ArrowUpRight size={14} strokeWidth={2.25} />
                </a>
              </div>
            </div>
          </div>
        ))}
      </section>
    </article>
  );
}
