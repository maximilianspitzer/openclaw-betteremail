import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { TrimmedEmail } from "../src/types.js";

function makeEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
  return {
    id: "msg-1", threadId: "t-1", account: "test@gmail.com",
    from: "sender@test.com", to: "test@gmail.com", subject: "Test",
    date: "2026-02-26T10:00:00Z", body: "Hello", threadLength: 1, hasAttachments: false,
    ...overrides,
  };
}

describe("runPipeline", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockRunCommand = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

  let mockDigest: any;
  let mockEmailLog: any;
  let mockPoller: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDigest = {
      load: vi.fn(),
      save: vi.fn(),
      add: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      getActiveEntries: vi.fn().mockReturnValue([]),
      expireDeferrals: vi.fn().mockReturnValue([]),
      prune: vi.fn().mockReturnValue(0),
      markHandled: vi.fn(),
      expireStale: vi.fn().mockReturnValue(0),
    };

    mockEmailLog = {
      append: vi.fn(),
      readAll: vi.fn().mockResolvedValue([]),
    };

    mockPoller = {
      loadState: vi.fn(),
      saveState: vi.fn(),
      pollAccount: vi.fn().mockResolvedValue({ emails: [makeEmail()], historyId: "new-hist-456" }),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn().mockReturnValue(1),
      getAccountState: vi.fn().mockReturnValue(undefined),
      checkThreadForReply: vi.fn().mockResolvedValue(false),
    };
  });

  it("polls accounts and adds all emails to digest", async () => {
    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.pollAccount).toHaveBeenCalledWith("test@gmail.com", expect.any(Set));
    expect(mockDigest.add).toHaveBeenCalled();
    expect(mockEmailLog.append).toHaveBeenCalled();
  });

  it("skips emails already in digest", async () => {
    mockDigest.has.mockReturnValue(true);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockDigest.add).not.toHaveBeenCalled();
  });

  it("adds all emails to digest regardless of content", async () => {
    mockPoller.pollAccount.mockResolvedValue({
      emails: [makeEmail({ id: "msg-1" }), makeEmail({ id: "msg-2", subject: "50% off sale!" })],
      historyId: "new-hist-456",
    });

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockEmailLog.append).toHaveBeenCalledTimes(2);
    expect(mockDigest.add).toHaveBeenCalledTimes(2);
  });

  it("expires deferrals each cycle", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    mockDigest.expireDeferrals.mockReturnValue([{ id: "deferred-1" }]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockDigest.expireDeferrals).toHaveBeenCalled();
  });

  it("calls recordSuccess with NEW historyId from poll response", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [makeEmail()], historyId: "new-hist-999" });
    mockPoller.getAccountState.mockReturnValue({ historyId: "old-hist-123", lastPollAt: "", consecutiveFailures: 2 });

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    // Must use the NEW historyId, not the old one
    expect(mockPoller.recordSuccess).toHaveBeenCalledWith("test@gmail.com", "new-hist-999");
  });

  it("falls back to old historyId when poll returns no historyId", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [makeEmail()], historyId: undefined });
    mockPoller.getAccountState.mockReturnValue({ historyId: "old-hist-123", lastPollAt: "", consecutiveFailures: 0 });

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.recordSuccess).toHaveBeenCalledWith("test@gmail.com", "old-hist-123");
  });

  it("builds seenIds from email log", async () => {
    mockEmailLog.readAll.mockResolvedValue([
      { email: { id: "seen-1" }, timestamp: 1 },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    const passedSet = mockPoller.pollAccount.mock.calls[0][1] as Set<string>;
    expect(passedSet.has("seen-1")).toBe(true);
  });

  it("auto-resolves active threads when owner replied", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    mockDigest.getActiveEntries.mockReturnValue([
      { id: "msg-active", threadId: "t-active", account: "test@gmail.com", from: "external@other.com", status: "new", firstSeenAt: new Date().toISOString() },
    ]);
    mockPoller.checkThreadForReply.mockResolvedValue(true);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.checkThreadForReply).toHaveBeenCalledWith("t-active", "test@gmail.com");
    expect(mockDigest.markHandled).toHaveBeenCalledWith("msg-active");
  });

  it("auto-resolve skips entries older than 7 days", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    mockDigest.getActiveEntries.mockReturnValue([
      { id: "old-msg", threadId: "t-old", account: "test@gmail.com", from: "sender@test.com", status: "new", firstSeenAt: eightDaysAgo },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.checkThreadForReply).not.toHaveBeenCalled();
  });

  it("auto-resolve skips entries from owner accounts", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    mockDigest.getActiveEntries.mockReturnValue([
      { id: "self-msg", threadId: "t-self", account: "test@gmail.com", from: "test@gmail.com", status: "new", firstSeenAt: new Date().toISOString() },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.checkThreadForReply).not.toHaveBeenCalled();
  });

  it("auto-resolve checks recent entries from external senders", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    mockDigest.getActiveEntries.mockReturnValue([
      { id: "recent-msg", threadId: "t-recent", account: "test@gmail.com", from: "external@other.com", status: "new", firstSeenAt: new Date().toISOString() },
    ]);
    mockPoller.checkThreadForReply.mockResolvedValue(false);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.checkThreadForReply).toHaveBeenCalledWith("t-recent", "test@gmail.com");
  });

  it("calls digest.expireStale each cycle", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockDigest.expireStale).toHaveBeenCalledWith(14);
  });

  it("alerts agent after consecutive failures exceed threshold", async () => {
    mockPoller.pollAccount.mockRejectedValue(new Error("gog auth failed"));
    mockPoller.recordFailure.mockReturnValue(3);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--deliver"]),
      expect.any(Object),
    );
  });
});
