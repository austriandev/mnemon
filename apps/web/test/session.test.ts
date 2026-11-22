import { describe, expect, it } from "vitest";
import {
  checkCode,
  gateFrom,
  issueSession,
  SESSION_TTL_SECONDS,
  verifySession,
} from "../src/server/session.ts";

const NOW = 1_800_000_000;
const gate = gateFrom({ MNEMON_ACCESS_CODE: "correct horse battery", NODE_ENV: "production" });

describe("gateFrom", () => {
  it("asks for the code when one is configured", () => {
    expect(gate).toEqual({ mode: "code", code: "correct horse battery" });
  });

  it("fails closed in production when no code is configured", () => {
    expect(gateFrom({ NODE_ENV: "production" })).toEqual({ mode: "closed" });
    expect(gateFrom({ MNEMON_ACCESS_CODE: "  ", NODE_ENV: "production" })).toEqual({
      mode: "closed",
    });
  });

  it("stays open in development when no code is configured", () => {
    expect(gateFrom({ NODE_ENV: "development" })).toEqual({ mode: "open" });
  });
});

describe("checkCode", () => {
  it("accepts only the configured code", () => {
    expect(checkCode(gate, "correct horse battery")).toBe(true);
    expect(checkCode(gate, "correct horse batterY")).toBe(false);
    expect(checkCode(gate, "short")).toBe(false);
    expect(checkCode(gate, "")).toBe(false);
  });

  it("accepts nothing when the gate is closed", () => {
    expect(checkCode({ mode: "closed" }, "anything")).toBe(false);
  });
});

describe("sessions", () => {
  it("verifies a session it issued until it expires", () => {
    const token = issueSession(gate, NOW);

    expect(verifySession(gate, token, NOW + 60)).toBe(true);
    expect(verifySession(gate, token, NOW + SESSION_TTL_SECONDS - 1)).toBe(true);
    expect(verifySession(gate, token, NOW + SESSION_TTL_SECONDS)).toBe(false);
  });

  it("refuses a session whose expiry was changed", () => {
    const [, signature] = issueSession(gate, NOW).split(".");

    expect(verifySession(gate, `${NOW + 10 * SESSION_TTL_SECONDS}.${signature}`, NOW)).toBe(false);
  });

  it("refuses a session signed for another access code, so changing the code signs everyone out", () => {
    const other = gateFrom({ MNEMON_ACCESS_CODE: "another code entirely", NODE_ENV: "production" });

    expect(verifySession(gate, issueSession(other, NOW), NOW)).toBe(false);
  });

  it("refuses missing and malformed sessions", () => {
    for (const token of [undefined, "", "nonsense", "123.", ".abc", "1.2.3"]) {
      expect(verifySession(gate, token, NOW), String(token)).toBe(false);
    }
  });

  it("lets everyone in through an open gate and no one through a closed one", () => {
    expect(verifySession({ mode: "open" }, undefined, NOW)).toBe(true);
    expect(verifySession({ mode: "closed" }, issueSession(gate, NOW), NOW)).toBe(false);
  });
});
