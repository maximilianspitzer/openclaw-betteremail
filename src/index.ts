import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "./types.js";
import { DigestManager } from "./digest.js";
import { EmailLog } from "./email-log.js";
import { Poller } from "./poller.js";
import { Classifier } from "./classifier.js";
import { Scheduler } from "./scheduler.js";
import { runPipeline } from "./pipeline.js";
import { createGetEmailDigestTool } from "./tools/get-email-digest.js";
import { createMarkEmailHandledTool } from "./tools/mark-email-handled.js";
import { createDeferEmailTool } from "./tools/defer-email.js";
import { createDismissEmailTool } from "./tools/dismiss-email.js";
import { createEmailsCommandHandler } from "./commands/emails.js";

const DEFAULT_CONFIG: PluginConfig = {
  accounts: [],
  pollIntervalMinutes: { workHours: 5, offHours: 30 },
  workHours: { start: 9, end: 18, timezone: "Europe/London" },
  classifierTimeoutMs: 30_000,
  consecutiveFailuresBeforeAlert: 3,
  rescanDaysOnHistoryReset: 7,
};

function resolveConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  return {
    accounts: Array.isArray(raw?.accounts) ? (raw.accounts as string[]) : DEFAULT_CONFIG.accounts,
    pollIntervalMinutes:
      raw?.pollIntervalMinutes && typeof raw.pollIntervalMinutes === "object"
        ? {
            workHours: typeof (raw.pollIntervalMinutes as any).workHours === "number"
              ? (raw.pollIntervalMinutes as any).workHours
              : DEFAULT_CONFIG.pollIntervalMinutes.workHours,
            offHours: typeof (raw.pollIntervalMinutes as any).offHours === "number"
              ? (raw.pollIntervalMinutes as any).offHours
              : DEFAULT_CONFIG.pollIntervalMinutes.offHours,
          }
        : DEFAULT_CONFIG.pollIntervalMinutes,
    workHours:
      raw?.workHours && typeof raw.workHours === "object"
        ? {
            start: typeof (raw.workHours as any).start === "number"
              ? (raw.workHours as any).start
              : DEFAULT_CONFIG.workHours.start,
            end: typeof (raw.workHours as any).end === "number"
              ? (raw.workHours as any).end
              : DEFAULT_CONFIG.workHours.end,
            timezone: typeof (raw.workHours as any).timezone === "string"
              ? (raw.workHours as any).timezone
              : DEFAULT_CONFIG.workHours.timezone,
          }
        : DEFAULT_CONFIG.workHours,
    classifierTimeoutMs:
      typeof raw?.classifierTimeoutMs === "number" ? raw.classifierTimeoutMs : DEFAULT_CONFIG.classifierTimeoutMs,
    consecutiveFailuresBeforeAlert:
      typeof raw?.consecutiveFailuresBeforeAlert === "number"
        ? raw.consecutiveFailuresBeforeAlert
        : DEFAULT_CONFIG.consecutiveFailuresBeforeAlert,
    rescanDaysOnHistoryReset:
      typeof raw?.rescanDaysOnHistoryReset === "number"
        ? raw.rescanDaysOnHistoryReset
        : DEFAULT_CONFIG.rescanDaysOnHistoryReset,
  };
}

export default {
  id: "betteremail",
  name: "BetterEmail Digest",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig as Record<string, unknown> | undefined);
    const stateDir = api.runtime.state.resolveStateDir();

    api.logger.info(
      `betteremail plugin loaded (accounts=${config.accounts.length}, ` +
      `workHours=${config.pollIntervalMinutes.workHours}m, offHours=${config.pollIntervalMinutes.offHours}m)`,
    );

    if (config.accounts.length === 0) {
      api.logger.warn("betteremail: no accounts configured — plugin will not poll");
      return;
    }

    const digest = new DigestManager(stateDir);
    const emailLog = new EmailLog(stateDir);
    const poller = new Poller(api, stateDir, config.accounts, config.rescanDaysOnHistoryReset);
    const classifier = new Classifier(api, config.classifierTimeoutMs);

    let initialized = false;
    const initPromise = (async () => {
      try {
        await digest.load();
        await poller.loadState();
        initialized = true;
        api.logger.info("betteremail: async init complete");
      } catch (err) {
        api.logger.error(`betteremail: init failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();

    api.registerTool(createGetEmailDigestTool(digest), { optional: true });
    api.registerTool(createMarkEmailHandledTool(digest), { optional: true });
    api.registerTool(createDeferEmailTool(digest), { optional: true });
    api.registerTool(createDismissEmailTool(digest), { optional: true });

    api.registerCommand({
      name: "emails",
      description: "Show current email digest status across all accounts",
      handler: createEmailsCommandHandler(digest),
    });

    const runOnce = async () => {
      if (!initialized) await initPromise;

      await runPipeline({
        accounts: config.accounts,
        poller,
        classifier,
        digest,
        emailLog,
        logger: api.logger,
        runCommand: (args, opts) => api.runtime.system.runCommandWithTimeout(args, opts),
        consecutiveFailuresBeforeAlert: config.consecutiveFailuresBeforeAlert,
      });

      await emailLog.rotate();
    };

    const scheduler = new Scheduler(
      config.pollIntervalMinutes,
      config.workHours,
      runOnce,
    );

    api.registerService({
      id: "betteremail-poller",
      start: () => {
        scheduler.start();
        api.logger.info("betteremail: polling service started");
      },
      stop: () => {
        scheduler.stop();
        api.logger.info("betteremail: polling service stopped");
      },
    });
  },
};
