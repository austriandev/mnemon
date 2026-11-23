import { formatTimestamp, type MeetingRecord, type RecordKind, type Turn } from "@mnemon/core";
import { ArrowLeft, Gavel, ListChecks, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth.ts";
import { mnemon } from "@/server/mnemon.ts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const GROUPS: { kind: RecordKind; title: string; icon: typeof Gavel }[] = [
  { kind: "decision", title: "Decisions", icon: Gavel },
  { kind: "action_item", title: "Action items", icon: ListChecks },
  { kind: "topic", title: "Topics", icon: MessagesSquare },
];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const meeting = await (await mnemon()).store.get((await params).id);
  return { title: meeting?.title ?? "Meeting" };
}

export default async function MeetingPage({ params }: Params) {
  await requireSession();
  const meeting = await (await mnemon()).store.get((await params).id);
  if (!meeting) notFound();

  const turns = new Map(meeting.turns.map((t) => [t.index, t]));
  const last = meeting.turns.at(-1);

  return (
    <main className="main" style={{ paddingTop: 40 }}>
      <div className="wrap">
        <Link href="/#meetings" className="back">
          <ArrowLeft size={16} strokeWidth={1.75} /> All meetings
        </Link>
        <h1 className="meeting-title">{meeting.title}</h1>
        <div className="meta meeting-meta tabular">
          <span>{meeting.turns.length} turns</span>
          {last ? <span>{formatTimestamp(last.startSeconds)} long</span> : null}
          <span>{new Set(meeting.turns.map((t) => t.speaker)).size} speakers</span>
          {meeting.recordsModel ? <span>Records by {meeting.recordsModel}</span> : null}
        </div>

        <div className="meeting-layout">
          <aside className="card records" aria-label="Records">
            {meeting.recordsModel === null ? (
              <p style={{ margin: 0, color: "var(--faint)" }}>
                No records yet. Ingest this transcript again to extract them.
              </p>
            ) : (
              GROUPS.map(({ kind, title, icon: Icon }) => {
                const ofKind = meeting.records.filter((r) => r.kind === kind);
                if (ofKind.length === 0) return null;
                return (
                  <section key={kind} className="record-group">
                    <h2>
                      <Icon size={16} strokeWidth={1.75} />
                      {title}
                      <span className="quiet">{ofKind.length}</span>
                    </h2>
                    {ofKind.map((r) => (
                      <RecordItem key={r.index} record={r} turns={turns} />
                    ))}
                  </section>
                );
              })
            )}
          </aside>

          <section className="card transcript" aria-label="Transcript">
            {meeting.turns.map((t) => (
              <div key={t.index} id={`turn-${t.index}`} className="turn">
                <time>{formatTimestamp(t.startSeconds)}</time>
                <div>
                  <div className="speaker">{t.speaker}</div>
                  <p>{t.text}</p>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}

function RecordItem({
  record,
  turns,
}: {
  record: MeetingRecord;
  turns: ReadonlyMap<number, Turn>;
}) {
  return (
    <div className="record">
      <p>{record.summary}</p>
      <div className="chips">
        {record.owner ? <span className="chip">{record.owner}</span> : null}
        {record.due ? <span className="chip">{record.due}</span> : null}
        {record.citations.map((c) => {
          const turn = turns.get(c.turnIndex);
          return (
            <a
              key={`${c.turnIndex}:${c.quote}`}
              className="chip tabular"
              href={`#turn-${c.turnIndex}`}
              title={`“${c.quote}”`}
            >
              {turn
                ? `${formatTimestamp(turn.startSeconds)} ${turn.speaker}`
                : `turn ${c.turnIndex}`}
            </a>
          );
        })}
      </div>
    </div>
  );
}
