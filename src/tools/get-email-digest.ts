import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";
import type { DigestStatus } from "../types.js";

export function createGetEmailDigestTool(digest: DigestManager) {
  return {
    name: "get_email_digest",
    label: "Get Email Digest",
    description:
      "Get current email digest — unresolved important emails from all Gmail accounts. " +
      "Returns emails grouped by account with importance level, reason, and age. " +
      "Call this to check for new emails or review pending items.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description: 'Filter by status: "new", "surfaced", "deferred", or "all". Default: "new"',
        }),
      ),
      account: Type.Optional(
        Type.String({ description: "Filter by account email address" }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const validStatuses = ["new", "surfaced", "deferred", "all"];
      const status = (typeof params.status === "string" ? params.status : "new") as DigestStatus | "all";
      if (!validStatuses.includes(status)) {
        return { content: [{ type: "text" as const, text: `Error: status must be one of: ${validStatuses.join(", ")}` }] };
      }
      const account = typeof params.account === "string" ? params.account : undefined;

      let grouped = digest.getGroupedByAccount(status);

      if (account) {
        grouped = { [account]: grouped[account] ?? [] };
      }

      // Build response first (while status is still "new")
      const summary: Record<string, unknown[]> = {};
      for (const [acc, entries] of Object.entries(grouped)) {
        summary[acc] = entries.map((e) => ({
          messageId: e.id,
          from: e.from,
          subject: e.subject,
          importance: e.importance,
          reason: e.reason,
          status: e.status,
          date: e.date,
          age: formatAge(e.firstSeenAt),
          body: e.body,
          deferredUntil: e.deferredUntil ?? undefined,
        }));
      }

      // THEN mark as surfaced
      for (const entries of Object.values(grouped)) {
        for (const entry of entries) {
          if (entry.status === "new") {
            digest.markSurfaced(entry.id);
          }
        }
      }

      await digest.save();

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    },
  };
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
