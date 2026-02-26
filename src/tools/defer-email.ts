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
      const messageId = params.messageId as string;
      const minutes = params.minutes as number;
      const entry = digest.get(messageId);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `Email ${messageId} not found in digest.` }] };
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
