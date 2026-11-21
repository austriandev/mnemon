---
status: accepted
---

# Plain-text transcript format, rejected rather than repaired

The first input format is plain text, one turn per timestamped line:

```
[00:12:40] Dr. Elena Ortiz: We should hold the dose at 20 mg until the
safety review comes back.
[00:12:58] Priya Nair: Agreed. I'll take the vendor audit.
```

- A timestamp is `[HH:MM:SS]` or `[MM:SS]`, two digits per field, minutes and
  seconds 00–59. Both forms may appear in one file.
- The speaker is everything after the timestamp up to the first `: `. A `:` that
  ends the line also works, with the text starting on the next line.
- A line without a timestamp continues the previous turn; the parts are joined
  with single spaces. Blank lines are ignored. CRLF line endings are accepted.

WebVTT and other formats come later. Each one gets its own parser returning the
same `ParseResult`, so nothing downstream changes.

**Malformed input is never repaired.** Mnemon's users work in regulated settings
where every answer must trace to who said what and when. A guessed speaker or a
reordered timestamp would make a citation wrong without anyone noticing. So
`parseTranscript` returns `{ ok: false, errors }` and does not throw. Each error
has a code, a 1-based line number and a message, and all errors in the file are
reported at once, so a reviewer can fix them in one pass. The codes:

- `invalid-timestamp`: a line starts with a bracketed run of digits and colons
  that isn't a valid timestamp. It is reported, not read as text continuing the
  previous turn.
- `missing-speaker`: no `: ` after the timestamp.
- `empty-speaker`
- `empty-text`
- `orphan-line`: text before the first turn.
- `timestamp-backwards`: earlier than the previous turn line; equal is allowed.
- `no-turns`: no line opens a turn at all. When this happens it is the only error.

Lines that continue a rejected turn line are absorbed. They are not reported
again, and they are never attached to an earlier, valid turn.

## Consequences

- A continuation line that happens to start with something like `[2]` is read as
  a bad timestamp. That strictness is deliberate: a false rejection is visible,
  while a false acceptance is not.
- `[MM:SS]` caps at 59:59. Longer meetings must use `[HH:MM:SS]`.
- A transcript with any error yields no turns. Partial ingest isn't offered.
