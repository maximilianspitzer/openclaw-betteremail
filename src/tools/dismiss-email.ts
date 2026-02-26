import { Type } from "@sinclair/typebox";
import type { DigestManager } from "../digest.js";

export function createDismissEmailTool(digest: DigestManager) {
  return {
    name: "dismiss_email",
    label: "Dismiss Email",
    description: "Permanently dismiss an email from the digest. It will never be re-flagged.",
    parameters: Type.Object({
      messageId: Type.String({ description: "The message ID to dismiss" }),
      reason: Type.Optional(Type.String({ description: "Optional reason for dismissing" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const messageId = params.messageId as string;
      const entry = digest.get(messageId);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `Email ${messageId} not found in digest.` }] };
      }
      digest.dismiss(messageId);
      await digest.save();
      return {
        content: [{ type: "text" as const, text: `Dismissed "${entry.subject}" from ${entry.from}. It won't be flagged again.` }],
      };
    },
  };
}
