import { describe, expect, it } from "vitest";
import { createAssemblyAiTranscriber, type TranscriptionUsage } from "../src/index.ts";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A fetch that answers like AssemblyAI's REST API: upload returns an upload_url,
 * submit returns an id, and each poll returns the next status in `statuses`.
 */
function fakeAssemblyAi(
  options: { statuses?: string[]; uploadStatus?: number; deleteStatus?: number } = {},
) {
  const calls: Call[] = [];
  const statuses = [...(options.statuses ?? ["queued", "processing", "completed"])];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body =
      init?.body instanceof Uint8Array
        ? `<${init.body.length} bytes>`
        : init?.body
          ? JSON.parse(String(init.body))
          : undefined;
    calls.push({
      method,
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body,
    });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (String(url).endsWith("/v2/upload")) {
      return options.uploadStatus
        ? json({ error: "Authentication error, API token missing/invalid" }, options.uploadStatus)
        : json({ upload_url: "https://cdn.assemblyai.example/upload/abc" });
    }
    if (method === "POST") return json({ id: "tr_123", status: "queued" });
    if (method === "DELETE") return json({ id: "tr_123" }, options.deleteStatus ?? 200);
    const status = statuses.shift() ?? "completed";
    if (status === "error") return json({ id: "tr_123", status, error: "Audio file is corrupted" });
    if (status !== "completed") return json({ id: "tr_123", status });
    return json({
      id: "tr_123",
      status,
      audio_duration: 1800,
      text: null,
      utterances: [
        {
          speaker: "A",
          start: 250,
          end: 4_100,
          text: "Good morning.",
          confidence: 0.98,
          words: [],
        },
        {
          speaker: "B",
          start: 4_900,
          end: 8_000,
          text: "The sealer is back.",
          confidence: 0.95,
          words: [],
        },
      ],
    });
  };
  return { fetch, calls };
}

const noWait = async () => {};
const AUDIO = new Uint8Array([1, 2, 3, 4]);

describe("createAssemblyAiTranscriber", () => {
  it("uploads the audio, asks for speaker labels, waits until done, and returns the utterances", async () => {
    const { fetch, calls } = fakeAssemblyAi();
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      sleep: noWait,
      onUsage: () => {},
    });

    const result = await transcriber.transcribe(AUDIO);

    expect(result).toEqual({
      utterances: [
        { speaker: "A", startMs: 250, text: "Good morning." },
        { speaker: "B", startMs: 4_900, text: "The sealer is back." },
      ],
      durationSeconds: 1800,
      model: "assemblyai-stt-3-7",
    });
    const [upload, submit] = calls;
    expect(upload).toMatchObject({
      method: "POST",
      url: "https://api.assemblyai.com/v2/upload",
      body: "<4 bytes>",
    });
    expect(upload?.headers).toMatchObject({
      authorization: "k",
      "content-type": "application/octet-stream",
    });
    expect(submit).toMatchObject({
      method: "POST",
      url: "https://api.assemblyai.com/v2/transcript",
      body: {
        audio_url: "https://cdn.assemblyai.example/upload/abc",
        speaker_labels: true,
        speech_models: ["assemblyai-stt-3-7"],
      },
    });
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(3);
  });

  it("reports what the recording cost: its length at the model's rate plus diarization", async () => {
    const usage: TranscriptionUsage[] = [];
    const { fetch } = fakeAssemblyAi();
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      sleep: noWait,
      onUsage: (u) => usage.push(u),
    });

    await transcriber.transcribe(AUDIO);

    // 30 minutes at $0.21 + $0.02 an hour.
    expect(usage).toEqual([
      { provider: "assemblyai", model: "assemblyai-stt-3-7", audioSeconds: 1800, costUsd: 0.115 },
    ]);
  });

  it("waits between polls instead of asking in a tight loop", async () => {
    const waits: number[] = [];
    const { fetch } = fakeAssemblyAi({
      statuses: ["queued", "processing", "processing", "completed"],
    });
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      pollIntervalMs: 2_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
      onUsage: () => {},
    });

    await transcriber.transcribe(AUDIO);

    expect(waits).toEqual([2_000, 2_000, 2_000]);
  });

  it("deletes the transcript from AssemblyAI once it has been read, and survives if that fails", async () => {
    const { fetch, calls } = fakeAssemblyAi({ deleteStatus: 500 });
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      sleep: noWait,
      onUsage: () => {},
    });

    const result = await transcriber.transcribe(AUDIO);

    expect(result.utterances).toHaveLength(2);
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://api.assemblyai.com/v2/transcript/tr_123",
    });
  });

  it("fails with AssemblyAI's reason when transcription fails", async () => {
    const { fetch } = fakeAssemblyAi({ statuses: ["processing", "error"] });
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      sleep: noWait,
      onUsage: () => {},
    });

    await expect(transcriber.transcribe(AUDIO)).rejects.toThrow(/Audio file is corrupted/);
  });

  it("fails with the HTTP status and message, without echoing the key", async () => {
    const { fetch } = fakeAssemblyAi({ uploadStatus: 401 });
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "secret-key-1",
      fetch,
      sleep: noWait,
      onUsage: () => {},
    });

    const error = await transcriber.transcribe(AUDIO).catch((e: Error) => e);

    expect(String(error)).toMatch(/401.*API token missing/);
    expect(String(error)).not.toMatch(/secret-key-1/);
  });

  it("gives up after its time limit rather than waiting forever", async () => {
    const { fetch } = fakeAssemblyAi({ statuses: Array(100).fill("processing") });
    let now = 0;
    const transcriber = createAssemblyAiTranscriber({
      apiKey: "k",
      fetch,
      pollIntervalMs: 3_000,
      timeoutMs: 10_000,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      onUsage: () => {},
    });

    await expect(transcriber.transcribe(AUDIO)).rejects.toThrow(/not finished after 10 s/);
  });

  it("refuses to start without an API key", () => {
    expect(() => createAssemblyAiTranscriber({ apiKey: "" })).toThrow(/MNEMON_ASSEMBLYAI_API_KEY/);
  });
});
