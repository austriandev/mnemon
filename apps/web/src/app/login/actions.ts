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
  if (current.mode === "closed") {
    return { error: "Sign-in is not configured on this server. Set MNEMON_ACCESS_CODE." };
  }
  const code = String(form.get("code") ?? "");
  if (!checkCode(current, code)) {
    // A short, fixed pause makes guessing slow without telling a guesser anything.
    await sleep(600);
    return { error: "That code isn't right. Check it and try again." };
  }
  (await cookies()).set(SESSION_COOKIE, issueSession(current, nowSeconds()), {
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
