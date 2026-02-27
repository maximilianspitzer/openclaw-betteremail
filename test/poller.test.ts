import { describe, it, expect } from "vitest";
import { detectOwnerReply, extractHistoryId, parseGogMessages, parseGogThread } from "../src/poller.js";
import type { RawGogMessage, RawGogThread } from "../src/types.js";

describe("parseGogMessages", () => {
  it("parses gog JSON output into RawGogMessage array", () => {
    const raw = JSON.stringify([
      { id: "msg-1", threadId: "t-1", subject: "Hello", from: "sender@test.com", date: "2026-02-26" },
    ]);
    const result = parseGogMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-1");
  });

  it("handles empty output", () => {
    expect(parseGogMessages("")).toEqual([]);
    expect(parseGogMessages("[]")).toEqual([]);
  });

  it("handles single object (not array)", () => {
    const raw = JSON.stringify({ id: "msg-1", threadId: "t-1" });
    const result = parseGogMessages(raw);
    expect(result).toHaveLength(1);
  });
});

describe("parseGogThread", () => {
  it("parses valid thread JSON", () => {
    const raw = JSON.stringify({
      id: "t-1",
      messages: [{ id: "msg-1", threadId: "t-1", from: "test@test.com" }],
    });
    const result = parseGogThread(raw);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("t-1");
    expect(result!.messages).toHaveLength(1);
  });

  it("returns null for invalid input", () => {
    expect(parseGogThread("")).toBeNull();
    expect(parseGogThread("garbage")).toBeNull();
    expect(parseGogThread(JSON.stringify({ id: "t-1" }))).toBeNull(); // missing messages
  });
});

describe("extractHistoryId", () => {
  it("extracts historyId from a valid gog history response", () => {
    const response = JSON.stringify({
      historyId: "12345",
      messages: [{ id: "msg-1" }],
    });
    expect(extractHistoryId(response)).toBe("12345");
  });

  it("returns undefined for an array response (no top-level historyId)", () => {
    const response = JSON.stringify([{ id: "msg-1" }]);
    expect(extractHistoryId(response)).toBeUndefined();
  });

  it("returns undefined for empty or whitespace input", () => {
    expect(extractHistoryId("")).toBeUndefined();
    expect(extractHistoryId("   ")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(extractHistoryId("not json")).toBeUndefined();
  });

  it("returns undefined when historyId is not a string", () => {
    const response = JSON.stringify({ historyId: 12345 });
    expect(extractHistoryId(response)).toBeUndefined();
  });

  it("returns undefined for an object without historyId", () => {
    const response = JSON.stringify({ id: "msg-1", threadId: "t-1" });
    expect(extractHistoryId(response)).toBeUndefined();
  });
});

describe("detectOwnerReply", () => {
  const ownerAccounts = ["me@work.com", "me@personal.com"];

  it("returns true when owner has replied", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "other@example.com" },
        { id: "msg-2", threadId: "t-1", from: "me@work.com" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(true);
  });

  it("returns false when owner has not replied", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "other@example.com" },
        { id: "msg-2", threadId: "t-1", from: "another@example.com" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(false);
  });

  it("handles 'Name <email>' format in from field", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "Other Person <other@example.com>" },
        { id: "msg-2", threadId: "t-1", from: "My Name <me@personal.com>" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(true);
  });

  it("returns false when owner is only the original sender (first message)", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "me@work.com" },
        { id: "msg-2", threadId: "t-1", from: "other@example.com" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(false);
  });
});
