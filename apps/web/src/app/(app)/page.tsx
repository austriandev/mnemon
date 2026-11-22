import { ArrowUpRight, FileText } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/server/auth.ts";
import { mnemon } from "@/server/mnemon.ts";
import { AskPanel } from "./ask-panel.tsx";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function HomePage() {
  await requireSession();
  const meetings = await (await mnemon()).store.list();

  return (
    <main className="main">
      <div className="aurora-light" />
      <div className="wrap" style={{ position: "relative" }}>
        <h1 className="page-title">
          Ask what your meetings <span className="tail">decided.</span>
        </h1>
        <p className="page-sub">
          Answers come from the transcripts. Every sentence cites who said it and when, and links to
          the moment in the meeting.
        </p>
        <AskPanel />

        <section className="section" id="meetings" aria-labelledby="meetings-title">
          <div className="section-head">
            <h2 id="meetings-title">Meetings</h2>
            <span className="pill quiet">{meetings.length} stored</span>
          </div>
          {meetings.length === 0 ? (
            <div className="card empty">
              No meetings yet. Ingest one with{" "}
              <code>pnpm ingest packages/core/fixtures/steering-committee.txt</code>.
            </div>
          ) : (
            <div className="meetings">
              {meetings.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card meeting-card">
                  <span className="icon">
                    <FileText size={18} strokeWidth={2.25} />
                  </span>
                  <h3>{m.title}</h3>
                  <div className="meta">
                    <span>{m.turnCount} turns</span>
                    <span>Added {dateFormat.format(m.createdAt)}</span>
                    <span style={{ marginLeft: "auto", color: "var(--green-600)" }}>
                      <ArrowUpRight size={16} strokeWidth={2.25} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
