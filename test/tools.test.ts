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
    expect(Object.keys(parsed.emails)).toHaveLength(2);
  });

  it("defaults to new and surfaced only", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", status: "surfaced" }));
    digest.add(makeEntry({ id: "msg-3", status: "handled" }));
    digest.add(makeEntry({ id: "msg-4", status: "dismissed" }));
    digest.add(makeEntry({ id: "msg-5", status: "deferred" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    expect(allEntries).toHaveLength(2);
    const ids = allEntries.map((e: any) => e.messageId).sort();
    expect(ids).toEqual(["msg-1", "msg-2"]);
  });

  it("includeDeferred shows deferred emails too", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", status: "deferred" }));
    digest.add(makeEntry({ id: "msg-3", status: "dismissed" }));
    const result = await tool.execute("call-1", { includeDeferred: true });
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    expect(allEntries).toHaveLength(2);
    const ids = allEntries.map((e: any) => e.messageId).sort();
    expect(ids).toEqual(["msg-1", "msg-2"]);
  });

  it("includeDismissed shows dismissed emails too", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", status: "dismissed" }));
    digest.add(makeEntry({ id: "msg-3", status: "deferred" }));
    const result = await tool.execute("call-1", { includeDismissed: true });
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    expect(allEntries).toHaveLength(2);
    const ids = allEntries.map((e: any) => e.messageId).sort();
    expect(ids).toEqual(["msg-1", "msg-2"]);
  });

  it("both flags shows all non-handled emails", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", status: "deferred" }));
    digest.add(makeEntry({ id: "msg-3", status: "dismissed" }));
    digest.add(makeEntry({ id: "msg-4", status: "handled" }));
    const result = await tool.execute("call-1", { includeDeferred: true, includeDismissed: true });
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    expect(allEntries).toHaveLength(3);
  });

  it("response shows original status before marking surfaced (mutation order fix)", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries[0].status).toBe("new");
    expect(digest.get("msg-1")?.status).toBe("surfaced");
  });

  it("filters by account", async () => {
    digest.add(makeEntry({ id: "msg-1", account: "a@test.com" }));
    digest.add(makeEntry({ id: "msg-2", account: "b@test.com" }));
    const result = await tool.execute("call-1", { account: "a@test.com" });
    const parsed = JSON.parse(textContent(result));
    expect(Object.keys(parsed.emails)).toEqual(["a@test.com"]);
  });

  it("truncates body to 500 chars", async () => {
    const longBody = "a".repeat(600);
    digest.add(makeEntry({ id: "msg-long", body: longBody }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed.emails ?? parsed).flat() as any[];
    const entry = entries.find((e: any) => e.messageId === "msg-long");
    expect(entry.body.length).toBeLessThanOrEqual(501); // 500 chars + ellipsis char
    expect(entry.body.endsWith("\u2026")).toBe(true);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 25; i++) {
      digest.add(makeEntry({
        id: `msg-${i}`,
        date: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
    }
    const result = await tool.execute("call-1", { limit: 10 });
    const parsed = JSON.parse(textContent(result));
    expect(parsed.total).toBe(25);
    expect(parsed.showing).toBe(10);
    expect(parsed.hasMore).toBe(true);
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries).toHaveLength(10);
  });

  it("defaults to limit 20", async () => {
    for (let i = 0; i < 25; i++) {
      digest.add(makeEntry({
        id: `msg-${i}`,
        date: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
    }
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    expect(parsed.total).toBe(25);
    expect(parsed.showing).toBe(20);
    expect(parsed.hasMore).toBe(true);
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries).toHaveLength(20);
  });

  it("limit 0 returns all", async () => {
    for (let i = 0; i < 25; i++) {
      digest.add(makeEntry({
        id: `msg-${i}`,
        date: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
    }
    const result = await tool.execute("call-1", { limit: 0 });
    const parsed = JSON.parse(textContent(result));
    expect(parsed.total).toBe(25);
    expect(parsed.showing).toBe(25);
    expect(parsed.hasMore).toBe(false);
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries).toHaveLength(25);
  });

  it("auto-resolves owner-replied entries before returning", async () => {
    digest.add(makeEntry({ id: "msg-1", threadId: "thread-1", account: "me@test.com", from: "sender@example.com", status: "new" }));
    digest.add(makeEntry({ id: "msg-2", threadId: "thread-2", account: "me@test.com", from: "other@example.com", status: "new" }));

    const toolWithResolve = createGetEmailDigestTool(digest, undefined, {
      accounts: ["me@test.com"],
      checkThreadForReply: async (threadId) => threadId === "thread-1",
    });

    const result = await toolWithResolve.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    // msg-1 should have been auto-resolved, only msg-2 remains
    expect(allEntries).toHaveLength(1);
    expect(allEntries[0].messageId).toBe("msg-2");
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("skips auto-resolve for self-sent emails", async () => {
    digest.add(makeEntry({ id: "msg-1", threadId: "thread-1", account: "me@test.com", from: "me@test.com", status: "new" }));

    const checkFn = async () => true;
    const toolWithResolve = createGetEmailDigestTool(digest, undefined, {
      accounts: ["me@test.com"],
      checkThreadForReply: checkFn,
    });

    const result = await toolWithResolve.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    // Self-sent email should not be checked, still shows as new
    expect(allEntries).toHaveLength(1);
  });

  it("works without autoResolve deps", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new" }));
    const toolNoResolve = createGetEmailDigestTool(digest);
    const result = await toolNoResolve.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const allEntries = Object.values(parsed.emails).flat() as any[];
    expect(allEntries).toHaveLength(1);
  });

  it("marks all entries surfaced even when limited", async () => {
    for (let i = 0; i < 25; i++) {
      digest.add(makeEntry({
        id: `msg-${i}`,
        status: "new",
        date: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
    }
    await tool.execute("call-1", { limit: 5 });
    for (let i = 0; i < 25; i++) {
      expect(digest.get(`msg-${i}`)?.status).toBe("surfaced");
    }
  });
});

describe("tool init guard", () => {
  let tmpDir: string;
  let digest: DigestManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("get_email_digest waits for ready promise before executing", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => { resolveReady = r; });

    const tool = createGetEmailDigestTool(digest, ready);
    digest.add(makeEntry({ status: "new" }));

    let resolved = false;
    const resultPromise = tool.execute("call-1", {}).then((r) => {
      resolved = true;
      return r;
    });

    // Should not have resolved yet — still waiting for init
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Complete init
    resolveReady();
    const result = await resultPromise;
    expect(resolved).toBe(true);
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries).toHaveLength(1);
  });

  it("mark_email_handled waits for ready promise before executing", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => { resolveReady = r; });

    const tool = createMarkEmailHandledTool(digest, ready);
    digest.add(makeEntry({ status: "new" }));

    let resolved = false;
    const resultPromise = tool.execute("call-1", { messageId: "msg-1" }).then((r) => {
      resolved = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    resolveReady();
    const result = await resultPromise;
    expect(resolved).toBe(true);
    expect(textContent(result)).toContain("Marked");
  });

  it("tools work immediately when no ready promise is provided", async () => {
    const tool = createGetEmailDigestTool(digest);
    digest.add(makeEntry({ status: "new" }));
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse(textContent(result));
    const entries = Object.values(parsed.emails).flat() as any[];
    expect(entries).toHaveLength(1);
  });
});
