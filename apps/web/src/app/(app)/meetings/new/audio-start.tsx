"use client";

import { toTranscript, type Utterance } from "@mnemon/core";
import { AudioLines, FileAudio, Mic, Square, TriangleAlert } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { type TranscribeResult, transcribeAudio } from "./transcribe.ts";

/** About 15 minutes at the recorder's 32 kbps stays under the server's 4 MB (ADR-0018). */
const MAX_RECORDING_SECONDS = 15 * 60;
const SAMPLE = { url: "/samples/bx17-line-huddle.m4a", title: "BX-17 line huddle (recording)" };

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "recording"; readonly seconds: number }
  | { readonly kind: "transcribing" }
  | Extract<TranscribeResult, { kind: "transcribed" }>
  | { readonly kind: "error"; readonly message: string };

/**
 * Start a meeting from a recording: record in the browser, or choose an audio file.
 * The transcript comes back with speakers as "Speaker A", "Speaker B"; naming them
 * rewrites the transcript box, and the meeting is then checked and added as usual.
 */
export function AudioStart({
  onTranscript,
  onTitle,
}: {
  onTranscript: (text: string) => void;
  onTitle: (title: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [names, setNames] = useState<Record<string, string>>({});
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Leaving the page mid-recording stops the clock.
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  async function send(file: File) {
    setState({ kind: "transcribing" });
    setNames({});
    const form = new FormData();
    form.set("audio", file);
    const result = await transcribeAudio(form);
    setState(result);
    if (result.kind === "transcribed") onTranscript(toTranscript(result.utterances));
  }

  async function record() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ kind: "error", message: "The browser wasn't allowed to use the microphone." });
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const rec = new MediaRecorder(stream, {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stopTimer();
      for (const track of stream.getTracks()) track.stop();
      const blobType = rec.mimeType || "audio/webm";
      const ext = blobType.includes("mp4") ? "m4a" : "webm";
      void send(new File(chunks, `recording.${ext}`, { type: blobType }));
    };
    recorder.current = rec;
    rec.start();
    setState({ kind: "recording", seconds: 0 });
    timer.current = setInterval(() => {
      setState((s) => {
        if (s.kind !== "recording") return s;
        if (s.seconds + 1 >= MAX_RECORDING_SECONDS) rec.stop();
        return { kind: "recording", seconds: s.seconds + 1 };
      });
    }, 1000);
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await send(file);
  }

  async function trySample() {
    setState({ kind: "transcribing" });
    const response = await fetch(SAMPLE.url);
    const blob = await response.blob();
    onTitle(SAMPLE.title);
    await send(new File([blob], "bx17-line-huddle.m4a", { type: "audio/mp4" }));
  }

  function rename(utterances: readonly Utterance[], label: string, name: string) {
    const next = { ...names, [label]: name };
    setNames(next);
    onTranscript(toTranscript(utterances, next));
  }

  const busy = state.kind === "recording" || state.kind === "transcribing";
  return (
    <section className="audio-start" aria-label="Start from a recording">
      <div className="audio-head">
        <AudioLines size={18} strokeWidth={1.75} className="plan-icon" />
        <div>
          <strong>Start from a recording</strong>
          <p className="quiet">
            Record the meeting here, or choose an audio file up to 4 MB (about 15 minutes). It's
            transcribed with each speaker told apart; you name them, then check and add as usual.
          </p>
        </div>
      </div>
      <div className="audio-actions">
        {state.kind === "recording" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => recorder.current?.stop()}
          >
            <Square size={14} strokeWidth={2} /> Stop and transcribe · {clock(state.seconds)}
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={record}>
            <Mic size={16} strokeWidth={1.75} /> Record
          </button>
        )}
        <label className={`btn btn-quiet file-pick${busy ? " disabled" : ""}`}>
          <FileAudio size={16} strokeWidth={1.75} /> Choose audio file
          <input
            type="file"
            accept="audio/*,video/webm,video/mp4"
            onChange={choose}
            disabled={busy}
          />
        </label>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={trySample}>
          Try the sample recording
        </button>
      </div>

      {state.kind === "transcribing" ? (
        <p className="quiet" role="status">
          Transcribing and telling the speakers apart. A few minutes of audio takes about half a
          minute.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="form-error" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} /> {state.message}
        </p>
      ) : null}
      {state.kind === "transcribed" ? (
        <div className="speakers">
          <p className="quiet" role="status">
            Transcribed {clock(state.durationSeconds)} of audio into the transcript below. Name each
            speaker; the transcript updates as you type.
          </p>
          {state.speakers.map((s) => (
            <label key={s.label} className="speaker-row">
              <span className="speaker-label">Speaker {s.label}</span>
              <input
                className="text-input"
                value={names[s.label] ?? ""}
                placeholder={`Speaker ${s.label}`}
                onChange={(e) => rename(state.utterances, s.label, e.target.value)}
                autoComplete="off"
              />
              <span className="speaker-first quiet">“{s.firstWords}”</span>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function clock(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
