import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getIntervalMs, isWorkHours, Scheduler } from "../src/scheduler.js";
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

describe("Scheduler", () => {
  const intervals: PollIntervalConfig = { workHours: 5, offHours: 30 };
  const workConfig: WorkHoursConfig = { start: 9, end: 18, timezone: "UTC" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onTick immediately on start", async () => {
    let tickCount = 0;
    const onTick = async () => { tickCount++; };
    const scheduler = new Scheduler(intervals, workConfig, onTick);
    scheduler.start();

    // Flush microtasks (the immediate tick)
    await vi.advanceTimersByTimeAsync(0);

    expect(tickCount).toBe(1);
    scheduler.stop();
  });

  it("schedules next tick after immediate tick completes", async () => {
    let tickCount = 0;
    const onTick = async () => { tickCount++; };
    const scheduler = new Scheduler(intervals, workConfig, onTick);

    vi.setSystemTime(new Date("2026-02-26T12:00:00Z")); // work hours
    scheduler.start();

    // Flush immediate tick
    await vi.advanceTimersByTimeAsync(1);
    expect(tickCount).toBe(1);

    // Advance past work-hours interval (5 min)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(tickCount).toBe(2);
    scheduler.stop();
  });
});
