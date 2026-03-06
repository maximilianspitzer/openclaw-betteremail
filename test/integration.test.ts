import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import { EmailLog } from "../src/email-log.js";
import { runPipeline } from "../src/pipeline.js";
import type { TrimmedEmail } from "../src/types.js";

describe("Integration: full pipeline cycle", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-integ-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("processes new emails through full pipeline", async () => {
    const digest = new DigestManager(tmpDir);
    const emailLog = new EmailLog(tmpDir);
    await digest.load();

    const mockEmails: TrimmedEmail[] = [
      {
        id: "msg-urgent", threadId: "t-1", account: "work@co.com",
        from: "boss@co.com", to: "work@co.com", subject: "Contract needs signature TODAY",
        date: "2026-02-26T10:00:00Z", body: "Please sign ASAP", threadLength: 1, hasAttachments: true,
      },
      {
        id: "msg-spam", threadId: "t-2", account: "personal@gmail.com",
        from: "deals@shop.com", to: "personal@gmail.com", subject: "50% off sale!",
        date: "2026-02-26T10:00:00Z", body: "Buy now", threadLength: 1, hasAttachments: false,
      },
    ];

    await runPipeline({
      accounts: ["work@co.com", "personal@gmail.com"],
      poller: {
        loadState: vi.fn(),
        saveState: vi.fn(),
        pollAccount: vi.fn()
          .mockResolvedValueOnce({ emails: [mockEmails[0]], historyId: "hist-1" })
          .mockResolvedValueOnce({ emails: [mockEmails[1]], historyId: "hist-2" }),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn().mockReturnValue(1),
        getAccountState: vi.fn().mockReturnValue(undefined),
        checkThreadForReply: vi.fn().mockResolvedValue(false),
      },
      digest,
      emailLog,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runCommand: vi.fn().mockResolvedValue({ code: 0 }),
      consecutiveFailuresBeforeAlert: 3,
    });

    // Both emails should be in digest
    const urgent = digest.get("msg-urgent");
    expect(urgent).toBeDefined();
    expect(urgent?.status).toBe("new");

    const spam = digest.get("msg-spam");
    expect(spam).toBeDefined();
    expect(spam?.status).toBe("new");

    // Both should be in email log
    const allLogs = await emailLog.readAll();
    expect(allLogs).toHaveLength(2);
  });

  it("marks emails as handled and they don't reappear", async () => {
    const digest = new DigestManager(tmpDir);
    await digest.load();

    digest.add({
      id: "msg-1", threadId: "t-1", account: "work@co.com",
      from: "boss@co.com", subject: "Review doc", date: "2026-02-26T10:00:00Z",
      body: "Please review", status: "surfaced", firstSeenAt: new Date().toISOString(),
    });

    digest.markHandled("msg-1");
    expect(digest.get("msg-1")?.status).toBe("handled");
    await digest.save();

    const mockPoller = {
      loadState: vi.fn(), saveState: vi.fn(),
      pollAccount: vi.fn().mockResolvedValue({ emails: [
        { id: "msg-1", threadId: "t-1", account: "work@co.com",
          from: "boss@co.com", to: "work@co.com", subject: "Review doc",
          date: "2026-02-26T10:00:00Z", body: "Please review",
          threadLength: 1, hasAttachments: false },
      ], historyId: undefined }),
      recordSuccess: vi.fn(), recordFailure: vi.fn().mockReturnValue(1),
      getAccountState: vi.fn().mockReturnValue(undefined),
      checkThreadForReply: vi.fn().mockResolvedValue(false),
    };

    await runPipeline({
      accounts: ["work@co.com"],
      poller: mockPoller,
      digest,
      emailLog: new EmailLog(tmpDir),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runCommand: vi.fn().mockResolvedValue({ code: 0 }),
      consecutiveFailuresBeforeAlert: 3,
    });

    // Still handled, not re-added
    expect(digest.get("msg-1")?.status).toBe("handled");
  });

  it("defers and re-surfaces emails", async () => {
    const digest = new DigestManager(tmpDir);
    await digest.load();

    digest.add({
      id: "msg-defer", threadId: "t-1", account: "work@co.com",
      from: "client@co.com", subject: "Invoice", date: "2026-02-26T10:00:00Z",
      body: "Please pay", status: "surfaced", firstSeenAt: new Date().toISOString(),
    });

    // Defer for 0 minutes (so it expires immediately)
    digest.defer("msg-defer", 0);
    expect(digest.get("msg-defer")?.status).toBe("deferred");
    await digest.save();

    // Wait a tiny bit for the timestamp to be in the past
    await new Promise((r) => setTimeout(r, 10));

    // Run pipeline — should expire the deferral
    await runPipeline({
      accounts: ["work@co.com"],
      poller: {
        loadState: vi.fn(), saveState: vi.fn(),
        pollAccount: vi.fn().mockResolvedValue({ emails: [], historyId: undefined }),
        recordSuccess: vi.fn(), recordFailure: vi.fn().mockReturnValue(0),
        getAccountState: vi.fn().mockReturnValue(undefined),
        checkThreadForReply: vi.fn().mockResolvedValue(false),
      },
      digest,
      emailLog: new EmailLog(tmpDir),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runCommand: vi.fn().mockResolvedValue({ code: 0 }),
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(digest.get("msg-defer")?.status).toBe("new");
  });
});
