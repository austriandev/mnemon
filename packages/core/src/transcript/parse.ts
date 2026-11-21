import type { ParseError, ParseResult, Turn } from "./types.ts";

// A line opens a turn when it starts with something bracketed that looks like a
// timestamp. Whether that timestamp is valid is checked separately, so a typo such
// as "[00:61:00]" is reported rather than read as text continuing the previous turn.
const TIMESTAMP_PREFIX = /^\[([\d:]+)\](.*)$/;
const TIMESTAMP = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)$/;
const SPEAKER_AND_TEXT = /^(.*?): (.*)$/;

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
  const errors: ParseError[] = [];
  // "broken" means the current turn line was rejected: lines continuing it are
  // absorbed so they are neither reported again nor attached to an earlier turn.
  let open: OpenTurn | "broken" | undefined;

  const close = () => {
    if (open && open !== "broken") {
      turns.push({
        index: turns.length,
        speaker: open.speaker,
        startSeconds: open.startSeconds,
        text: open.textParts.join(" "),
        sourceLines: { start: open.startLine, end: open.endLine },
      });
    }
    open = undefined;
  };

  lines.forEach((rawLine, i) => {
    const lineNumber = i + 1;
    const line = rawLine.trim();
    if (line === "") return;

    const prefixed = TIMESTAMP_PREFIX.exec(line);
    if (prefixed) {
      close();
      const [, stamp = "", rest = ""] = prefixed;
      const time = TIMESTAMP.exec(stamp);
      if (!time) {
        errors.push({
          code: "invalid-timestamp",
          line: lineNumber,
          message: `Line ${lineNumber}: "[${stamp}]" is not a valid [HH:MM:SS] or [MM:SS] timestamp.`,
        });
        open = "broken";
        return;
      }
      const [, hh = "0", mm = "0", ss = "0"] = time;
      const parts = SPEAKER_AND_TEXT.exec(rest.trim());
      const [, speaker = "", text = ""] = parts ?? [];
      open = {
        speaker: speaker.trim(),
        startSeconds: Number(hh) * 3600 + Number(mm) * 60 + Number(ss),
        textParts: [text.trim()],
        startLine: lineNumber,
        endLine: lineNumber,
      };
      return;
    }

    if (open && open !== "broken") {
      open.textParts.push(line);
      open.endLine = lineNumber;
    }
  });
  close();

  return errors.length > 0 ? { ok: false, errors } : { ok: true, turns };
}
