import { ListChecks, MessageSquareQuote, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Aurora } from "@/components/aurora.tsx";
import { Wordmark } from "@/components/brand.tsx";
import { gate, isSignedIn } from "@/server/auth.ts";
import { LoginForm } from "./login-form.tsx";

export const metadata: Metadata = { title: "Sign in" };
// The gate is read from the environment per request; never prerender it at build time.
export const dynamic = "force-dynamic";

const POINTS = [
  { icon: MessageSquareQuote, text: "Every answer cites the speaker and the minute" },
  { icon: ListChecks, text: "Decisions and action items, pulled from each meeting" },
  { icon: ShieldCheck, text: "Nothing shown that the transcript doesn't say" },
];

export default async function LoginPage() {
  const mode = gate().mode;
  if (mode !== "closed" && (await isSignedIn())) redirect("/");

  return (
    <main className="login">
      <section className="login-hero">
        <Aurora />
        <h2 className="hero-title">
          Every answer, <span className="tail">traced to who said it</span>
        </h2>
        <p className="hero-sub">
          Ask what your meetings decided and who owns what. Mnemon answers from the transcript and
          cites the moment it came from.
        </p>
        <ul className="points">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <section className="login-side">
        <Wordmark href="/login" />
        <div className="center">
          <LoginForm closed={mode === "closed"} />
        </div>
        <div className="foot">
          <span>© 2026 Mnemon</span>
          <span>Demo data is synthetic: fictional companies, people and products</span>
        </div>
      </section>
    </main>
  );
}
