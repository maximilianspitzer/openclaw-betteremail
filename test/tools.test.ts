import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import type { DigestEntry } from "../src/types.js";
import { createMarkEmailHandledTool } from "../src/tools/mark-email-handled.js";
import { createDeferEmailTool } from "../src/tools/defer-email.js";
import { createDismissEmailTool } from "../src/tools/dismiss-email.js";
import { createGetEmailDigestTool } from "../src/tools/get-email-digest.js";

function makeEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    id: "msg-1",
    threadId: "thread-1",
    account: "test@gmail.com",
    from: "sender@example.com",
    subject: "Test email",
    date: "2026-02-26T10:00:00Z",
    body: "Hello world",
    importance: "high",
    reason: "urgent matter",
    notify: true,
    status: "new",
    firstSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

function textContent(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

describe("mark_email_handled", () => {
  let tmpDir: string;
  let digest: DigestManager;
  let tool: ReturnType<typeof createMarkEmailHandledTool>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
    tool = createMarkEmailHandledTool(digest);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("marks a new email as handled", async () => {
    digest.add(makeEntry({ status: "new" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Marked");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("marks a surfaced email as handled", async () => {
    digest.add(makeEntry({ status: "surfaced" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Marked");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("marks a deferred email as handled", async () => {
    digest.add(makeEntry({ status: "deferred" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Marked");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("returns error for missing messageId", async () => {
    const result = await tool.execute("call-1", {});
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error for non-string messageId", async () => {
    const result = await tool.execute("call-1", { messageId: 123 });
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error for empty string messageId", async () => {
    const result = await tool.execute("call-1", { messageId: "" });
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error when entry not found", async () => {
    const result = await tool.execute("call-1", { messageId: "nonexistent" });
    expect(textContent(result)).toContain("not found");
  });

  it("rejects transition from handled state", async () => {
    digest.add(makeEntry({ status: "handled" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("rejects transition from dismissed state", async () => {
    digest.add(makeEntry({ status: "dismissed" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("dismissed");
  });
});

describe("defer_email", () => {
  let tmpDir: string;
  let digest: DigestManager;
  let tool: ReturnType<typeof createDeferEmailTool>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
    tool = createDeferEmailTool(digest);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("defers a new email", async () => {
    digest.add(makeEntry({ status: "new" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 30 });
    expect(textContent(result)).toContain("Deferred");
    expect(digest.get("msg-1")?.status).toBe("deferred");
  });

  it("defers a surfaced email", async () => {
    digest.add(makeEntry({ status: "surfaced" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 15 });
    expect(textContent(result)).toContain("Deferred");
    expect(digest.get("msg-1")?.status).toBe("deferred");
  });

  it("returns error for missing messageId", async () => {
    const result = await tool.execute("call-1", { minutes: 30 });
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error for non-string messageId", async () => {
    const result = await tool.execute("call-1", { messageId: 42, minutes: 30 });
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error for missing minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error for zero minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 0 });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error for negative minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: -5 });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error for NaN minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: NaN });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error for string minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: "thirty" });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error for Infinity minutes", async () => {
    digest.add(makeEntry());
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: Infinity });
    expect(textContent(result)).toContain("minutes must be a positive number");
  });

  it("returns error when entry not found", async () => {
    const result = await tool.execute("call-1", { messageId: "nonexistent", minutes: 30 });
    expect(textContent(result)).toContain("not found");
  });

  it("rejects transition from handled state", async () => {
    digest.add(makeEntry({ status: "handled" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 30 });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("rejects transition from dismissed state", async () => {
    digest.add(makeEntry({ status: "dismissed" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 30 });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("dismissed");
  });

  it("rejects transition from deferred state", async () => {
    digest.add(makeEntry({ status: "deferred" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", minutes: 30 });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("deferred");
  });
});

describe("dismiss_email", () => {
  let tmpDir: string;
  let digest: DigestManager;
  let tool: ReturnType<typeof createDismissEmailTool>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
    tool = createDismissEmailTool(digest);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("dismisses a new email", async () => {
    digest.add(makeEntry({ status: "new" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Dismissed");
    expect(digest.get("msg-1")?.status).toBe("dismissed");
  });

  it("dismisses a surfaced email", async () => {
    digest.add(makeEntry({ status: "surfaced" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Dismissed");
  });

  it("dismisses a deferred email", async () => {
    digest.add(makeEntry({ status: "deferred" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Dismissed");
  });

  it("stores dismiss reason when provided", async () => {
    digest.add(makeEntry({ status: "new" }));
    const result = await tool.execute("call-1", { messageId: "msg-1", reason: "Not relevant" });
    expect(textContent(result)).toContain("Dismissed");
    expect(digest.get("msg-1")?.dismissReason).toBe("Not relevant");
  });

  it("works without dismiss reason", async () => {
    digest.add(makeEntry({ status: "new" }));
    await tool.execute("call-1", { messageId: "msg-1" });
    expect(digest.get("msg-1")?.dismissReason).toBeUndefined();
  });

  it("returns error for missing messageId", async () => {
    const result = await tool.execute("call-1", {});
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error for non-string messageId", async () => {
    const result = await tool.execute("call-1", { messageId: 999 });
    expect(textContent(result)).toContain("messageId must be a non-empty string");
  });

  it("returns error when entry not found", async () => {
    const result = await tool.execute("call-1", { messageId: "nonexistent" });
    expect(textContent(result)).toContain("not found");
  });

  it("rejects transition from handled state", async () => {
    digest.add(makeEntry({ status: "handled" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("rejects transition from dismissed state", async () => {
    digest.add(makeEntry({ status: "dismissed" }));
    const result = await tool.execute("call-1", { messageId: "msg-1" });
    expect(textContent(result)).toContain("Cannot");
    expect(digest.get("msg-1")?.status).toBe("dismissed");
  });
});

describe("get_email_digest", () => {
  let tmpDir: string;
  let digest: DigestManager;
  let tool: ReturnType<typeof createGetEmailDigestTool>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
    tool = createGetEmailDigestTool(digest);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns grouped emails", async () => {
    digest.add(makeEntry({ id: "msg-1", account: "a@test.com" }));
    digest.add(makeEntry({ id: "msg-2", account: "b@test.com" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    expect(Object.keys(parsed)).toHaveLength(2);
  });

  it("defaults to new status filter", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", status: "handled" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed).flat() as any[];
    expect(allEntries).toHaveLength(1);
    expect(allEntries[0].messageId).toBe("msg-1");
  });

  it("response shows original status before marking surfaced (mutation order fix)", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed).flat() as any[];
    // The response should show "new", not "surfaced"
    expect(entries[0].status).toBe("new");
    // But the entry in the digest should now be "surfaced"
    expect(digest.get("msg-1")?.status).toBe("surfaced");
  });

  it("filters by account", async () => {
    digest.add(makeEntry({ id: "msg-1", account: "a@test.com" }));
    digest.add(makeEntry({ id: "msg-2", account: "b@test.com" }));
    const result = await tool.execute("call-1", { account: "a@test.com" });
    const parsed = JSON.parse(textContent(result));
    expect(Object.keys(parsed)).toEqual(["a@test.com"]);
  });

  it("returns error for invalid status", async () => {
    const result = await tool.execute("call-1", { status: "invalid" });
    expect(textContent(result)).toContain("status must be one of");
  });

  it("accepts valid status values", async () => {
    digest.add(makeEntry({ status: "surfaced" }));
    const result = await tool.execute("call-1", { status: "surfaced" });
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed).flat() as any[];
    expect(entries).toHaveLength(1);
  });

  it("defaults status when non-string is provided", async () => {
    digest.add(makeEntry({ status: "new" }));
    // Non-string status should default to "new"
    const result = await tool.execute("call-1", { status: 42 });
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed).flat() as any[];
    expect(entries).toHaveLength(1);
  });
});
