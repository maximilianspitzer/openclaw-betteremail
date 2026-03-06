import type { TrimmedEmail, DigestEntry, EmailLogEntry } from "./types.js";

export interface PipelineDeps {
  accounts: string[];
  poller: {
    loadState(): Promise<void>;
    saveState(): Promise<void>;
    pollAccount(account: string, seenMessageIds: Set<string>): Promise<{ emails: TrimmedEmail[]; historyId?: string }>;
    recordSuccess(account: string, historyId: string): void;
    recordFailure(account: string): number;
    getAccountState(account: string): { historyId: string; lastPollAt: string; consecutiveFailures: number } | undefined;
    checkThreadForReply(threadId: string, account: string): Promise<boolean>;
  };
  digest: {
    load(): Promise<void>;
    save(): Promise<void>;
    add(entry: DigestEntry): void;
    has(id: string): boolean;
    getActiveEntries(): DigestEntry[];
    expireDeferrals(): DigestEntry[];
    prune(maxAgeDays: number): number;
    markHandled(id: string): void;
  };
  emailLog: {
    append(entry: EmailLogEntry): Promise<void>;
    readAll(): Promise<EmailLogEntry[]>;
  };
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  runCommand: (args: string[], opts: { timeoutMs: number }) => Promise<{ code: number; stdout?: string; stderr?: string }>;
  consecutiveFailuresBeforeAlert: number;
}

export async function runPipeline(deps: PipelineDeps): Promise<void> {
  const { accounts, poller, digest, emailLog, logger } = deps;

  await poller.loadState();
  await digest.load();

  const pruned = digest.prune(30);
  if (pruned > 0) {
    logger.info(`betteremail: pruned ${pruned} resolved email(s) older than 30 days`);
  }

  const expired = digest.expireDeferrals();
  if (expired.length > 0) {
    logger.info(`betteremail: ${expired.length} deferred email(s) re-entered digest`);
  }

  // Auto-resolve: re-check active threads for owner replies
  const activeEntries = digest.getActiveEntries();
  for (const entry of activeEntries) {
    try {
      const replied = await poller.checkThreadForReply(entry.threadId, entry.account);
      if (replied) {
        digest.markHandled(entry.id);
        logger.info(`betteremail: auto-resolved ${entry.id} — owner replied`);
      }
    } catch {
      // Non-critical — will retry next cycle
    }
  }

  // Build seen IDs set from email log
  const allLogEntries = await emailLog.readAll();
  const seenIds = new Set(allLogEntries.map(e => e.email.id));

  const allNewEmails: TrimmedEmail[] = [];

  for (const account of accounts) {
    try {
      const { emails, historyId } = await poller.pollAccount(account, seenIds);
      const filtered = emails.filter((e) => !digest.has(e.id));
      allNewEmails.push(...filtered);
      poller.recordSuccess(account, historyId ?? poller.getAccountState(account)?.historyId ?? "");
      logger.info(`betteremail: ${account} — ${emails.length} fetched, ${filtered.length} new`);
    } catch (err) {
      const failures = poller.recordFailure(account);
      logger.error(`betteremail: poll failed for ${account}: ${err instanceof Error ? err.message : String(err)}`);

      if (failures >= deps.consecutiveFailuresBeforeAlert) {
        try {
          await deps.runCommand(
            [
              "openclaw", "agent",
              "--session-id", "main",
              "--deliver",
              "--message", `[BetterEmail] Gmail polling has failed ${failures} times in a row for ${account}. Likely auth token expiry — please re-authenticate gog.`,
            ],
            { timeoutMs: 30_000 },
          );
        } catch {
          logger.error("betteremail: failed to alert agent about polling failures");
        }
      }
    }
  }

  if (allNewEmails.length === 0) {
    await digest.save();
    await poller.saveState();
    return;
  }

  for (const email of allNewEmails) {
    await emailLog.append({ email, timestamp: Date.now() / 1000 });

    const entry: DigestEntry = {
      id: email.id,
      threadId: email.threadId,
      account: email.account,
      from: email.from,
      subject: email.subject,
      date: email.date,
      body: email.body,
      status: "new",
      firstSeenAt: new Date().toISOString(),
    };
    digest.add(entry);
  }

  await digest.save();
  await poller.saveState();
}
