// pnpm records <meeting-id>
// A meeting's decisions, action items and topics, each with the turns it cites.
import { formatTimestamp, type MeetingRecord, type Turn } from "@mnemon/core";
import { connect } from "./wiring.ts";

const HEADINGS = { decision: "Decisions", action_item: "Action items", topic: "Topics" } as const;

const [meetingId] = process.argv.slice(2);
const { sql, store } = await connect();
try {
  if (!meetingId) {
    console.error("Usage: pnpm records <meeting-id>\n\nMeetings:");
    for (const m of await store.list()) console.error(`  ${m.id}  ${m.title}`);
    process.exitCode = 2;
  } else {
    const meeting = await store.get(meetingId);
    if (!meeting) {
      console.error(`No meeting ${meetingId}.`);
      process.exitCode = 1;
    } else if (meeting.recordsModel === null) {
      console.log(
        `"${meeting.title}" has no records yet. Ingest its transcript again to extract them.`,
      );
    } else {
      console.log(
        `"${meeting.title}": ${meeting.records.length} records, extracted by ${meeting.recordsModel}.`,
      );
      const turns = new Map(meeting.turns.map((t) => [t.index, t]));
      for (const kind of ["decision", "action_item", "topic"] as const) {
        const ofKind = meeting.records.filter((r) => r.kind === kind);
        if (ofKind.length === 0) continue;
        console.log(`\n${HEADINGS[kind]}`);
        for (const record of ofKind) print(record, turns);
      }
    }
  }
} finally {
  await sql.end();
}

function print(record: MeetingRecord, turns: ReadonlyMap<number, Turn>) {
  const who = [record.owner, record.due].filter(Boolean).join(", ");
  console.log(`  - ${record.summary}${who ? `  [${who}]` : ""}`);
  for (const c of record.citations) {
    const turn = turns.get(c.turnIndex);
    if (!turn) continue;
    console.log(
      `      [${formatTimestamp(turn.startSeconds)}] ${turn.speaker} (turn ${c.turnIndex}, ` +
        `lines ${turn.sourceLines.start}-${turn.sourceLines.end}): "${c.quote}"`,
    );
  }
}
