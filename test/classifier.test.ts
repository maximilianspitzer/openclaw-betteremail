import { describe, it, expect } from "vitest";
import { buildClassifierPrompt, parseClassifierResponse } from "../src/classifier.js";
import type { TrimmedEmail } from "../src/types.js";

function makeEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    account: "test@gmail.com",
    from: "sender@example.com",
    to: "test@gmail.com",
    subject: "Test email",
    date: "2026-02-26T10:00:00Z",
    body: "Hello world",
    threadLength: 1,
    hasAttachments: false,
    ...overrides,
  };
}

describe("buildClassifierPrompt", () => {
  it("includes all emails in the prompt", () => {
    const emails = [makeEmail({ id: "msg-1" }), makeEmail({ id: "msg-2", subject: "Second" })];
    const prompt = buildClassifierPrompt(emails);
    expect(prompt).toContain("msg-1");
    expect(prompt).toContain("msg-2");
    expect(prompt).toContain("Second");
  });

  it("requests JSON array response", () => {
    const prompt = buildClassifierPrompt([makeEmail()]);
    expect(prompt).toContain("JSON");
  });
});

describe("parseClassifierResponse", () => {
  it("parses valid JSON array response", () => {
    const text = JSON.stringify([
      { id: "msg-1", importance: "high", reason: "urgent", notify: true },
    ]);
    const results = parseClassifierResponse(text, ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("high");
  });

  it("handles code-fenced JSON", () => {
    const text = "```json\n" + JSON.stringify([
      { id: "msg-1", importance: "medium", reason: "routine", notify: false },
    ]) + "\n```";
    const results = parseClassifierResponse(text, ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("medium");
  });

  it("fails open on invalid JSON — returns all as high", () => {
    const results = parseClassifierResponse("garbage output", ["msg-1", "msg-2"]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.importance === "high" && r.notify === true)).toBe(true);
  });

  it("fails open on empty response", () => {
    const results = parseClassifierResponse("", ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("high");
  });

  it("fills missing IDs with fail-open defaults", () => {
    const text = JSON.stringify([
      { id: "msg-1", importance: "low", reason: "spam", notify: false },
    ]);
    const results = parseClassifierResponse(text, ["msg-1", "msg-2"]);
    expect(results).toHaveLength(2);
    const msg2 = results.find((r) => r.id === "msg-2");
    expect(msg2?.importance).toBe("high");
    expect(msg2?.notify).toBe(true);
  });
});
