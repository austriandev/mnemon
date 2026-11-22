import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The access gate for a deployed demo: one shared code (MNEMON_ACCESS_CODE), a signed
// session cookie, and nothing else. It keeps strangers from spending the API budget;
// it is not user management. Pure functions; the cookie handling lives in auth.ts.

export const SESSION_COOKIE = "mnemon_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type Gate =
  /** No code configured outside production: anyone may use the app. */
  | { readonly mode: "open" }
  /** No code configured in production: no one may. Fails closed. */
  | { readonly mode: "closed" }
  | { readonly mode: "code"; readonly code: string };

export function gateFrom(env: { MNEMON_ACCESS_CODE?: string; NODE_ENV?: string }): Gate {
  const code = env.MNEMON_ACCESS_CODE?.trim();
  if (code) return { mode: "code", code };
  return env.NODE_ENV === "production" ? { mode: "closed" } : { mode: "open" };
}

/** Constant-time: compares digests, so neither length nor content leaks through timing. */
export function checkCode(gate: Gate, attempt: string): boolean {
  if (gate.mode === "open") return true;
  if (gate.mode === "closed") return false;
  return timingSafeEqual(sha256(attempt), sha256(gate.code));
}

/** "<expiry>.<signature>": the expiry in seconds, signed with a key derived from the code. */
export function issueSession(gate: Gate, nowSeconds: number): string {
  const expiry = String(nowSeconds + SESSION_TTL_SECONDS);
  return `${expiry}.${sign(gate, expiry)}`;
}

export function verifySession(gate: Gate, token: string | undefined, nowSeconds: number): boolean {
  if (gate.mode === "open") return true;
  if (gate.mode === "closed" || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiry = "", signature = ""] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= nowSeconds) return false;
  const expected = Buffer.from(sign(gate, expiry));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sign(gate: Gate, expiry: string): string {
  const code = gate.mode === "code" ? gate.code : "";
  const key = sha256(`mnemon-session\0${code}`);
  return createHmac("sha256", key).update(expiry).digest("base64url");
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
