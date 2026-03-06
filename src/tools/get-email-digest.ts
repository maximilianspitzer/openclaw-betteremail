import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";
import type { DigestEntry } from "../types.js";
import { formatAge } from "../utils.js";

export function createGetEmailDigestTool(digest: DigestManager, ready?: Promise<void>) {
  return {
    name: "get_email_digest",
    label: "Get Email Digest",
    description:
      "Get current email digest — new and surfaced emails from all Gmail accounts. " +
      "Returns emails grouped by account with status and age. " +
      "By default only shows actionable emails (new + surfaced). " +
      "Use includeDeferred/includeDismissed to also see those categories.",
    parameters: Type.Object({
      account: Type.Optional(
        Type.String({ description: "Filter by account email address" }),
      ),
      includeDeferred: Type.Optional(
        Type.Boolean({ description: "Also show deferred emails (default: false)" }),
      ),
      includeDismissed: Type.Optional(
        Type.Boolean({ description: "Also show dismissed emails (default: false)" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max emails to return (default 20). Use 0 for all." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      if (ready) await ready;
      const account = typeof params.account === "string" ? params.account : undefined;
      const includeDeferred = params.includeDeferred === true;
      const includeDismissed = params.includeDismissed === true;
      const limit = typeof params.limit === "number" && params.limit >= 0 ? params.limit : 20;

      const allowedStatuses = new Set(["new", "surfaced"]);
      if (includeDeferred) allowedStatuses.add("deferred");
      if (includeDismissed) allowedStatuses.add("dismissed");

      const entries = digest.getByStatus("all").filter((e: DigestEntry) => allowedStatuses.has(e.status));

      const grouped: Record<string, DigestEntry[]> = {};
      for (const entry of entries) {
        const acc = entry.account;
        if (account && acc !== account) continue;
        if (!grouped[acc]) grouped[acc] = [];
        grouped[acc].push(entry);
      }

      // Flatten all entries, sort by date descending (newest first)
      const allEntries = Object.entries(grouped).flatMap(([acc, entries]) =>
        entries.map((e) => ({ account: acc, entry: e })),
      );
      allEntries.sort((a, b) => new Date(b.entry.date).getTime() - new Date(a.entry.date).getTime());

      const total = allEntries.length;
      const limited = limit === 0 ? allEntries : allEntries.slice(0, limit);
      const showing = limited.length;

      // Build response from limited entries, re-grouped by account
      const summary: Record<string, unknown[]> = {};
      for (const { account: acc, entry: e } of limited) {
        if (!summary[acc]) summary[acc] = [];
        summary[acc].push({
          messageId: e.id,
          from: e.from,
          subject: e.subject,
          status: e.status,
          date: e.date,
          age: formatAge(e.firstSeenAt),
          body: e.body.length > 500 ? e.body.slice(0, 500) + "\u2026" : e.body,
          deferredUntil: e.deferredUntil ?? undefined,
        });
      }

      // Mark ALL matching entries as surfaced (not just limited ones)
      for (const entries of Object.values(grouped)) {
        for (const entry of entries) {
          if (entry.status === "new") {
            digest.markSurfaced(entry.id);
          }
        }
      }

      await digest.save();

      const response = {
        total,
        showing,
        hasMore: showing < total,
        emails: summary,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    },
  };
}
