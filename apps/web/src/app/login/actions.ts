"use server";

import { setTimeout as sleep } from "node:timers/promises";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gate, nowSeconds } from "@/server/auth.ts";
import { checkCode, issueSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/session.ts";

export interface SignInState {
  readonly error: string | null;
}

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const current = gate();
  if (current.mode === "open") redirect("/");
  if (current.mode === "closed") {
    // The reason names the setting at fault, never a code; it goes to the server log.
    console.error(JSON.stringify({ event: "sign_in_unconfigured", reason: current.reason }));
    return { error: "Sign-in is not configured on this server." };
  }
  const accessCode = checkCode(current, String(form.get("code") ?? ""));
  if (!accessCode) {
    // A short, fixed pause makes guessing slow without telling a guesser anything.
    await sleep(600);
    return { error: "That code isn't right. Check it and try again." };
  }
  (await cookies()).set(SESSION_COOKIE, issueSession(accessCode, nowSeconds()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
