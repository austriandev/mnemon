// pnpm search "<question>" [--meeting <id>] [--limit 5]
// Hybrid retrieval over stored meetings; shows why each chunk was retrieved.
import { parseArgs } from "node:util";
import { retrieve } from "@mnemon/core";
import { connect } from "./wiring.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { meeting: { type: "string" }, limit: { type: "string", default: "5" } },
});
const question = positionals.join(" ");
if (!question.trim()) {
  console.error('Usage: pnpm search "<question>" [--meeting <id>] [--limit 5]');
  process.exit(2);
}

const { sql, search, embedder } = await connect();
try {
  const { chunks } = await retrieve(question, {
    embedder,
    search,
    limit: Number(values.limit),
    ...(values.meeting ? { meetingId: values.meeting } : {}),
  });
  if (chunks.length === 0) console.log("No matching chunks.");
  for (const [i, hit] of chunks.entries()) {
    const { chunk } = hit;
    const lines = chunk.text.split("\n");
    console.log(
      `\n#${i + 1}  score ${hit.score.toFixed(4)}  keyword rank ${hit.keywordRank ?? "-"}  ` +
        `vector rank ${hit.vectorRank ?? "-"}\n` +
        `    meeting ${hit.meetingId}  chunk ${chunk.index}  ` +
        `turns ${chunk.turnRange.first}-${chunk.turnRange.last}  speakers: ${chunk.speakers.join(", ")}`,
    );
    for (const line of lines.slice(0, 3)) console.log(`    | ${line}`);
    if (lines.length > 3) console.log(`    | ... (${lines.length - 3} more turns)`);
  }
} finally {
  await sql.end();
}
