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
      getActiveThreadIds: vi.fn().mockReturnValue([]),
      expireDeferrals: vi.fn().mockReturnValue([]),
      markHandled: vi.fn(),
    };

    mockEmailLog = {
      append: vi.fn(),
      hasMessageId: vi.fn().mockResolvedValue(false),
    };

    mockPoller = {
      loadState: vi.fn(),
      saveState: vi.fn(),
      pollAccount: vi.fn().mockResolvedValue([makeEmail()]),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn().mockReturnValue(1),
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
    mockPoller.pollAccount.mockResolvedValue([
      makeEmail({ id: "msg-1" }),
      makeEmail({ id: "msg-2" }),
    ]);
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
    mockPoller.pollAccount.mockResolvedValue([]);
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
