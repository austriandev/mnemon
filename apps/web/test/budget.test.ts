import { describe, expect, it } from "vitest";
import { dailyLimitUsd, overLimitMessage } from "../src/server/budget.ts";

describe("dailyLimitUsd", () => {
  it("is $5 a day unless MNEMON_DAILY_LIMIT_USD says otherwise", () => {
    expect(dailyLimitUsd({})).toBe(5);
    expect(dailyLimitUsd({ MNEMON_DAILY_LIMIT_USD: "" })).toBe(5);
    expect(dailyLimitUsd({ MNEMON_DAILY_LIMIT_USD: "12.5" })).toBe(12.5);
    expect(dailyLimitUsd({ MNEMON_DAILY_LIMIT_USD: "0" })).toBe(0);
  });

  it("refuses a limit that isn't a non-negative number, rather than run without one", () => {
    for (const bad of ["five", "-1", "Infinity", "1e400"]) {
      expect(() => dailyLimitUsd({ MNEMON_DAILY_LIMIT_USD: bad }), bad).toThrow(
        /MNEMON_DAILY_LIMIT_USD/,
      );
    }
  });
});

describe("overLimitMessage", () => {
  it("says what was spent, the limit, and when it resets", () => {
    expect(overLimitMessage({ ok: false, spentUsd: 4.981, limitUsd: 5 })).toBe(
      "Today's spending limit is reached: $4.98 of $5.00 used. It resets at midnight; MNEMON_DAILY_LIMIT_USD sets it.",
    );
  });
});
