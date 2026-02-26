import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { RawGogMessage, RawGogThread, PollState, TrimmedEmail } from "./types.js";
import { trimEmailBody } from "./trimmer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const STATE_FILE = "state.json";

export function parseGogMessages(stdout: string): RawGogMessage[] {
  if (!stdout || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && parsed.id) return [parsed];
    return [];
  } catch {
    return [];
  }
}

export function parseGogThread(stdout: string): RawGogThread | null {
  if (!stdout || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && parsed.id && Array.isArray(parsed.messages)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractEmail(fromField: string): string {
  const match = fromField.match(/<([^>]+)>/);
  return (match ? match[1] : fromField).toLowerCase().trim();
}

export function detectOwnerReply(thread: RawGogThread, ownerAccounts: string[]): boolean {
  const lowerAccounts = ownerAccounts.map((a) => a.toLowerCase());
  return thread.messages.some((msg) => {
    if (!msg.from) return false;
    const email = extractEmail(msg.from);
    return lowerAccounts.includes(email);
  });
}

export class Poller {
  private api: OpenClawPluginApi;
  private stateDir: string;
  private accounts: string[];
  private rescanDays: number;
  private state: PollState;

  constructor(api: OpenClawPluginApi, stateDir: string, accounts: string[], rescanDays: number) {
    this.api = api;
    this.stateDir = stateDir;
    this.accounts = accounts;
    this.rescanDays = rescanDays;
    this.state = { accounts: {}, lastClassifierRunAt: "" };
  }

  async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.stateDir, STATE_FILE), "utf8");
      this.state = JSON.parse(raw) as PollState;
    } catch {
      this.state = { accounts: {}, lastClassifierRunAt: "" };
    }
  }

  async saveState(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(
      path.join(this.stateDir, STATE_FILE),
      JSON.stringify(this.state, null, 2) + "\n",
      "utf8",
    );
  }

  getAccountState(account: string) {
    return this.state.accounts[account];
  }

  recordSuccess(account: string, historyId: string): void {
    this.state.accounts[account] = {
      historyId,
      lastPollAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };
  }

  recordFailure(account: string): number {
    const existing = this.state.accounts[account];
    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    this.state.accounts[account] = {
      historyId: existing?.historyId ?? "",
      lastPollAt: existing?.lastPollAt ?? "",
      consecutiveFailures: failures,
    };
    return failures;
  }

  async runGog(args: string[]): Promise<{ stdout: string; ok: boolean }> {
    try {
      const result = await this.api.runtime.system.runCommandWithTimeout(
        ["gog", ...args],
        { timeoutMs: 30_000 },
      );
      if (result.code !== 0) {
        this.api.logger.warn(`betteremail: gog failed (code ${result.code}): ${result.stderr?.slice(0, 200)}`);
        return { stdout: "", ok: false };
      }
      return { stdout: result.stdout ?? "", ok: true };
    } catch (err) {
      this.api.logger.error(`betteremail: gog error: ${err instanceof Error ? err.message : String(err)}`);
      return { stdout: "", ok: false };
    }
  }

  async checkThreadForReply(threadId: string, account: string): Promise<boolean> {
    const result = await this.runGog([
      "gmail", "thread", "get", threadId, "--account", account, "--json",
    ]);
    if (!result.ok) return false;
    const thread = parseGogThread(result.stdout);
    if (!thread) return false;
    return detectOwnerReply(thread, this.accounts);
  }

  async pollAccount(account: string, seenMessageIds: Set<string>): Promise<TrimmedEmail[]> {
    const accountState = this.state.accounts[account];
    const historyId = accountState?.historyId;

    let messages: RawGogMessage[];

    if (historyId) {
      const result = await this.runGog([
        "gmail", "history", "--since", historyId, "--account", account, "--json",
      ]);
      if (!result.ok) {
        this.api.logger.info(`betteremail: history fetch failed for ${account}, falling back to rescan`);
        const fallback = await this.runGog([
          "gmail", "messages", "search", `newer_than:${this.rescanDays}d`,
          "--account", account, "--json", "--include-body",
        ]);
        if (!fallback.ok) return [];
        messages = parseGogMessages(fallback.stdout);
      } else {
        messages = parseGogMessages(result.stdout);
      }
    } else {
      const result = await this.runGog([
        "gmail", "messages", "search", `newer_than:${this.rescanDays}d`,
        "--account", account, "--json", "--include-body",
      ]);
      if (!result.ok) return [];
      messages = parseGogMessages(result.stdout);
    }

    const newMessages = messages.filter((m) => !seenMessageIds.has(m.id));
    const trimmedEmails: TrimmedEmail[] = [];

    for (const msg of newMessages) {
      const threadResult = await this.runGog([
        "gmail", "thread", "get", msg.threadId, "--account", account, "--json",
      ]);

      const thread = threadResult.ok ? parseGogThread(threadResult.stdout) : null;

      if (thread && detectOwnerReply(thread, this.accounts)) {
        continue;
      }

      trimmedEmails.push({
        id: msg.id,
        threadId: msg.threadId,
        account,
        from: msg.from ?? "unknown",
        to: msg.to ?? account,
        subject: msg.subject ?? "(no subject)",
        date: msg.date ?? new Date().toISOString(),
        body: trimEmailBody(msg.body ?? ""),
        threadLength: thread?.messages.length ?? 1,
        hasAttachments: Array.isArray(msg.labelIds) && msg.labelIds.includes("ATTACHMENT"),
      });
    }

    return trimmedEmails;
  }
}
