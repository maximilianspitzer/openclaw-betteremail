import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";

export function createMarkEmailHandledTool(digest: DigestManager) {
  return {
    name: "mark_email_handled",
    label: "Mark Email Handled",
    description: "Mark an email as handled/dealt with. It will no longer appear in the digest.",
    parameters: Type.Object({
      messageId: Type.String({ description: "The message ID to mark as handled" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const messageId = params.messageId as string;
      const entry = digest.get(messageId);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `Email ${messageId} not found in digest.` }] };
      }
      digest.markHandled(messageId);
      await digest.save();
      return {
        content: [{ type: "text" as const, text: `Marked "${entry.subject}" from ${entry.from} as handled.` }],
      };
    },
  };
}
