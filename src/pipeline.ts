import type { TrimmedEmail, ClassificationResult, DigestEntry, EmailLogEntry } from "./types.js";

export interface PipelineDeps {
  accounts: string[];
  poller: {
    loadState(): Promise<void>;
    saveState(): Promise<void>;
    pollAccount(account: string, seenMessageIds: Set<string>): Promise<TrimmedEmail[]>;
    recordSuccess(account: string, historyId: string): void;
    recordFailure(account: string): number;
    getAccountState(account: string): { historyId: string; lastPollAt: string; consecutiveFailures: number } | undefined;
    checkThreadForReply(threadId: string, account: string): Promise<boolean>;
  };
  classifier: {
    classify(emails: TrimmedEmail[]): Promise<ClassificationResult[]>;
  };
  digest: {
    load(): Promise<void>;
    save(): Promise<void>;
    add(entry: DigestEntry): void;
    has(id: string): boolean;
    getActiveThreadIds(): DigestEntry[];
    expireDeferrals(): DigestEntry[];
    markHandled(id: string): void;
  };
  emailLog: {
    append(entry: EmailLogEntry): Promise<void>;
    hasMessageId(id: string): Promise<boolean>;
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

const BATCH_SIZE = 10;

export async function runPipeline(deps: PipelineDeps): Promise<void> {
  const { accounts, poller, classifier, digest, emailLog, logger } = deps;

  await poller.loadState();
  await digest.load();

  const expired = digest.expireDeferrals();
  if (expired.length > 0) {
    logger.info(`betteremail: ${expired.length} deferred email(s) re-entered digest`);
  }

  // Auto-resolve: re-check active threads for owner replies
  const activeEntries = digest.getActiveThreadIds();
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
      const emails = await poller.pollAccount(account, seenIds);
      const filtered = emails.filter((e) => !digest.has(e.id));
      allNewEmails.push(...filtered);
      const currentState = poller.getAccountState(account);
      poller.recordSuccess(account, currentState?.historyId ?? "");
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

  for (let i = 0; i < allNewEmails.length; i += BATCH_SIZE) {
    const batch = allNewEmails.slice(i, i + BATCH_SIZE);
    const results = await classifier.classify(batch);

    for (let j = 0; j < batch.length; j++) {
      const email = batch[j];
      const result = results[j];

      await emailLog.append({
        email,
        importance: result.importance,
        reason: result.reason,
        notify: result.notify,
        timestamp: Date.now() / 1000,
      });

      if (result.importance === "high" || result.importance === "medium") {
        const entry: DigestEntry = {
          id: email.id,
          threadId: email.threadId,
          account: email.account,
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: email.body,
          importance: result.importance,
          reason: result.reason,
          notify: result.notify,
          status: "new",
          firstSeenAt: new Date().toISOString(),
        };
        digest.add(entry);

        if (result.importance === "high" && result.notify) {
          const message = formatPushMessage(email, result);
          try {
            await deps.runCommand(
              [
                "openclaw", "agent",
                "--session-id", "main",
                "--deliver",
                "--message", message,
              ],
              { timeoutMs: 30_000 },
            );
            logger.info(`betteremail: pushed ${email.id} to agent`);
          } catch (err) {
            logger.error(`betteremail: failed to push to agent: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }

  await digest.save();
  await poller.saveState();
}

function formatPushMessage(email: TrimmedEmail, result: ClassificationResult): string {
  return [
    "[BetterEmail] New high-importance email:",
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Account: ${email.account}`,
    `Date: ${email.date}`,
    `Reason: ${result.reason}`,
    `MessageID: ${email.id}`,
    "",
    "Use defer_email to postpone or mark_email_handled when resolved.",
  ].join("\n");
}
