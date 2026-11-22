// pnpm ask "<question>" [--meeting <id>]
// Answers a question from the stored meetings. Every sentence cites the turns it rests
// on; an answer whose citations fail a check is not shown.
import { parseArgs } from "node:util";
import { type AnswerCitation, ask, type Excerpt, formatTimestamp } from "@mnemon/core";
import { connect } from "./wiring.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { meeting: { type: "string" } },
});
const question = positionals.join(" ");
if (!question.trim()) {
  console.error('Usage: pnpm ask "<question>" [--meeting <id>]');
  process.exit(2);
}

const { sql, search, embedder, store, languageModel } = await connect();
try {
  const { answer, retrieved, excerpts } = await ask(question, {
    embedder,
    search,
    transcripts: store,
    model: languageModel("medium"),
    ...(values.meeting ? { meetingId: values.meeting } : {}),
  });
  const shown = `${retrieved.length} chunks in ${excerpts.length} meeting(s)`;

  if (answer.status === "not_found") {
    console.log(`\nThe meetings don't say. Searched ${shown}.`);
  } else if (answer.status === "rejected") {
    console.log(
      `\nNo answer: the model's answer failed a citation check (${answer.reason}). ` +
        "It is not shown, because an unchecked answer can't be traced to the transcript.",
    );
    if (process.env.MNEMON_DEBUG) console.log(JSON.stringify(answer.output, null, 2));
    process.exitCode = 1;
  } else {
    // Number each distinct citation once, in order of first use.
    const sources = new Map<string, AnswerCitation>();
    const keyOf = (c: AnswerCitation) => `${c.meetingId}:${c.turnIndex}:${c.quote}`;
    console.log("");
    for (const sentence of answer.sentences) {
      const marks = sentence.citations.map((c) => {
        if (!sources.has(keyOf(c))) sources.set(keyOf(c), c);
        return `[${[...sources.keys()].indexOf(keyOf(c)) + 1}]`;
      });
      console.log(`${sentence.text} ${[...new Set(marks)].join("")}`);
    }
    if (answer.gaps) console.log(`\nNot covered: ${answer.gaps}`);
    console.log("\nSources");
    for (const [i, c] of [...sources.values()].entries())
      console.log(`  [${i + 1}] ${source(c, excerpts)}`);
    console.log(`\nAnswered by ${answer.model} from ${shown}.`);
  }
} finally {
  await sql.end();
}

function source(c: AnswerCitation, excerpts: readonly Excerpt[]): string {
  const excerpt = excerpts.find((e) => e.meetingId === c.meetingId);
  const turn = excerpt?.turns.find((t) => t.index === c.turnIndex);
  if (!excerpt || !turn) return `meeting ${c.meetingId}, turn ${c.turnIndex}: "${c.quote}"`;
  const { start, end } = turn.sourceLines;
  const lines = start === end ? `line ${start}` : `lines ${start}-${end}`;
  return (
    `${excerpt.title}, [${formatTimestamp(turn.startSeconds)}] ${turn.speaker} ` +
    `(turn ${c.turnIndex}, ${lines}): "${c.quote}"`
  );
}
