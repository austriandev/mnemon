import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gateFrom, SESSION_COOKIE, type Session, verifySession } from "./session.ts";

export const gate = () => gateFrom(process.env);
export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The visitor's session, with the access code they signed in with; null if none. */
export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(gate(), token, nowSeconds());
}

export async function isSignedIn(): Promise<boolean> {
  return (await currentSession()) !== null;
}

/**
 * Every page and server action behind the gate calls this. The proxy redirects early,
 * but a server action can be called directly, so the check also sits next to the data.
 * Returns the session, so paid calls can be charged to its access code.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}
