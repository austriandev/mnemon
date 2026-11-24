import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../src/server/security-headers.ts";

const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("let the app's own pages ask for the microphone, to record a meeting, and nothing else", () => {
    const policy = header("Permissions-Policy") ?? "";

    // microphone=() would block recording outright, without the browser even asking.
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
  });

  it("keep the page out of frames, types unsniffed, and HTTPS on", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d+/);
  });
});
