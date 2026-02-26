import { describe, it, expect } from "vitest";
import { getIntervalMs, isWorkHours } from "../src/scheduler.js";
import type { WorkHoursConfig, PollIntervalConfig } from "../src/types.js";

describe("isWorkHours", () => {
  const config: WorkHoursConfig = { start: 9, end: 18, timezone: "UTC" };

  it("returns true during work hours", () => {
    const noon = new Date("2026-02-26T12:00:00Z");
    expect(isWorkHours(noon, config)).toBe(true);
  });

  it("returns false outside work hours", () => {
    const lateNight = new Date("2026-02-26T23:00:00Z");
    expect(isWorkHours(lateNight, config)).toBe(false);
  });

  it("returns true at start boundary", () => {
    const start = new Date("2026-02-26T09:00:00Z");
    expect(isWorkHours(start, config)).toBe(true);
  });

  it("returns false at end boundary", () => {
    const end = new Date("2026-02-26T18:00:00Z");
    expect(isWorkHours(end, config)).toBe(false);
  });
});

describe("getIntervalMs", () => {
  const intervals: PollIntervalConfig = { workHours: 5, offHours: 30 };
  const workConfig: WorkHoursConfig = { start: 9, end: 18, timezone: "UTC" };

  it("returns work interval during work hours", () => {
    const noon = new Date("2026-02-26T12:00:00Z");
    expect(getIntervalMs(noon, intervals, workConfig)).toBe(5 * 60 * 1000);
  });

  it("returns off-hours interval outside work hours", () => {
    const night = new Date("2026-02-26T23:00:00Z");
    expect(getIntervalMs(night, intervals, workConfig)).toBe(30 * 60 * 1000);
  });
});
