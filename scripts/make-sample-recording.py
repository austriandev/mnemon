#!/usr/bin/env python3
"""Builds the synthetic sample recording for "Try the sample recording" (ADR-0018).

macOS only: it speaks a fictional script with the system's `say` voices, one voice per
person, joins the lines with short pauses, and writes:

- apps/web/public/samples/bx17-line-huddle.m4a  the recording (AAC, mono, 32 kbps)
- packages/core/fixtures/audio/bx17-line-huddle.txt  the same meeting as a Mnemon
  transcript, with each turn's real start time: the reference a transcription is
  measured against.

Run from the repo root: python3 -I scripts/make-sample-recording.py
"""

import os
import subprocess
import tempfile
import wave

# Fictional people and product (CLAUDE.md: demo data is synthetic).
VOICES = {"Rui Almeida": "Daniel", "Dr. Grace Mensah": "Samantha", "Tomas Berg": "Rishi"}
SCRIPT = [
    ("Rui Almeida", "Good morning. This is the BX-17 blister line huddle for Tuesday."),
    ("Dr. Grace Mensah", "The sealer temperature drifted again overnight. It reached 190 degrees before the alarm went off."),
    ("Tomas Berg", "Maintenance replaced the thermocouple at six this morning. It has held at 180 degrees since."),
    ("Rui Almeida", "Did any blisters from the night shift fail the seal check?"),
    ("Dr. Grace Mensah", "Two trays failed. They are in quarantine, and I have opened a deviation."),
    ("Rui Almeida", "Then here is the decision. The line restarts at ten, with a seal check every thirty minutes for the rest of the week."),
    ("Tomas Berg", "I will log every reading in the batch record and send the summary to quality by Thursday."),
    ("Dr. Grace Mensah", "And I will close the deviation once the root cause report is in, by Friday."),
    ("Rui Almeida", "Thank you both. That is everything for today."),
]
RATE = 16_000
PAUSE_SECONDS = 0.7

ROOT = os.getcwd()
AUDIO_OUT = os.path.join(ROOT, "apps/web/public/samples/bx17-line-huddle.m4a")
TEXT_OUT = os.path.join(ROOT, "packages/core/fixtures/audio/bx17-line-huddle.txt")


def stamp(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main() -> None:
    os.makedirs(os.path.dirname(AUDIO_OUT), exist_ok=True)
    os.makedirs(os.path.dirname(TEXT_OUT), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        frames = b""
        lines = []
        silence = b"\x00\x00" * int(RATE * PAUSE_SECONDS)
        for i, (speaker, text) in enumerate(SCRIPT):
            aiff = os.path.join(tmp, f"{i}.aiff")
            wav = os.path.join(tmp, f"{i}.wav")
            subprocess.run(["say", "-v", VOICES[speaker], "-o", aiff, text], check=True)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", aiff, wav], check=True)
            with wave.open(wav, "rb") as w:
                lines.append(f"[{stamp(len(frames) / 2 / RATE)}] {speaker}: {text}")
                frames += w.readframes(w.getnframes()) + silence
        joined = os.path.join(tmp, "joined.wav")
        with wave.open(joined, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(frames)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "32000", joined, AUDIO_OUT], check=True)
    with open(TEXT_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    seconds = len(frames) / 2 / RATE
    print(f"{AUDIO_OUT}: {seconds:.1f} s, {os.path.getsize(AUDIO_OUT)} bytes")
    print(f"{TEXT_OUT}: {len(lines)} turns")


if __name__ == "__main__":
    main()
