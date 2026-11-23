import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/auth.ts";
import { AddForm } from "./add-form.tsx";

export const metadata: Metadata = { title: "Add a meeting" };
export const dynamic = "force-dynamic";

export default async function NewMeetingPage() {
  await requireSession();
  return (
    <main className="main" style={{ paddingTop: 40 }}>
      <div className="wrap narrow">
        <Link href="/#meetings" className="back">
          <ArrowLeft size={16} strokeWidth={1.75} /> All meetings
        </Link>
        <h1 className="meeting-title">Add a meeting</h1>
        <p className="page-sub" style={{ fontSize: 16 }}>
          Paste a transcript or choose a .txt file, one turn per line:{" "}
          <code className="inline">[00:12:40] Speaker: what they said</code>. You see the cost
          before anything is paid for.
        </p>
        <AddForm />
      </div>
    </main>
  );
}
