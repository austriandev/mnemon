import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The access gate: named access codes (MNEMON_ACCESS_CODES), a signed session cookie that
// remembers which code signed in, and nothing else. It keeps strangers from spending the
// API budget and gives each code its own daily limit; it is not user management. Pure
// functions; the cookie handling lives in auth.ts.

export const SESSION_COOKIE = "mnemon_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_CODE_DAILY_LIMIT_USD = 2;

/** One access code: who it was given to, the code itself, and its own daily limit. */
export interface AccessCode {
  /** Lowercase letters, digits and dashes: it goes in the cookie and the spend ledger. */
  readonly name: string;
  readonly code: string;
  /** Null: held only to the day's limit, which all codes share. */
  readonly dailyLimitUsd: number | null;
}

export type Gate =
  /** No code configured outside production: anyone may use the app. */
  | { readonly mode: "open" }
  /** No usable code in production: no one may. Fails closed, saying why. */
  | { readonly mode: "closed"; readonly reason: string }
  | { readonly mode: "codes"; readonly codes: readonly AccessCode[] };

/** A signed-in visitor: the code they signed in with, or none through an open gate. */
export interface Session {
  readonly accessCode: AccessCode | null;
}

interface GateEnv {
  /** "name:code[:dailyLimitUsd]" entries, separated by commas or new lines. */
  MNEMON_ACCESS_CODES?: string;
  /** One shared code, named "shared", with no limit of its own. */
  MNEMON_ACCESS_CODE?: string;
  /** Each listed code's daily limit when its entry gives none; $2 by default. */
  MNEMON_CODE_DAILY_LIMIT_USD?: string;
  NODE_ENV?: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MIN_CODE_LENGTH = 8;

export function gateFrom(env: GateEnv): Gate {
  const codes: AccessCode[] = [];
  const shared = env.MNEMON_ACCESS_CODE?.trim();
  if (shared) codes.push({ name: "shared", code: shared, dailyLimitUsd: null });

  const listed = parseCodes(env.MNEMON_ACCESS_CODES ?? "", env.MNEMON_CODE_DAILY_LIMIT_USD);
  if (typeof listed === "string") return { mode: "closed", reason: listed };
  for (const entry of listed) {
    if (codes.some((c) => c.name === entry.name || c.code === entry.code)) {
      return {
        mode: "closed",
        reason: `MNEMON_ACCESS_CODES: "${entry.name}" repeats a name or a code already in use.`,
      };
    }
    codes.push(entry);
  }

  if (codes.length > 0) return { mode: "codes", codes };
  return env.NODE_ENV === "production"
    ? {
        mode: "closed",
        reason: "No access code is set: MNEMON_ACCESS_CODES or MNEMON_ACCESS_CODE.",
      }
    : { mode: "open" };
}

/** The listed codes, or why the list can't be used. A reason never contains a code. */
function parseCodes(list: string, defaultLimit: string | undefined): AccessCode[] | string {
  const fallback = defaultLimit?.trim() ? Number(defaultLimit) : DEFAULT_CODE_DAILY_LIMIT_USD;
  if (!isUsd(fallback)) {
    return "MNEMON_CODE_DAILY_LIMIT_USD must be a number of dollars, 0 or more.";
  }
  const codes: AccessCode[] = [];
  const entries = list
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
  for (const [i, entry] of entries.entries()) {
    const [name = "", code = "", limit, ...extra] = entry.split(":").map((p) => p.trim());
    const where = `MNEMON_ACCESS_CODES entry ${i + 1}`;
    if (!NAME.test(name)) {
      return `${where}: the name must be lowercase letters, digits and dashes, before a colon.`;
    }
    if (code.length < MIN_CODE_LENGTH || extra.length > 0) {
      return `${where} ("${name}"): give it as name:code[:dollars], the code ${MIN_CODE_LENGTH} characters or more.`;
    }
    const dailyLimitUsd = limit === undefined ? fallback : Number(limit);
    if (!isUsd(dailyLimitUsd)) {
      return `${where} ("${name}"): the daily limit must be a number of dollars.`;
    }
    if (codes.some((c) => c.name === name || c.code === code)) {
      return `MNEMON_ACCESS_CODES: "${name}" repeats a name or a code already in use.`;
    }
    codes.push({ name, code, dailyLimitUsd });
  }
  return codes;
}

const isUsd = (n: number) => Number.isFinite(n) && n >= 0;

/**
 * The code that was entered, or null. Compares digests in constant time against every
 * code, without stopping at a match, so timing says nothing about which code or how long.
 */
export function checkCode(gate: Gate, attempt: string): AccessCode | null {
  if (gate.mode !== "codes") return null;
  const given = sha256(attempt);
  let found: AccessCode | null = null;
  for (const code of gate.codes) {
    if (timingSafeEqual(given, sha256(code.code)) && !found) found = code;
  }
  return found;
}

/** "<name>.<expiry>.<signature>": signed with a key derived from that code. */
export function issueSession(code: AccessCode, nowSeconds: number): string {
  const payload = `${code.name}.${nowSeconds + SESSION_TTL_SECONDS}`;
  return `${payload}.${sign(code, payload)}`;
}

/**
 * The session this token proves, or null. A token is good while its code is still
 * configured with the same value, so changing or removing a code signs out only its
 * own sessions.
 */
export function verifySession(
  gate: Gate,
  token: string | undefined,
  nowSeconds: number,
): Session | null {
  if (gate.mode === "open") return { accessCode: null };
  if (gate.mode === "closed" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [name = "", expiry = "", signature = ""] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= nowSeconds) return null;
  const code = gate.codes.find((c) => c.name === name);
  if (!code) return null;
  const expected = Buffer.from(sign(code, `${name}.${expiry}`));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? { accessCode: code }
    : null;
}

function sign(code: AccessCode, payload: string): string {
  const key = sha256(`mnemon-session\0${code.code}`);
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
