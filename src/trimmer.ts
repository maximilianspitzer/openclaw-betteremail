const DEFAULT_MAX_LENGTH = 3000;

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function trimEmailBody(raw: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (!raw || typeof raw !== "string") return "";

  let body = raw;

  // 1. Strip HTML tags
  body = body.replace(/<[^>]*>/g, "");

  // 2. Decode HTML entities
  body = body.replace(/&\w+;|&#\d+;/g, (match) => HTML_ENTITY_MAP[match] ?? match);

  // 3. Remove quoted reply chains ("On <date>, <person> wrote:")
  body = body.replace(/\n*On\s+.{10,80}\s+wrote:\s*\n(>[^\n]*\n?)*/gi, "");

  // 4. Remove > prefixed quote blocks
  body = body.replace(/\n*(?:^|\n)(>[^\n]*\n?)+/g, "");

  // 5. Remove email signatures (-- delimiter)
  body = body.replace(/\n--\s*\n[\s\S]*$/m, "");

  // 6. Remove "Sent from" signatures
  body = body.replace(/\n*Sent from my [\w\s]+$/i, "");
  body = body.replace(/\n*(?:Best regards|Kind regards|Regards|Cheers|Thanks|Best),?\s*\n[\s\S]{0,200}$/i, "");

  // 7. Remove legal disclaimers
  body = body.replace(/\n*(?:This email is confidential|CONFIDENTIALITY NOTICE|DISCLAIMER|If you (?:are not|received this in error))[\s\S]*$/i, "");

  // 8. Remove tracking pixels / image references
  body = body.replace(/\[(?:image|cid:[^\]]*)\]/gi, "");
  body = body.replace(/\[https?:\/\/[^\]]*\.(?:png|gif|jpg|jpeg|bmp)\]/gi, "");

  // 9. Collapse excessive whitespace
  body = body.replace(/\n{3,}/g, "\n\n");
  body = body.trim();

  // 10. Truncate
  if (body.length > maxLength) {
    body = body.slice(0, maxLength);
  }

  return body;
}
