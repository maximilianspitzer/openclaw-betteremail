import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EmailLogEntry } from "./types.js";
import { atomicWrite } from "./atomic.js";

const EMAILS_FILE = "emails.jsonl";
const DEFAULT_MAX_LINES = 10_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class EmailLog {
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, EMAILS_FILE);
  }

  async append(entry: EmailLogEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.filePath, line, "utf8");
  }

  async readAll(): Promise<EmailLogEntry[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as EmailLogEntry);
    } catch {
      return [];
    }
  }

  async hasMessageId(id: string): Promise<boolean> {
    const all = await this.readAll();
    return all.some((e) => e.email.id === id);
  }

  async rotate(maxLines: number = DEFAULT_MAX_LINES): Promise<number> {
    const entries = await this.readAll();
    if (entries.length <= maxLines) return 0;

    const cutoff = Date.now() / 1000 - MAX_AGE_MS / 1000;
    const kept = entries.filter((e) => e.timestamp >= cutoff).slice(-maxLines);
    const removed = entries.length - kept.length;

    const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await atomicWrite(this.filePath, content);

    return removed;
  }
}
