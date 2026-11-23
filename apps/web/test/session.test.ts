import { describe, expect, it } from "vitest";
import {
  checkCode,
  type Gate,
  gateFrom,
  issueSession,
  SESSION_TTL_SECONDS,
  verifySession,
} from "../src/server/session.ts";

const NOW = 1_800_000_000;
const PROD = { NODE_ENV: "production" } as const;
const CODES = "reviewer-a:alpha-code-0001, reviewer-b:bravo-code-0002";

const gate = gateFrom({ ...PROD, MNEMON_ACCESS_CODES: CODES });
const codeNamed = (g: Gate, name: string) => {
  if (g.mode !== "codes") throw new Error(`gate is ${g.mode}`);
  const found = g.codes.find((c) => c.name === name);
  if (!found) throw new Error(`no code ${name}`);
  return found;
};

describe("gateFrom", () => {
  it("gives each listed code its name and the per-code daily limit, $2 unless set", () => {
    expect(gate).toEqual({
      mode: "codes",
      codes: [
        { name: "reviewer-a", code: "alpha-code-0001", dailyLimitUsd: 2 },
        { name: "reviewer-b", code: "bravo-code-0002", dailyLimitUsd: 2 },
      ],
    });
    const custom = gateFrom({
      ...PROD,
      MNEMON_ACCESS_CODES: "owner:owner-code-0003:5\nreviewer-c:charlie-code-04",
      MNEMON_CODE_DAILY_LIMIT_USD: "1.5",
    });
    expect(custom.mode === "codes" && custom.codes.map((c) => c.dailyLimitUsd)).toEqual([5, 1.5]);
  });

  it("keeps a single MNEMON_ACCESS_CODE working, held only to the day's limit", () => {
    expect(gateFrom({ ...PROD, MNEMON_ACCESS_CODE: "correct horse battery" })).toEqual({
      mode: "codes",
      codes: [{ name: "shared", code: "correct horse battery", dailyLimitUsd: null }],
    });
  });

  it("fails closed, saying which entry is wrong but never echoing a code, on a bad list", () => {
    const bad = [
      "reviewer-a",
      "Reviewer A:alpha-code-0001",
      "reviewer-a:short",
      "reviewer-a:alpha-code-0001,reviewer-a:bravo-code-0002",
      "reviewer-a:alpha-code-0001,reviewer-b:alpha-code-0001",
      "reviewer-a:alpha-code-0001:lots",
    ];
    for (const list of bad) {
      const result = gateFrom({ ...PROD, MNEMON_ACCESS_CODES: list });
      expect(result.mode, list).toBe("closed");
      expect(result.mode === "closed" && result.reason, list).toMatch(/MNEMON_ACCESS_CODES/);
      expect(JSON.stringify(result), list).not.toMatch(/alpha-code|bravo-code|short/);
    }
  });

  it("fails closed in production when no code is configured", () => {
    expect(gateFrom(PROD).mode).toBe("closed");
    expect(gateFrom({ ...PROD, MNEMON_ACCESS_CODE: "  ", MNEMON_ACCESS_CODES: "" }).mode).toBe(
      "closed",
    );
  });

  it("stays open in development when no code is configured", () => {
    expect(gateFrom({ NODE_ENV: "development" })).toEqual({ mode: "open" });
  });
});

describe("checkCode", () => {
  it("says which code was entered, and accepts nothing else", () => {
    expect(checkCode(gate, "bravo-code-0002")?.name).toBe("reviewer-b");
    expect(checkCode(gate, "alpha-code-0001")?.name).toBe("reviewer-a");
    expect(checkCode(gate, "alpha-code-000")).toBeNull();
    expect(checkCode(gate, "")).toBeNull();
  });

  it("accepts nothing when the gate is closed", () => {
    expect(checkCode({ mode: "closed", reason: "none" }, "anything")).toBeNull();
  });
});

describe("sessions", () => {
  const reviewerA = codeNamed(gate, "reviewer-a");

  it("knows which code a session was signed in with, until it expires", () => {
    const token = issueSession(reviewerA, NOW);

    expect(verifySession(gate, token, NOW + 60)?.accessCode?.name).toBe("reviewer-a");
    expect(verifySession(gate, token, NOW + SESSION_TTL_SECONDS - 1)).not.toBeNull();
    expect(verifySession(gate, token, NOW + SESSION_TTL_SECONDS)).toBeNull();
  });

  it("refuses a session whose expiry or code name was changed", () => {
    const [name, , signature] = issueSession(reviewerA, NOW).split(".");

    expect(
      verifySession(gate, `${name}.${NOW + 10 * SESSION_TTL_SECONDS}.${signature}`, NOW),
    ).toBeNull();
    expect(
      verifySession(gate, `reviewer-b.${NOW + SESSION_TTL_SECONDS}.${signature}`, NOW),
    ).toBeNull();
  });

  it("signs out one code's sessions when that code changes or is removed, and no one else's", () => {
    const tokenA = issueSession(reviewerA, NOW);
    const tokenB = issueSession(codeNamed(gate, "reviewer-b"), NOW);
    const changed = gateFrom({
      ...PROD,
      MNEMON_ACCESS_CODES: "reviewer-a:alpha-code-9999, reviewer-b:bravo-code-0002",
    });
    const removed = gateFrom({ ...PROD, MNEMON_ACCESS_CODES: "reviewer-b:bravo-code-0002" });

    expect(verifySession(changed, tokenA, NOW)).toBeNull();
    expect(verifySession(removed, tokenA, NOW)).toBeNull();
    expect(verifySession(changed, tokenB, NOW)?.accessCode?.name).toBe("reviewer-b");
    expect(verifySession(removed, tokenB, NOW)?.accessCode?.name).toBe("reviewer-b");
  });

  it("refuses missing and malformed sessions", () => {
    for (const token of [
      undefined,
      "",
      "nonsense",
      "123.",
      ".abc",
      "1.2",
      "a.b.c.d",
      "reviewer-a.x.y",
    ]) {
      expect(verifySession(gate, token, NOW), String(token)).toBeNull();
    }
  });

  it("lets everyone in through an open gate, under no code, and no one through a closed one", () => {
    expect(verifySession({ mode: "open" }, undefined, NOW)).toEqual({ accessCode: null });
    expect(
      verifySession({ mode: "closed", reason: "none" }, issueSession(reviewerA, NOW), NOW),
    ).toBeNull();
  });
});
