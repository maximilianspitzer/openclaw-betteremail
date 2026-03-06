import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";
import type { DigestStatus } from "../types.js";
import { formatAge } from "../utils.js";

export function createGetEmailDigestTool(digest: DigestManager, ready?: Promise<void>) {
  return {
    name: "get_email_digest",
    label: "Get Email Digest",
    description:
      "Get current email digest — unresolved emails from all Gmail accounts. " +
      "Returns emails grouped by account with status and age. " +
      "Call this to check for new emails or review pending items. " +
      "Body is truncated to 500 chars; use status 'all' with a specific account to review full emails.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description: 'Filter by status: "new", "surfaced", "deferred", or "all". Default: "new"',
        }),
      ),
      account: Type.Optional(
        Type.String({ description: "Filter by account email address" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max emails to return (default 20). Use 0 for all." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      if (ready) await ready;
      const validStatuses = ["new", "surfaced", "deferred", "all"];
      const status = (typeof params.status === "string" ? params.status : "new") as DigestStatus | "all";
      if (!validStatuses.includes(status)) {
        return { content: [{ type: "text" as const, text: `Error: status must be one of: ${validStatuses.join(", ")}` }] };
      }
      const account = typeof params.account === "string" ? params.account : undefined;
      const limit = typeof params.limit === "number" && params.limit >= 0 ? params.limit : 20;

      let grouped = digest.getGroupedByAccount(status);

      if (account) {
        grouped = { [account]: grouped[account] ?? [] };
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
