import { describe, it, expect } from "vitest";
import { trimEmailBody } from "../src/trimmer.js";

describe("trimEmailBody", () => {
  it("strips HTML tags", () => {
    expect(trimEmailBody("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(trimEmailBody("&amp; &lt; &gt; &quot; &#39;")).toBe("& < > \" '");
  });

  it("removes quoted reply chains", () => {
    const body = "Thanks for the update.\n\nOn Mon, Feb 24, 2026, John wrote:\n> Original message\n> More text";
    expect(trimEmailBody(body)).toBe("Thanks for the update.");
  });

  it("removes > prefixed quote blocks", () => {
    const body = "My reply.\n\n> quoted line 1\n> quoted line 2\n> quoted line 3";
    expect(trimEmailBody(body)).toBe("My reply.");
  });

  it("removes common email signatures", () => {
    const body = "Main content.\n\n--\nJohn Smith\nCEO, Company Inc.";
    expect(trimEmailBody(body)).toBe("Main content.");
  });

  it("removes 'Sent from' signatures", () => {
    const body = "Quick reply.\n\nSent from my iPhone";
    expect(trimEmailBody(body)).toBe("Quick reply.");
  });

  it("removes legal disclaimers", () => {
    const body = "Actual content.\n\nThis email is confidential and intended solely for the use of the individual.";
    expect(trimEmailBody(body)).toBe("Actual content.");
  });

  it("removes tracking pixels and image references", () => {
    const body = "Content here.\n\n[image]\n[cid:abc123]";
    expect(trimEmailBody(body)).toBe("Content here.");
  });

  it("collapses excessive whitespace", () => {
    const body = "Line 1.\n\n\n\n\n\nLine 2.";
    expect(trimEmailBody(body)).toBe("Line 1.\n\nLine 2.");
  });

  it("truncates to max length", () => {
    const body = "A".repeat(5000);
    const result = trimEmailBody(body, 3000);
    expect(result.length).toBeLessThanOrEqual(3000);
  });

  it("handles empty input", () => {
    expect(trimEmailBody("")).toBe("");
    expect(trimEmailBody(undefined as any)).toBe("");
  });
});
