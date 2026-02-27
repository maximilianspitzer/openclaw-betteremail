import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import type { DigestEntry } from "../src/types.js";
import { createEmailsCommandHandler } from "../src/commands/emails.js";

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

describe("createEmailsCommandHandler", () => {
  let tmpDir: string;
  let digest: DigestManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-cmd-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("shows 'No pending emails' for empty digest", () => {
    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("No pending emails across all accounts.");
  });

  it("shows new and surfaced entries grouped by account", async () => {
    digest.add(makeEntry({ id: "msg-1", status: "new", subject: "New email" }));
    digest.add(
      makeEntry({ id: "msg-2", status: "surfaced", subject: "Surfaced email" }),
    );
    await digest.save();

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("test@gmail.com (1 new)");
    expect(result.text).toContain("New email");
    expect(result.text).toContain("Surfaced email");
  });

  it("shows [HIGH] prefix for high importance", () => {
    digest.add(makeEntry({ importance: "high", subject: "Urgent" }));

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("[HIGH] Urgent");
  });

  it("shows [MED] prefix for medium importance", () => {
    digest.add(makeEntry({ importance: "medium", subject: "Normal" }));

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("[MED]  Normal");
  });

  it("shows deferred count", () => {
    digest.add(makeEntry({ id: "msg-1", status: "deferred" }));
    digest.add(makeEntry({ id: "msg-2", status: "deferred" }));
    // Need at least one active entry or deferred to trigger hasContent
    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("2 deferred");
  });

  it("shows handled today count", () => {
    digest.add(
      makeEntry({
        id: "msg-1",
        status: "handled",
        resolvedAt: new Date().toISOString(),
      }),
    );
    // handled-only account has no active/deferred, so it shows "nothing new"
    // We need an active entry alongside to see the handled count
    digest.add(makeEntry({ id: "msg-2", status: "new" }));

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("1 handled today");
  });

  it("shows 'nothing new' for accounts with no active or deferred entries", () => {
    digest.add(makeEntry({ id: "msg-1", status: "handled" }));

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("test@gmail.com \u2014 nothing new");
  });

  it("displays multiple accounts correctly", () => {
    digest.add(
      makeEntry({
        id: "msg-1",
        account: "work@company.com",
        status: "new",
        subject: "Work email",
      }),
    );
    digest.add(
      makeEntry({
        id: "msg-2",
        account: "personal@gmail.com",
        status: "new",
        subject: "Personal email",
      }),
    );

    const handler = createEmailsCommandHandler(digest);
    const result = handler();
    expect(result.text).toContain("work@company.com (1 new)");
    expect(result.text).toContain("Work email");
    expect(result.text).toContain("personal@gmail.com (1 new)");
    expect(result.text).toContain("Personal email");
    expect(result.text).not.toContain("No pending emails");
  });
});
