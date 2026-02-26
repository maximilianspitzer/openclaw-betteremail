import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { TrimmedEmail, ClassificationResult } from "./types.js";

type RunEmbeddedPiAgentFn = (opts: Record<string, unknown>) => Promise<{ payloads?: unknown[] }>;

let _runFn: RunEmbeddedPiAgentFn | null = null;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  if (_runFn) return _runFn;
  const mod = await import("../../../src/agents/pi-embedded.js").catch(() =>
    import("openclaw/agents/pi-embedded"),
  );
  if (typeof (mod as any).runEmbeddedPiAgent !== "function") {
    throw new Error("runEmbeddedPiAgent not available");
  }
  _runFn = (mod as any).runEmbeddedPiAgent as RunEmbeddedPiAgentFn;
  return _runFn;
}

export function buildClassifierPrompt(emails: TrimmedEmail[]): string {
  const emailSummaries = emails.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    subject: e.subject,
    date: e.date,
    body: e.body,
    account: e.account,
    threadLength: e.threadLength,
    hasAttachments: e.hasAttachments,
  }));

  return [
    "You are triaging emails for the user. For each email, decide:",
    '- importance: "high" | "medium" | "low"',
    "- reason: one sentence explaining why",
    "- notify: boolean (should the user be interrupted for this?)",
    "",
    "Consider: sender relationship, urgency signals, whether it requires action,",
    "time sensitivity, financial/legal implications, personal importance.",
    "",
    "Respond with ONLY a valid JSON array. Each element must have: id, importance, reason, notify.",
    "",
    `Emails to triage (${emails.length}):`,
    JSON.stringify(emailSummaries, null, 2),
  ].join("\n");
}

function extractText(payloads: unknown[]): string {
  for (const p of payloads) {
    if (typeof p === "string") return p;
    if (p && typeof p === "object" && "text" in p && typeof (p as any).text === "string") {
      return (p as any).text;
    }
    if (p && typeof p === "object" && "content" in p && Array.isArray((p as any).content)) {
      for (const c of (p as any).content) {
        if (c && typeof c.text === "string") return c.text;
      }
    }
  }
  return "";
}

function failOpenDefaults(emailIds: string[]): ClassificationResult[] {
  return emailIds.map((id) => ({
    id,
    importance: "high" as const,
    reason: "classification failed — fail open",
    notify: true,
  }));
}

export function parseClassifierResponse(text: string, emailIds: string[]): ClassificationResult[] {
  if (!text || !text.trim()) return failOpenDefaults(emailIds);

  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return failOpenDefaults(emailIds);

    const resultsMap = new Map<string, ClassificationResult>();
    for (const item of parsed) {
      if (item && typeof item.id === "string") {
        resultsMap.set(item.id, {
          id: item.id,
          importance: ["high", "medium", "low"].includes(item.importance) ? item.importance : "high",
          reason: typeof item.reason === "string" ? item.reason : "no reason given",
          notify: typeof item.notify === "boolean" ? item.notify : true,
        });
      }
    }

    return emailIds.map(
      (id) =>
        resultsMap.get(id) ?? {
          id,
          importance: "high" as const,
          reason: "missing from classifier response — fail open",
          notify: true,
        },
    );
  } catch {
    return failOpenDefaults(emailIds);
  }
}

export class Classifier {
  private api: OpenClawPluginApi;
  private timeoutMs: number;

  constructor(api: OpenClawPluginApi, timeoutMs: number) {
    this.api = api;
    this.timeoutMs = timeoutMs;
  }

  async classify(emails: TrimmedEmail[]): Promise<ClassificationResult[]> {
    if (emails.length === 0) return [];

    const prompt = buildClassifierPrompt(emails);
    const emailIds = emails.map((e) => e.id);

    let tmpDir: string | null = null;
    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-classify-"));
      const sessionFile = path.join(tmpDir, "session.json");

      const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

      const result = await runEmbeddedPiAgent({
        sessionId: `betteremail-classifier-${Date.now()}`,
        sessionFile,
        workspaceDir: (this.api as any).config?.agents?.defaults?.workspace ?? process.cwd(),
        config: (this.api as any).config,
        prompt,
        timeoutMs: this.timeoutMs,
        runId: `betteremail-classify-${Date.now()}`,
        disableTools: true,
        skillsSnapshot: (this.api as any).skillsSnapshot ?? undefined,
      });

      const text = extractText(result.payloads ?? []);
      return parseClassifierResponse(text, emailIds);
    } catch (err) {
      this.api.logger.error(
        `betteremail: classifier failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return failOpenDefaults(emailIds);
    } finally {
      if (tmpDir) {
        try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  }
}
