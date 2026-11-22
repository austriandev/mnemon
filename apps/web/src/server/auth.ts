import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gateFrom, SESSION_COOKIE, verifySession } from "./session.ts";

export const gate = () => gateFrom(process.env);
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function isSignedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(gate(), token, nowSeconds());
}

/**
 * Every page and server action behind the gate calls this. The proxy redirects early,
 * but a server action can be called directly, so the check also sits next to the data.
 */
export async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");
}
