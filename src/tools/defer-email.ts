import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";

export function createDeferEmailTool(digest: DigestManager) {
  return {
    name: "defer_email",
    label: "Defer Email",
    description:
      "Defer an email — it will re-appear in the digest after the specified number of minutes. " +
      "Use this when the user can't deal with it right now (e.g., in a meeting).",
    parameters: Type.Object({
      messageId: Type.String({ description: "The message ID to defer" }),
      minutes: Type.Number({ description: "Minutes until the email re-surfaces in the digest" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      if (typeof params.messageId !== "string" || !params.messageId) {
        return { content: [{ type: "text" as const, text: "Error: messageId must be a non-empty string." }] };
      }
      if (typeof params.minutes !== "number" || params.minutes <= 0 || !Number.isFinite(params.minutes)) {
        return { content: [{ type: "text" as const, text: "Error: minutes must be a positive number." }] };
      }
      const messageId = params.messageId;
      const minutes = params.minutes;
      const entry = digest.get(messageId);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `Email ${messageId} not found in digest.` }] };
      }
      if (entry.status === "handled" || entry.status === "dismissed" || entry.status === "deferred") {
        return { content: [{ type: "text" as const, text: `Cannot defer: email is already "${entry.status}".` }] };
      }
      digest.defer(messageId, minutes);
      await digest.save();
      return {
        content: [{
          type: "text" as const,
          text: `Deferred "${entry.subject}" — will re-surface in ${minutes} minutes.`,
        }],
      };
    },
  };
}
