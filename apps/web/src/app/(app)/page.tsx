import { ArrowUpRight, Plus } from "lucide-react";
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
      <div className="wrap">
        <h1 className="page-title">
          Ask what your meetings <span className="tail">decided</span>
        </h1>
        <p className="page-sub">
          Answers come from the transcripts. Every sentence cites who said it and when, and links to
          the moment in the meeting.
        </p>
        <AskPanel />

        <section className="section" id="meetings" aria-labelledby="meetings-title">
          <div className="section-head">
            <h2 id="meetings-title">
              Meetings <span className="quiet">{meetings.length}</span>
            </h2>
            <Link href="/meetings/new" className="btn btn-quiet btn-sm">
              <Plus size={16} strokeWidth={1.75} />
              Add a meeting
            </Link>
          </div>
          {meetings.length === 0 ? (
            <div className="card empty">
              No meetings yet. <Link href="/meetings/new">Add one</Link>, or load the demo meetings
              with <code>pnpm seed --yes</code>.
            </div>
          ) : (
            <div className="meetings">
              {meetings.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card meeting-card">
                  <h3>{m.title}</h3>
                  <div className="meta">
                    <span className="tabular">{m.turnCount} turns</span>
                    <span className="tabular">
                      {m.heldOn
                        ? `Held ${dateFormat.format(new Date(`${m.heldOn}T12:00:00`))}`
                        : `Added ${dateFormat.format(m.createdAt)}`}
                    </span>
                    <ArrowUpRight className="go" size={16} strokeWidth={1.75} aria-hidden="true" />
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
