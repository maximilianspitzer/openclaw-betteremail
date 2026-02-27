import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import type { DigestEntry } from "../src/types.js";

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

describe("DigestManager", () => {
  let tmpDir: string;
  let digest: DigestManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-digest-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("adds and retrieves entries", async () => {
    digest.add(makeEntry());
    await digest.save();
    const entries = digest.getByStatus("new");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("msg-1");
  });

  it("transitions new → surfaced", () => {
    digest.add(makeEntry());
    digest.markSurfaced("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("surfaced");
    expect(entry?.surfacedAt).toBeDefined();
  });

  it("transitions surfaced → handled", () => {
    digest.add(makeEntry({ status: "surfaced" }));
    digest.markHandled("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("handled");
    expect(entry?.resolvedAt).toBeDefined();
  });

  it("transitions to deferred with timestamp", () => {
    digest.add(makeEntry({ status: "surfaced" }));
    digest.defer("msg-1", 30);
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("deferred");
    expect(entry?.deferredUntil).toBeDefined();
  });

  it("transitions to dismissed", () => {
    digest.add(makeEntry());
    digest.dismiss("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("dismissed");
    expect(entry?.resolvedAt).toBeDefined();
  });

  it("expires deferred entries back to new", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    digest.add(makeEntry({ status: "deferred", deferredUntil: pastTime }));
    const expired = digest.expireDeferrals();
    expect(expired).toHaveLength(1);
    expect(digest.get("msg-1")?.status).toBe("new");
  });

  it("does not expire future deferrals", () => {
    const futureTime = new Date(Date.now() + 60_000).toISOString();
    digest.add(makeEntry({ status: "deferred", deferredUntil: futureTime }));
    const expired = digest.expireDeferrals();
    expect(expired).toHaveLength(0);
    expect(digest.get("msg-1")?.status).toBe("deferred");
  });

  it("groups entries by account", () => {
    digest.add(makeEntry({ id: "msg-1", account: "work@co.com" }));
    digest.add(makeEntry({ id: "msg-2", account: "personal@gmail.com" }));
    digest.add(makeEntry({ id: "msg-3", account: "work@co.com" }));
    const grouped = digest.getGroupedByAccount("new");
    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["work@co.com"]).toHaveLength(2);
    expect(grouped["personal@gmail.com"]).toHaveLength(1);
  });

  it("persists to disk and reloads", async () => {
    digest.add(makeEntry());
    await digest.save();

    const digest2 = new DigestManager(tmpDir);
    await digest2.load();
    expect(digest2.get("msg-1")?.subject).toBe("Test email");
  });

  it("returns entries needing re-check (surfaced + deferred)", () => {
    digest.add(makeEntry({ id: "msg-1", status: "surfaced" }));
    digest.add(makeEntry({ id: "msg-2", status: "deferred" }));
    digest.add(makeEntry({ id: "msg-3", status: "handled" }));
    digest.add(makeEntry({ id: "msg-4", status: "new" }));
    const needCheck = digest.getActiveThreadIds();
    expect(needCheck).toHaveLength(2);
  });

  it("has() checks if entry exists", () => {
    digest.add(makeEntry());
    expect(digest.has("msg-1")).toBe(true);
    expect(digest.has("nonexistent")).toBe(false);
  });

  it("save uses atomic write (no temp files left behind)", async () => {
    digest.add(makeEntry());
    await digest.save();
    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(["digest.json"]);
  });

  it("concurrent saves do not corrupt data", async () => {
    digest.add(makeEntry({ id: "msg-1" }));
    // Fire multiple saves concurrently
    const saves = Array.from({ length: 5 }, () => digest.save());
    await Promise.all(saves);

    // Reload and verify integrity
    const digest2 = new DigestManager(tmpDir);
    await digest2.load();
    expect(digest2.get("msg-1")?.subject).toBe("Test email");
  });
});
