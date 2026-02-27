import type { DigestManager } from "../digest.js";
import { formatAge } from "../utils.js";

export function createEmailsCommandHandler(digest: DigestManager) {
  return () => {
    const grouped = digest.getGroupedByAccount("all");
    const lines: string[] = [];

    lines.push("Email Digest");
    lines.push("\u2500".repeat(40));

    let hasContent = false;

    for (const [account, entries] of Object.entries(grouped)) {
      const newEntries = entries.filter((e) => e.status === "new");
      const surfaced = entries.filter((e) => e.status === "surfaced");
      const deferred = entries.filter((e) => e.status === "deferred");
      const handledToday = entries.filter(
        (e) => e.status === "handled" && e.resolvedAt &&
          new Date(e.resolvedAt).toDateString() === new Date().toDateString(),
      );

      const active = [...newEntries, ...surfaced];
      if (active.length === 0 && deferred.length === 0) {
        lines.push(`\n${account} — nothing new`);
        continue;
      }

      hasContent = true;
      lines.push(`\n${account} (${newEntries.length} new)`);

      for (const entry of active) {
        const imp = entry.importance === "high" ? "[HIGH]" : "[MED] ";
        const age = formatAge(entry.firstSeenAt);
        lines.push(`  ${imp} ${entry.subject} from ${entry.from} — ${age}`);
      }

      if (deferred.length > 0) {
        lines.push(`  ${deferred.length} deferred`);
      }
      if (handledToday.length > 0) {
        lines.push(`  ${handledToday.length} handled today`);
      }
    }

    if (!hasContent) {
      lines.push("\nNo pending emails across all accounts.");
    }

    return { text: lines.join("\n") };
  };
}
