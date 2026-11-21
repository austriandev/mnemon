import type { ParseError, ParseResult, Turn } from "./types.ts";

// A line opens a turn when it starts with something bracketed that looks like a
// timestamp. Whether that timestamp is valid is checked separately, so a typo such
// as "[00:61:00]" is reported rather than read as text continuing the previous turn.
const TIMESTAMP_PREFIX = /^\[([\d:]+)\](.*)$/;
const TIMESTAMP = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)$/;
// The speaker is everything up to the first ": " (or a ":" that ends the line, when
// the text starts on the next line).
const SPEAKER_AND_TEXT = /^(.*?):(?:\s+(.*))?$/;

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
  let sawTurnLine = false;
  // The last valid timestamp seen, compared with the next one so each place the
  // clock goes backwards is reported once.
  let previousStamp: { seconds: number; text: string; line: number } | undefined;

  const reject = (code: ParseError["code"], line: number, message: string) => {
    errors.push({ code, line, message: `Line ${line}: ${message}` });
    open = "broken";
  };

  const close = () => {
    if (open && open !== "broken") {
      const text = open.textParts.filter((part) => part !== "").join(" ");
      if (text === "") {
        reject("empty-text", open.startLine, `the turn by "${open.speaker}" has no text.`);
      } else {
        turns.push({
          index: turns.length,
          speaker: open.speaker,
          startSeconds: open.startSeconds,
          text,
          sourceLines: { start: open.startLine, end: open.endLine },
        });
      }
    }
    open = undefined;
  };

  lines.forEach((rawLine, i) => {
    const lineNumber = i + 1;
    const line = rawLine.trim();
    if (line === "") return;

    const prefixed = TIMESTAMP_PREFIX.exec(line);
    if (prefixed) {
      sawTurnLine = true;
      close();
      const [, stamp = "", rest = ""] = prefixed;
      const time = TIMESTAMP.exec(stamp);
      if (!time) {
        reject(
          "invalid-timestamp",
          lineNumber,
          `"[${stamp}]" is not a valid [HH:MM:SS] or [MM:SS] timestamp.`,
        );
        return;
      }
      const [, hh = "0", mm = "0", ss = "0"] = time;
      const startSeconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
      const earlier = previousStamp;
      previousStamp = { seconds: startSeconds, text: stamp, line: lineNumber };
      if (earlier && startSeconds < earlier.seconds) {
        reject(
          "timestamp-backwards",
          lineNumber,
          `[${stamp}] is earlier than [${earlier.text}] on line ${earlier.line}.`,
        );
        return;
      }
      const parts = SPEAKER_AND_TEXT.exec(rest.trim());
      if (!parts) {
        reject("missing-speaker", lineNumber, `expected "Speaker: text" after the timestamp.`);
        return;
      }
      const [, rawSpeaker = "", text = ""] = parts;
      const speaker = rawSpeaker.trim();
      if (speaker === "") {
        reject("empty-speaker", lineNumber, "the speaker name is empty.");
        return;
      }
      open = {
        speaker,
        startSeconds,
        textParts: [text.trim()],
        startLine: lineNumber,
        endLine: lineNumber,
      };
      return;
    }

    if (open === undefined) {
      reject("orphan-line", lineNumber, "text appears before the first timestamped turn.");
    } else if (open !== "broken") {
      open.textParts.push(line);
      open.endLine = lineNumber;
    }
  });
  close();

  // With no line even trying to open a turn, "no turns" is the single cause: the
  // text it does contain is not reported as orphaned line by line.
  if (!sawTurnLine) {
    return {
      ok: false,
      errors: [{ code: "no-turns", line: null, message: "The transcript contains no turns." }],
    };
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, turns };
}
