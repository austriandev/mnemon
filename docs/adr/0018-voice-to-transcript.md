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
- **Record in the browser, choose a file, or try the synthetic sample.** The sample is a
  fictional 77-second huddle spoken by three ElevenLabs voices (`eleven_v4`, pre-made
  voices) in a small-room acoustic, each at a different distance from the microphone,
  with hesitations, a laugh, uneven pauses, two lines spoken over the one before, and a
  room hum under it all (`pnpm sample:recording`, `scripts/make-sample-recording.ts`,
  901 ElevenLabs characters). It writes the reference transcript with each line at the
  moment it starts in the audio, which is what the eval scores against. It replaced a
  first sample of macOS system voices that sounded plainly synthetic.
- **Money:** before paying, the spending limit is checked against an upper estimate from
  the file's size at 16 kbps, the lowest voice bitrate, since the browser's reported
  duration can't be trusted. The real cost, from the audio's length, is recorded under
  the access code (migration 0010).
- **Data:** the transcript is deleted from AssemblyAI once read (best effort, logged if
  it fails). The audio is never stored by Mnemon.
- **Size:** recordings go through a server action, under Vercel's 4.5 MB request limit:
  4 MB a file, about 15 minutes at the recorder's 32 kbps.

## Eval

`pnpm eval:transcription` on the sample (77 s, 3 voices, 12 turns): word error rate after
normalising case, punctuation and spelled numbers, with fillers ("uh", "um") and stage
cues ("[laughs]") left out, since transcription drops them by design; turns attributed
to the right person, each utterance matched to the reference line it says; and how far
start times are off (run `transcription-2026-11-24-12-49-58`, $0.0085):

| Model | Word error rate | Speakers found | Turns attributed right | Start times off by | Cost (77 s) | Time |
| --- | --- | --- | --- | --- | --- | --- |
| **assemblyai-stt-3-7** | **1.8%** | **3/3** | **12/12** | 0.8 s | $0.0049 | 10.6 s |
| universal-2 | 1.8% | 3/3 | 12/12 | 0.5 s | $0.0036 | 5.4 s |

`assemblyai-stt-3-7` stays the default. On words and speakers the two tie; universal-2
is cheaper, twice as fast and closer on timing, but wrote the product code "BX17" for
"BX-17" and heard "blister lime" for "blister line". Exact codes matter here (keyword
search; answers keep codes as said); a start a second early doesn't, since citations
point at turns. stt-3-7's errors: "Blisterline" as one word, "ten" as "10:00".

The first run on this sample (`transcription-2026-11-24-12-48-52`) scored stt-3-7 at
8/12 turns: the scorer then decided who spoke by time alone, and stt-3-7's starts run a
second or two early, so they landed on the line before. Every name in its transcript
was right. The scorer now matches by the words said and reports timing on its own; the
earlier, cleaner sample of macOS voices gave 0.8% and 1.6%, 9/9 each (run
`transcription-2026-11-24-12-10-16`).

End to end on a production build, with this sample: transcribed in 10.4 s (3 speakers);
named, checked and added (12 turns) in 5.9 s; asked "When does the BX-17 blister line
restart, and who sends the summary to quality?", the answer named Rui Almeida's
decision and Tomas Berg's action, each cited. $0.046 in all. No transcript was left
undeleted at AssemblyAI.

## Consequences

- One more sub-processor for audio: for a real client, AssemblyAI's data terms (and
  region) join Anthropic's and Voyage's.
- **The eval is still a kind case.** Natural voices with room sound and some overlap,
  but one microphone, three speakers, little crosstalk and no accents far from the
  model's training. *Hypothesis:* real meetings score worse on words and speakers; a few
  real recordings with hand-checked transcripts are the next eval to add.
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
