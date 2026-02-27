import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EmailLog } from "../src/email-log.js";
import type { EmailLogEntry, TrimmedEmail } from "../src/types.js";

function makeTrimmedEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
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

describe("EmailLog", () => {
  let tmpDir: string;
  let log: EmailLog;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-test-"));
    log = new EmailLog(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("appends and reads entries", async () => {
    const entry: EmailLogEntry = {
      email: makeTrimmedEmail(),
      importance: "high",
      reason: "urgent",
      notify: true,
      timestamp: Date.now() / 1000,
    };
    await log.append(entry);
    const all = await log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].email.id).toBe("msg-1");
  });

  it("returns empty array when file does not exist", async () => {
    const all = await log.readAll();
    expect(all).toEqual([]);
  });

  it("rotates old entries", async () => {
    for (let i = 0; i < 5; i++) {
      await log.append({
        email: makeTrimmedEmail({ id: `msg-${i}` }),
        importance: "low",
        reason: "test",
        notify: false,
        timestamp: i < 3 ? 1000 : Date.now() / 1000,
      });
    }
    const removed = await log.rotate(3);
    expect(removed).toBeGreaterThan(0);
    const remaining = await log.readAll();
    expect(remaining.length).toBeLessThanOrEqual(3);
  });

  it("rotate uses atomic write (no temp files left behind)", async () => {
    for (let i = 0; i < 5; i++) {
      await log.append({
        email: makeTrimmedEmail({ id: `msg-${i}` }),
        importance: "low",
        reason: "test",
        notify: false,
        timestamp: Date.now() / 1000,
      });
    }
    await log.rotate(2);
    const files = await fs.readdir(tmpDir);
    // Only the emails.jsonl file should remain (no .tmp files)
    expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
  });
});
