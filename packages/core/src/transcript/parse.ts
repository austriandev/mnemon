import type { ParseResult, Turn } from "./types.ts";

// A turn line: "[HH:MM:SS] Speaker: text" or "[MM:SS] Speaker: text".
const TURN_LINE = /^\[(?:(\d{2}):)?(\d{2}):(\d{2})\] (.*?): (.*)$/;

interface OpenTurn {
  speaker: string;
  startSeconds: number;
  textParts: string[];
  startLine: number;
  endLine: number;
}

export function parseTranscript(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const turns: Turn[] = [];
  let open: OpenTurn | undefined;

  const close = () => {
    if (!open) return;
    turns.push({
      index: turns.length,
      speaker: open.speaker,
      startSeconds: open.startSeconds,
      text: open.textParts.join(" "),
      sourceLines: { start: open.startLine, end: open.endLine },
    });
    open = undefined;
  };

  lines.forEach((rawLine, i) => {
    const lineNumber = i + 1;
    const line = rawLine.trim();
    if (line === "") return;

    const match = TURN_LINE.exec(line);
    if (match) {
      close();
      const [, hh = "0", mm = "0", ss = "0", speaker = "", text = ""] = match;
      open = {
        speaker,
        startSeconds: Number(hh) * 3600 + Number(mm) * 60 + Number(ss),
        textParts: [text.trim()],
        startLine: lineNumber,
        endLine: lineNumber,
      };
      return;
    }

    if (open) {
      open.textParts.push(line);
      open.endLine = lineNumber;
    }
  });
  close();

  return { ok: true, turns };
}
