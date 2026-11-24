---
status: accepted
---

# Voice to transcript: AssemblyAI with speaker labels, named by a person, then the usual flow

## Context

A meeting could only be added as a text transcript. The brief's optional bonus is
voice-to-transcript. Mnemon's whole design rests on turns with a speaker and a time
(ADR-0002), so a recording is only useful if the speakers are told apart. Claude doesn't
take audio, so this needs a speech-to-text service.

## Decision

- **AssemblyAI, pre-recorded, with speaker labels** (`speaker_labels: true`). It returns
  utterances labelled "A", "B", … with start times in milliseconds, which map directly
  onto `[HH:MM:SS] Speaker: text`. $0.21 an hour of audio plus $0.02 for speaker labels,
  at list price (pricing page dated 2026-11-10); new accounts get $50 of credit.
- **A `Transcriber` port in the core**, and `toTranscript` writing utterances as a Mnemon
  transcript. A test proves the parser reads the output back unchanged; names a person
  types can't break the format (colons and line breaks are taken out; blank falls back
  to "Speaker A"). `@mnemon/assemblyai` is the adapter: plain `fetch`, like Voyage.
- **A person names the speakers.** The service can tell voices apart but not who they
  are. The browser shows each label with its first words; naming one rewrites the
  transcript box. Nothing is stored at this step: the meeting is then checked and added
  exactly like a pasted transcript, so extraction, citations and limits are unchanged.
- **Record in the browser, choose a file, or try the synthetic sample.** The sample is
  macOS voices reading a fictional script (`scripts/make-sample-recording.py`); its
  script with real turn times is the reference for the eval.
- **Money:** before paying, the spending limit is checked against an upper estimate from
  the file's size at 16 kbps, the lowest voice bitrate, since the browser's reported
  duration can't be trusted. The real cost, from the audio's length, is recorded under
  the access code (migration 0010).
- **Data:** the transcript is deleted from AssemblyAI once read (best effort, logged if
  it fails). The audio is never stored by Mnemon.
- **Size:** recordings go through a server action, under Vercel's 4.5 MB request limit:
  4 MB a file, about 15 minutes at the recorder's 32 kbps.

## Eval

`pnpm eval:transcription`, the 50-second sample (3 voices, 9 turns), word error rate
after normalising case, punctuation and spelled numbers, and turns attributed to the
right person (run `transcription-2026-11-24-12-10-16`, $0.0056):

| Model | Word error rate | Speakers found | Turns attributed right | Cost (50 s) | Time |
| --- | --- | --- | --- | --- | --- |
| **assemblyai-stt-3-7** | **0.8%** | **3/3** | **9/9** | $0.0032 | 6.2 s |
| universal-2 | 1.6% | 3/3 | 9/9 | $0.0024 | 5.1 s |

`assemblyai-stt-3-7` stays the default: it wrote the product code as "BX-17" where
universal-2 wrote "BX17", and exact codes matter here (keyword search, and answers keep
codes as said). Its one error was "ten" written "10:00".

End to end on a production build: the sample transcribed in 6.9 s; named, checked and
added (9 turns, 3 speakers) in 6.1 s; asked "When does the BX-17 blister line restart,
and who sends the summary to quality?", the answer named Rui Almeida's decision and
Tomas Berg's action, each cited. $0.042 in all, transcription $0.0032 of it. No
transcript was left undeleted.

## Consequences

- One more sub-processor for audio: for a real client, AssemblyAI's data terms (and
  region) join Anthropic's and Voyage's.
- **The eval is the easy case.** Clean synthetic voices, no crosstalk, no room noise.
  *Hypothesis:* real meetings score worse on both words and speakers; a few real
  recordings with hand-checked transcripts are the next eval to add.
- Recordings over 4 MB are refused with a message; long meetings need the next step
  below.
- Without `MNEMON_ASSEMBLYAI_API_KEY` the panel says recordings aren't set up; pasting
  transcripts works as before.

## Considered options

- **Browser upload straight to storage (Vercel Blob), then a signed URL to AssemblyAI.**
  Removes the 4 MB limit; needs a store, a token endpoint and cleanup. The next step for
  full-length meetings.
- **A local model (Whisper) in the container.** Audio never leaves the deployment, a
  strong argument for regulated clients; but no speaker separation without another
  model, and a much heavier image.
- **Deepgram, ElevenLabs Scribe and others.** Comparable features; AssemblyAI had the
  lowest listed price with speaker labels among the established services, free credit,
  and a simple REST flow.
- **Live transcription while the meeting runs.** Streaming is priced higher and needs a
  socket per meeting; recording first fits how meetings are added today.
