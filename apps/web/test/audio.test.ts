import { describe, expect, it } from "vitest";
import { estimateTranscriptionUsd, MAX_AUDIO_BYTES, readAudio } from "../src/server/audio.ts";

const form = (file?: File) => {
  const f = new FormData();
  if (file) f.set("audio", file);
  return f;
};
const audioFile = (bytes: number, type: string, name = "clip.webm") =>
  new File([new Uint8Array(bytes)], name, { type });

describe("readAudio", () => {
  it("takes a recording from the browser or an audio file, as bytes", async () => {
    for (const type of [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/mpeg",
      "audio/x-m4a",
      "video/webm",
    ]) {
      const read = await readAudio(form(audioFile(1_000, type)));
      expect(read.ok && read.bytes.length, type).toBe(1_000);
    }
  });

  it("says what's wrong with a missing, empty, oversize or non-audio file", async () => {
    expect(await readAudio(form())).toEqual({
      ok: false,
      message: "Record something or choose an audio file.",
    });
    expect(await readAudio(form(audioFile(0, "audio/webm")))).toEqual({
      ok: false,
      message: "Record something or choose an audio file.",
    });
    expect(await readAudio(form(audioFile(MAX_AUDIO_BYTES + 1, "audio/mpeg")))).toEqual({
      ok: false,
      message:
        "The recording is over 4 MB, the most the server accepts. Record up to about 15 minutes in the browser, or trim the file.",
    });
    expect(await readAudio(form(audioFile(1_000, "text/plain", "notes.txt")))).toEqual({
      ok: false,
      message: "That isn't an audio file. Choose a recording, such as .m4a, .mp3 or .webm.",
    });
  });
});

describe("estimateTranscriptionUsd", () => {
  it("prices the longest recording the file could hold, so the check before paying never undercounts", () => {
    // 4 MB at 16 kbps, the lowest bitrate a voice recording uses: ~35 minutes at $0.23/h.
    expect(estimateTranscriptionUsd(4 * 1024 * 1024)).toBeCloseTo(0.134, 3);
    expect(estimateTranscriptionUsd(60_000)).toBeCloseTo(0.0019, 4);
  });
});
