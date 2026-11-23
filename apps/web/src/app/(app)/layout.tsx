import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand.tsx";
import { gate, requireSession } from "@/server/auth.ts";
import { signOut } from "../login/actions.ts";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const open = gate().mode === "open";
  return (
    <div className="shell">
      <header className="topbar">
        <div className="inner">
          <Wordmark />
          <div className="end">
            {open ? (
              <span className="quiet" title="Set MNEMON_ACCESS_CODE in .env to require a code">
                Sign-in off in development
              </span>
            ) : null}
            {open ? null : (
              <form action={signOut}>
                <button className="btn btn-ghost" type="submit">
                  <LogOut size={16} strokeWidth={1.75} />
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
