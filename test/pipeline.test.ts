import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { TrimmedEmail, ClassificationResult } from "../src/types.js";

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
  let mockClassifier: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDigest = {
      load: vi.fn(),
      save: vi.fn(),
      add: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      getActiveEntries: vi.fn().mockReturnValue([]),
      expireDeferrals: vi.fn().mockReturnValue([]),
      markHandled: vi.fn(),
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

    mockClassifier = {
      classify: vi.fn().mockResolvedValue([
        { id: "msg-1", importance: "high", reason: "urgent", notify: true } as ClassificationResult,
      ]),
    };
  });

  it("polls accounts, classifies, and adds to digest", async () => {
    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.pollAccount).toHaveBeenCalledWith("test@gmail.com", expect.any(Set));
    expect(mockClassifier.classify).toHaveBeenCalledWith([expect.objectContaining({ id: "msg-1" })]);
    expect(mockDigest.add).toHaveBeenCalled();
    expect(mockEmailLog.append).toHaveBeenCalled();
  });

  it("skips emails already in digest", async () => {
    mockDigest.has.mockReturnValue(true);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockClassifier.classify).not.toHaveBeenCalled();
  });

  it("only adds high/medium to digest, logs all to emailLog", async () => {
    mockPoller.pollAccount.mockResolvedValue({
      emails: [makeEmail({ id: "msg-1" }), makeEmail({ id: "msg-2" })],
      historyId: "new-hist-456",
    });
    mockClassifier.classify.mockResolvedValue([
      { id: "msg-1", importance: "high", reason: "urgent", notify: true },
      { id: "msg-2", importance: "low", reason: "spam", notify: false },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockEmailLog.append).toHaveBeenCalledTimes(2);
    expect(mockDigest.add).toHaveBeenCalledTimes(1);
  });

  it("pushes high+notify emails to main agent", async () => {
    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["openclaw", "agent", "--deliver"]),
      expect.any(Object),
    );
  });

  it("expires deferrals each cycle", async () => {
    mockPoller.pollAccount.mockResolvedValue({ emails: [], historyId: undefined });
    mockDigest.expireDeferrals.mockReturnValue([{ id: "deferred-1" }]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
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
      classifier: mockClassifier,
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
      classifier: mockClassifier,
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
      { email: { id: "seen-1" }, importance: "low", reason: "test", notify: false, timestamp: 1 },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
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
      { id: "msg-active", threadId: "t-active", account: "test@gmail.com", status: "new" },
    ]);
    mockPoller.checkThreadForReply.mockResolvedValue(true);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.checkThreadForReply).toHaveBeenCalledWith("t-active", "test@gmail.com");
    expect(mockDigest.markHandled).toHaveBeenCalledWith("msg-active");
  });

  it("alerts agent after consecutive failures exceed threshold", async () => {
    mockPoller.pollAccount.mockRejectedValue(new Error("gog auth failed"));
    mockPoller.recordFailure.mockReturnValue(3);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
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
