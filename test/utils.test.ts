import { describe, it, expect, vi, afterEach } from "vitest";
import { formatAge } from "../src/utils.js";

describe("formatAge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns minutes for < 60 minutes", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const thirtyMinAgo = new Date(now - 30 * 60_000).toISOString();
    expect(formatAge(thirtyMinAgo)).toBe("30m ago");
  });

  it("returns hours for < 24 hours", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const fiveHoursAgo = new Date(now - 5 * 60 * 60_000).toISOString();
    expect(formatAge(fiveHoursAgo)).toBe("5h ago");
  });

  it("returns days for >= 24 hours", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60_000).toISOString();
    expect(formatAge(threeDaysAgo)).toBe("3d ago");
  });

  it("handles 0 minutes (just now)", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const justNow = new Date(now).toISOString();
    expect(formatAge(justNow)).toBe("0m ago");
  });
});
