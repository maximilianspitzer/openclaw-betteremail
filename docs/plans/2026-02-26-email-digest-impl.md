# BetterEmail Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an OpenClaw plugin that polls Gmail via `gog` CLI, deduplicates via history IDs, classifies importance via a headless agent instance, and exposes a digest to the main agent via tools and slash commands.

**Architecture:** Plugin-managed pipeline — poll → reply-detect → trim → classify → digest. Background service runs on an adaptive schedule. Main agent interacts via 4 registered tools and a `/emails` slash command. State persisted in JSON files in the plugin's state directory.

**Tech Stack:** TypeScript, OpenClaw plugin SDK (`openclaw/plugin-sdk`), `@sinclair/typebox` for tool parameter schemas, `gog` CLI for Gmail access, `runEmbeddedPiAgent` for classification, Vitest for testing.

**Reference:** BetterClaw plugin at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/` — follow the same patterns for plugin structure, state management, tool registration, and service lifecycle.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `openclaw.plugin.json`
- Create: `src/index.ts` (minimal stub)
- Create: `src/types.ts` (empty, will be filled in Task 2)

**Step 1: Create `package.json`**

```json
{
  "name": "@betteremail/betteremail",
  "version": "0.1.0",
  "description": "Email digest plugin for OpenClaw — polls Gmail, deduplicates, classifies importance, exposes digest to agent",
  "license": "AGPL-3.0-only",
  "type": "module",
  "openclaw": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create `openclaw.plugin.json`**

```json
{
  "id": "betteremail",
  "name": "BetterEmail Digest",
  "description": "Intelligent email digest — polls Gmail, deduplicates, classifies importance, exposes digest to agent",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "accounts": {
        "type": "array",
        "items": { "type": "string" },
        "default": []
      },
      "pollIntervalMinutes": {
        "type": "object",
        "properties": {
          "workHours": { "type": "number", "default": 5 },
          "offHours": { "type": "number", "default": 30 }
        },
        "default": { "workHours": 5, "offHours": 30 }
      },
      "workHours": {
        "type": "object",
        "properties": {
          "start": { "type": "number", "default": 9 },
          "end": { "type": "number", "default": 18 },
          "timezone": { "type": "string", "default": "Europe/London" }
        },
        "default": { "start": 9, "end": 18, "timezone": "Europe/London" }
      },
      "classifierTimeoutMs": {
        "type": "number",
        "default": 30000
      },
      "consecutiveFailuresBeforeAlert": {
        "type": "number",
        "default": 3
      },
      "rescanDaysOnHistoryReset": {
        "type": "number",
        "default": 7
      }
    }
  },
  "uiHints": {
    "accounts": { "label": "Gmail accounts to poll", "placeholder": "user@gmail.com" },
    "pollIntervalMinutes": { "label": "Poll intervals (minutes)" },
    "workHours": { "label": "Work hours schedule" },
    "classifierTimeoutMs": { "label": "Classifier timeout (ms)" },
    "consecutiveFailuresBeforeAlert": { "label": "Failures before alerting agent" }
  }
}
```

**Step 3: Create minimal `src/index.ts`**

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default {
  id: "betteremail",
  name: "BetterEmail Digest",

  register(api: OpenClawPluginApi) {
    api.logger.info("betteremail plugin loaded");
  },
};
```

**Step 4: Create empty `src/types.ts`**

```typescript
// Types will be added in Task 2
```

**Step 5: Install dependencies**

Run: `cd /Users/max/Documents/VSC_Projects/openclaw_betterEmail && npm install`

**Step 6: Commit**

```bash
git init
git add package.json openclaw.plugin.json src/index.ts src/types.ts
git commit -m "feat: scaffold BetterEmail plugin with config schema"
```

---

### Task 2: Type Definitions

**Files:**
- Modify: `src/types.ts`

**Step 1: Write all type definitions**

```typescript
// -- Plugin config --

export interface PollIntervalConfig {
  workHours: number;
  offHours: number;
}

export interface WorkHoursConfig {
  start: number;
  end: number;
  timezone: string;
}

export interface PluginConfig {
  accounts: string[];
  pollIntervalMinutes: PollIntervalConfig;
  workHours: WorkHoursConfig;
  classifierTimeoutMs: number;
  consecutiveFailuresBeforeAlert: number;
  rescanDaysOnHistoryReset: number;
}

// -- Raw email from gog CLI --

export interface RawGogMessage {
  id: string;
  threadId: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
  labelIds?: string[];
  [key: string]: unknown;
}

export interface RawGogThread {
  id: string;
  messages: RawGogMessage[];
}

// -- Trimmed email ready for classification --

export interface TrimmedEmail {
  id: string;
  threadId: string;
  account: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  threadLength: number;
  hasAttachments: boolean;
}

// -- Classification result --

export type ImportanceLevel = "high" | "medium" | "low";

export interface ClassificationResult {
  id: string;
  importance: ImportanceLevel;
  reason: string;
  notify: boolean;
}

// -- Digest entry --

export type DigestStatus = "new" | "surfaced" | "deferred" | "handled" | "dismissed";

export interface DigestEntry {
  id: string;
  threadId: string;
  account: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  importance: "high" | "medium";
  reason: string;
  notify: boolean;
  status: DigestStatus;
  firstSeenAt: string;
  surfacedAt?: string;
  deferredUntil?: string;
  resolvedAt?: string;
}

// -- Digest state file --

export interface DigestState {
  entries: Record<string, DigestEntry>;
}

// -- Polling state file --

export interface AccountState {
  historyId: string;
  lastPollAt: string;
  consecutiveFailures: number;
}

export interface PollState {
  accounts: Record<string, AccountState>;
  lastClassifierRunAt: string;
}

// -- Email log entry (emails.jsonl) --

export interface EmailLogEntry {
  email: TrimmedEmail;
  importance: ImportanceLevel;
  reason: string;
  notify: boolean;
  timestamp: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add all type definitions"
```

---

### Task 3: Email Log (events.jsonl equivalent)

**Files:**
- Create: `src/email-log.ts`
- Create: `test/email-log.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EmailLog } from "../src/email-log.js";
import type { EmailLogEntry, TrimmedEmail } from "../src/types.js";

function makeTrimmedEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    account: "test@gmail.com",
    from: "sender@example.com",
    to: "test@gmail.com",
    subject: "Test email",
    date: "2026-02-26T10:00:00Z",
    body: "Hello world",
    threadLength: 1,
    hasAttachments: false,
    ...overrides,
  };
}

describe("EmailLog", () => {
  let tmpDir: string;
  let log: EmailLog;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-test-"));
    log = new EmailLog(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("appends and reads entries", async () => {
    const entry: EmailLogEntry = {
      email: makeTrimmedEmail(),
      importance: "high",
      reason: "urgent",
      notify: true,
      timestamp: Date.now() / 1000,
    };
    await log.append(entry);
    const all = await log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].email.id).toBe("msg-1");
  });

  it("returns empty array when file does not exist", async () => {
    const all = await log.readAll();
    expect(all).toEqual([]);
  });

  it("checks if a message ID has been seen", async () => {
    const entry: EmailLogEntry = {
      email: makeTrimmedEmail({ id: "seen-msg" }),
      importance: "low",
      reason: "not important",
      notify: false,
      timestamp: Date.now() / 1000,
    };
    await log.append(entry);
    expect(await log.hasMessageId("seen-msg")).toBe(true);
    expect(await log.hasMessageId("unseen-msg")).toBe(false);
  });

  it("rotates old entries", async () => {
    // Append entries — more than we need to trigger rotation
    for (let i = 0; i < 5; i++) {
      await log.append({
        email: makeTrimmedEmail({ id: `msg-${i}` }),
        importance: "low",
        reason: "test",
        notify: false,
        timestamp: i < 3 ? 1000 : Date.now() / 1000, // first 3 are ancient
      });
    }
    const removed = await log.rotate(3); // max 3 lines
    expect(removed).toBeGreaterThan(0);
    const remaining = await log.readAll();
    expect(remaining.length).toBeLessThanOrEqual(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/max/Documents/VSC_Projects/openclaw_betterEmail && npx vitest run test/email-log.test.ts`
Expected: FAIL — `EmailLog` does not exist yet

**Step 3: Write the implementation**

Follow the exact same pattern as BetterClaw's `src/events.ts` (at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/events.ts`). Key differences:
- Entry type is `EmailLogEntry` instead of `EventLogEntry`
- Add `hasMessageId(id: string)` method that reads all entries and checks if any `entry.email.id === id`
- `rotate(maxLines)` parameter instead of hardcoded constant (still default to 10k)

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EmailLogEntry } from "./types.js";

const EMAILS_FILE = "emails.jsonl";
const DEFAULT_MAX_LINES = 10_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class EmailLog {
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, EMAILS_FILE);
  }

  async append(entry: EmailLogEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.filePath, line, "utf8");
  }

  async readAll(): Promise<EmailLogEntry[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as EmailLogEntry);
    } catch {
      return [];
    }
  }

  async hasMessageId(id: string): Promise<boolean> {
    const all = await this.readAll();
    return all.some((e) => e.email.id === id);
  }

  async rotate(maxLines: number = DEFAULT_MAX_LINES): Promise<number> {
    const entries = await this.readAll();
    if (entries.length <= maxLines) return 0;

    const cutoff = Date.now() / 1000 - MAX_AGE_MS / 1000;
    const kept = entries.filter((e) => e.timestamp >= cutoff).slice(-maxLines);
    const removed = entries.length - kept.length;

    const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.writeFile(this.filePath, content, "utf8");

    return removed;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/max/Documents/VSC_Projects/openclaw_betterEmail && npx vitest run test/email-log.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/email-log.ts test/email-log.test.ts
git commit -m "feat: add EmailLog with append, read, dedup lookup, and rotation"
```

---

### Task 4: Digest Manager

**Files:**
- Create: `src/digest.ts`
- Create: `test/digest.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import type { DigestEntry } from "../src/types.js";

function makeEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    id: "msg-1",
    threadId: "thread-1",
    account: "test@gmail.com",
    from: "sender@example.com",
    subject: "Test email",
    date: "2026-02-26T10:00:00Z",
    body: "Hello world",
    importance: "high",
    reason: "urgent matter",
    notify: true,
    status: "new",
    firstSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DigestManager", () => {
  let tmpDir: string;
  let digest: DigestManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-digest-"));
    digest = new DigestManager(tmpDir);
    await digest.load();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("adds and retrieves entries", async () => {
    digest.add(makeEntry());
    await digest.save();
    const entries = digest.getByStatus("new");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("msg-1");
  });

  it("transitions new → surfaced", () => {
    digest.add(makeEntry());
    digest.markSurfaced("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("surfaced");
    expect(entry?.surfacedAt).toBeDefined();
  });

  it("transitions surfaced → handled", () => {
    digest.add(makeEntry({ status: "surfaced" }));
    digest.markHandled("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("handled");
    expect(entry?.resolvedAt).toBeDefined();
  });

  it("transitions to deferred with timestamp", () => {
    digest.add(makeEntry({ status: "surfaced" }));
    digest.defer("msg-1", 30);
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("deferred");
    expect(entry?.deferredUntil).toBeDefined();
  });

  it("transitions to dismissed", () => {
    digest.add(makeEntry());
    digest.dismiss("msg-1");
    const entry = digest.get("msg-1");
    expect(entry?.status).toBe("dismissed");
    expect(entry?.resolvedAt).toBeDefined();
  });

  it("expires deferred entries back to new", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    digest.add(makeEntry({ status: "deferred", deferredUntil: pastTime }));
    const expired = digest.expireDeferrals();
    expect(expired).toHaveLength(1);
    expect(digest.get("msg-1")?.status).toBe("new");
  });

  it("does not expire future deferrals", () => {
    const futureTime = new Date(Date.now() + 60_000).toISOString();
    digest.add(makeEntry({ status: "deferred", deferredUntil: futureTime }));
    const expired = digest.expireDeferrals();
    expect(expired).toHaveLength(0);
    expect(digest.get("msg-1")?.status).toBe("deferred");
  });

  it("groups entries by account", () => {
    digest.add(makeEntry({ id: "msg-1", account: "work@co.com" }));
    digest.add(makeEntry({ id: "msg-2", account: "personal@gmail.com" }));
    digest.add(makeEntry({ id: "msg-3", account: "work@co.com" }));
    const grouped = digest.getGroupedByAccount("new");
    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["work@co.com"]).toHaveLength(2);
    expect(grouped["personal@gmail.com"]).toHaveLength(1);
  });

  it("persists to disk and reloads", async () => {
    digest.add(makeEntry());
    await digest.save();

    const digest2 = new DigestManager(tmpDir);
    await digest2.load();
    expect(digest2.get("msg-1")?.subject).toBe("Test email");
  });

  it("returns entries needing re-check (surfaced + deferred)", () => {
    digest.add(makeEntry({ id: "msg-1", status: "surfaced" }));
    digest.add(makeEntry({ id: "msg-2", status: "deferred" }));
    digest.add(makeEntry({ id: "msg-3", status: "handled" }));
    digest.add(makeEntry({ id: "msg-4", status: "new" }));
    const needCheck = digest.getActiveThreadIds();
    expect(needCheck).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/digest.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Follow `ContextManager` pattern from BetterClaw (`/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/context.ts`) for load/save. The digest manager is the central state machine.

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DigestEntry, DigestState, DigestStatus } from "./types.js";

const DIGEST_FILE = "digest.json";

export class DigestManager {
  private filePath: string;
  private state: DigestState;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, DIGEST_FILE);
    this.state = { entries: {} };
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as DigestState;
    } catch {
      this.state = { entries: {} };
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }

  add(entry: DigestEntry): void {
    this.state.entries[entry.id] = entry;
  }

  get(id: string): DigestEntry | undefined {
    return this.state.entries[id];
  }

  has(id: string): boolean {
    return id in this.state.entries;
  }

  getByStatus(status: DigestStatus | "all"): DigestEntry[] {
    const entries = Object.values(this.state.entries);
    if (status === "all") return entries;
    return entries.filter((e) => e.status === status);
  }

  getGroupedByAccount(status: DigestStatus | "all"): Record<string, DigestEntry[]> {
    const entries = this.getByStatus(status);
    const grouped: Record<string, DigestEntry[]> = {};
    for (const entry of entries) {
      if (!grouped[entry.account]) grouped[entry.account] = [];
      grouped[entry.account].push(entry);
    }
    return grouped;
  }

  getActiveThreadIds(): DigestEntry[] {
    return Object.values(this.state.entries).filter(
      (e) => e.status === "surfaced" || e.status === "deferred",
    );
  }

  markSurfaced(id: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "surfaced";
      entry.surfacedAt = new Date().toISOString();
    }
  }

  markHandled(id: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "handled";
      entry.resolvedAt = new Date().toISOString();
    }
  }

  defer(id: string, minutes: number): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "deferred";
      entry.deferredUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    }
  }

  dismiss(id: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "dismissed";
      entry.resolvedAt = new Date().toISOString();
    }
  }

  expireDeferrals(): DigestEntry[] {
    const now = new Date();
    const expired: DigestEntry[] = [];
    for (const entry of Object.values(this.state.entries)) {
      if (entry.status === "deferred" && entry.deferredUntil && new Date(entry.deferredUntil) <= now) {
        entry.status = "new";
        entry.deferredUntil = undefined;
        expired.push(entry);
      }
    }
    return expired;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/digest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/digest.ts test/digest.test.ts
git commit -m "feat: add DigestManager with lifecycle state machine and persistence"
```

---

### Task 5: Body Trimmer

**Files:**
- Create: `src/trimmer.ts`
- Create: `test/trimmer.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { trimEmailBody } from "../src/trimmer.js";

describe("trimEmailBody", () => {
  it("strips HTML tags", () => {
    expect(trimEmailBody("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(trimEmailBody("&amp; &lt; &gt; &quot; &#39;")).toBe("& < > \" '");
  });

  it("removes quoted reply chains", () => {
    const body = "Thanks for the update.\n\nOn Mon, Feb 24, 2026, John wrote:\n> Original message\n> More text";
    expect(trimEmailBody(body)).toBe("Thanks for the update.");
  });

  it("removes > prefixed quote blocks", () => {
    const body = "My reply.\n\n> quoted line 1\n> quoted line 2\n> quoted line 3";
    expect(trimEmailBody(body)).toBe("My reply.");
  });

  it("removes common email signatures", () => {
    const body = "Main content.\n\n--\nJohn Smith\nCEO, Company Inc.";
    expect(trimEmailBody(body)).toBe("Main content.");
  });

  it("removes 'Sent from' signatures", () => {
    const body = "Quick reply.\n\nSent from my iPhone";
    expect(trimEmailBody(body)).toBe("Quick reply.");
  });

  it("removes legal disclaimers", () => {
    const body = "Actual content.\n\nThis email is confidential and intended solely for the use of the individual.";
    expect(trimEmailBody(body)).toBe("Actual content.");
  });

  it("removes tracking pixels and image references", () => {
    const body = "Content here.\n\n[image]\n[cid:abc123]";
    expect(trimEmailBody(body)).toBe("Content here.");
  });

  it("collapses excessive whitespace", () => {
    const body = "Line 1.\n\n\n\n\n\nLine 2.";
    expect(trimEmailBody(body)).toBe("Line 1.\n\nLine 2.");
  });

  it("truncates to max length", () => {
    const body = "A".repeat(5000);
    const result = trimEmailBody(body, 3000);
    expect(result.length).toBeLessThanOrEqual(3000);
  });

  it("handles empty input", () => {
    expect(trimEmailBody("")).toBe("");
    expect(trimEmailBody(undefined as any)).toBe("");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/trimmer.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/trimmer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/trimmer.ts test/trimmer.test.ts
git commit -m "feat: add email body trimmer with HTML stripping, quote removal, and signature detection"
```

---

### Task 6: Gmail Poller

**Files:**
- Create: `src/poller.ts`
- Create: `test/poller.test.ts`

**Step 1: Write the failing test**

Test the poller's parsing and reply-detection logic. Mock the `gog` CLI calls since we can't run them in tests.

```typescript
import { describe, it, expect } from "vitest";
import { detectOwnerReply, parseGogMessages, parseGogThread } from "../src/poller.js";
import type { RawGogMessage, RawGogThread } from "../src/types.js";

describe("parseGogMessages", () => {
  it("parses gog JSON output into RawGogMessage array", () => {
    const raw = JSON.stringify([
      { id: "msg-1", threadId: "t-1", subject: "Hello", from: "sender@test.com", date: "2026-02-26" },
    ]);
    const result = parseGogMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-1");
  });

  it("handles empty output", () => {
    expect(parseGogMessages("")).toEqual([]);
    expect(parseGogMessages("[]")).toEqual([]);
  });

  it("handles single object (not array)", () => {
    const raw = JSON.stringify({ id: "msg-1", threadId: "t-1" });
    const result = parseGogMessages(raw);
    expect(result).toHaveLength(1);
  });
});

describe("detectOwnerReply", () => {
  const ownerAccounts = ["me@work.com", "me@personal.com"];

  it("returns true when owner has replied", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "other@example.com" },
        { id: "msg-2", threadId: "t-1", from: "me@work.com" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(true);
  });

  it("returns false when owner has not replied", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "other@example.com" },
        { id: "msg-2", threadId: "t-1", from: "another@example.com" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(false);
  });

  it("handles 'Name <email>' format in from field", () => {
    const thread: RawGogThread = {
      id: "t-1",
      messages: [
        { id: "msg-1", threadId: "t-1", from: "Other Person <other@example.com>" },
        { id: "msg-2", threadId: "t-1", from: "My Name <me@personal.com>" },
      ],
    };
    expect(detectOwnerReply(thread, ownerAccounts)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/poller.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

The poller wraps `gog` CLI calls via `api.runtime.system.runCommandWithTimeout`. The test-facing functions (parsing, reply detection) are pure and exported separately.

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { RawGogMessage, RawGogThread, PollState, TrimmedEmail } from "./types.js";
import { trimEmailBody } from "./trimmer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const STATE_FILE = "state.json";

export function parseGogMessages(stdout: string): RawGogMessage[] {
  if (!stdout || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && parsed.id) return [parsed];
    return [];
  } catch {
    return [];
  }
}

export function parseGogThread(stdout: string): RawGogThread | null {
  if (!stdout || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && parsed.id && Array.isArray(parsed.messages)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractEmail(fromField: string): string {
  const match = fromField.match(/<([^>]+)>/);
  return (match ? match[1] : fromField).toLowerCase().trim();
}

export function detectOwnerReply(thread: RawGogThread, ownerAccounts: string[]): boolean {
  const lowerAccounts = ownerAccounts.map((a) => a.toLowerCase());
  return thread.messages.some((msg) => {
    if (!msg.from) return false;
    const email = extractEmail(msg.from);
    return lowerAccounts.includes(email);
  });
}

export class Poller {
  private api: OpenClawPluginApi;
  private stateDir: string;
  private accounts: string[];
  private rescanDays: number;
  private state: PollState;

  constructor(api: OpenClawPluginApi, stateDir: string, accounts: string[], rescanDays: number) {
    this.api = api;
    this.stateDir = stateDir;
    this.accounts = accounts;
    this.rescanDays = rescanDays;
    this.state = { accounts: {}, lastClassifierRunAt: "" };
  }

  async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.stateDir, STATE_FILE), "utf8");
      this.state = JSON.parse(raw) as PollState;
    } catch {
      this.state = { accounts: {}, lastClassifierRunAt: "" };
    }
  }

  async saveState(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(
      path.join(this.stateDir, STATE_FILE),
      JSON.stringify(this.state, null, 2) + "\n",
      "utf8",
    );
  }

  getAccountState(account: string) {
    return this.state.accounts[account];
  }

  recordSuccess(account: string, historyId: string): void {
    this.state.accounts[account] = {
      historyId,
      lastPollAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };
  }

  recordFailure(account: string): number {
    const existing = this.state.accounts[account];
    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    this.state.accounts[account] = {
      historyId: existing?.historyId ?? "",
      lastPollAt: existing?.lastPollAt ?? "",
      consecutiveFailures: failures,
    };
    return failures;
  }

  async runGog(args: string[]): Promise<{ stdout: string; ok: boolean }> {
    try {
      const result = await this.api.runtime.system.runCommandWithTimeout(
        ["gog", ...args],
        { timeoutMs: 30_000 },
      );
      if (result.code !== 0) {
        this.api.logger.warn(`betteremail: gog failed (code ${result.code}): ${result.stderr?.slice(0, 200)}`);
        return { stdout: "", ok: false };
      }
      return { stdout: result.stdout ?? "", ok: true };
    } catch (err) {
      this.api.logger.error(`betteremail: gog error: ${err instanceof Error ? err.message : String(err)}`);
      return { stdout: "", ok: false };
    }
  }

  async pollAccount(account: string, seenMessageIds: Set<string>): Promise<TrimmedEmail[]> {
    const accountState = this.state.accounts[account];
    const historyId = accountState?.historyId;

    let messages: RawGogMessage[];

    if (historyId) {
      // Incremental sync
      const result = await this.runGog([
        "gmail", "history", "--since", historyId, "--account", account, "--json",
      ]);
      if (!result.ok) {
        // History ID may be invalid — fall back to rescan
        this.api.logger.info(`betteremail: history fetch failed for ${account}, falling back to rescan`);
        const fallback = await this.runGog([
          "gmail", "messages", "search", `newer_than:${this.rescanDays}d`,
          "--account", account, "--json", "--include-body",
        ]);
        if (!fallback.ok) return [];
        messages = parseGogMessages(fallback.stdout);
      } else {
        messages = parseGogMessages(result.stdout);
      }
    } else {
      // First run — rescan
      const result = await this.runGog([
        "gmail", "messages", "search", `newer_than:${this.rescanDays}d`,
        "--account", account, "--json", "--include-body",
      ]);
      if (!result.ok) return [];
      messages = parseGogMessages(result.stdout);
    }

    // Dedup against already-processed messages
    const newMessages = messages.filter((m) => !seenMessageIds.has(m.id));

    // For each new message, fetch thread and check for owner reply
    const trimmedEmails: TrimmedEmail[] = [];

    for (const msg of newMessages) {
      const threadResult = await this.runGog([
        "gmail", "thread", "get", msg.threadId, "--account", account, "--json",
      ]);

      if (threadResult.ok) {
        const thread = parseGogThread(threadResult.stdout);
        if (thread && detectOwnerReply(thread, this.accounts)) {
          continue; // Owner already replied — skip
        }
      }

      trimmedEmails.push({
        id: msg.id,
        threadId: msg.threadId,
        account,
        from: msg.from ?? "unknown",
        to: msg.to ?? account,
        subject: msg.subject ?? "(no subject)",
        date: msg.date ?? new Date().toISOString(),
        body: trimEmailBody(msg.body ?? ""),
        threadLength: threadResult.ok ? (parseGogThread(threadResult.stdout)?.messages.length ?? 1) : 1,
        hasAttachments: Array.isArray(msg.labelIds) && msg.labelIds.includes("ATTACHMENT"),
      });
    }

    return trimmedEmails;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/poller.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/poller.ts test/poller.test.ts
git commit -m "feat: add Gmail poller with history ID sync, reply detection, and fallback rescan"
```

---

### Task 7: Classifier

**Files:**
- Create: `src/classifier.ts`
- Create: `test/classifier.test.ts`

**Step 1: Write the failing test**

Test prompt building and result parsing (pure functions). The actual `runEmbeddedPiAgent` call is tested via integration, not unit tests.

```typescript
import { describe, it, expect } from "vitest";
import { buildClassifierPrompt, parseClassifierResponse } from "../src/classifier.js";
import type { TrimmedEmail } from "../src/types.js";

function makeEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    account: "test@gmail.com",
    from: "sender@example.com",
    to: "test@gmail.com",
    subject: "Test email",
    date: "2026-02-26T10:00:00Z",
    body: "Hello world",
    threadLength: 1,
    hasAttachments: false,
    ...overrides,
  };
}

describe("buildClassifierPrompt", () => {
  it("includes all emails in the prompt", () => {
    const emails = [makeEmail({ id: "msg-1" }), makeEmail({ id: "msg-2", subject: "Second" })];
    const prompt = buildClassifierPrompt(emails);
    expect(prompt).toContain("msg-1");
    expect(prompt).toContain("msg-2");
    expect(prompt).toContain("Second");
  });

  it("requests JSON array response", () => {
    const prompt = buildClassifierPrompt([makeEmail()]);
    expect(prompt).toContain("JSON");
  });
});

describe("parseClassifierResponse", () => {
  it("parses valid JSON array response", () => {
    const text = JSON.stringify([
      { id: "msg-1", importance: "high", reason: "urgent", notify: true },
    ]);
    const results = parseClassifierResponse(text, ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("high");
  });

  it("handles code-fenced JSON", () => {
    const text = "```json\n" + JSON.stringify([
      { id: "msg-1", importance: "medium", reason: "routine", notify: false },
    ]) + "\n```";
    const results = parseClassifierResponse(text, ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("medium");
  });

  it("fails open on invalid JSON — returns all as high", () => {
    const results = parseClassifierResponse("garbage output", ["msg-1", "msg-2"]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.importance === "high" && r.notify === true)).toBe(true);
  });

  it("fails open on empty response", () => {
    const results = parseClassifierResponse("", ["msg-1"]);
    expect(results).toHaveLength(1);
    expect(results[0].importance).toBe("high");
  });

  it("fills missing IDs with fail-open defaults", () => {
    const text = JSON.stringify([
      { id: "msg-1", importance: "low", reason: "spam", notify: false },
    ]);
    // msg-2 is missing from response
    const results = parseClassifierResponse(text, ["msg-1", "msg-2"]);
    expect(results).toHaveLength(2);
    const msg2 = results.find((r) => r.id === "msg-2");
    expect(msg2?.importance).toBe("high");
    expect(msg2?.notify).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/classifier.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Follow BetterClaw's `judgment.ts` pattern at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/judgment.ts`. Key differences:
- Batched emails instead of single event
- Returns array of `ClassificationResult`
- Uses main agent config (no separate provider/model — uses agent's default)

```typescript
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
    "- importance: \"high\" | \"medium\" | \"low\"",
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

    // Fill missing IDs with fail-open defaults
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/classifier.ts test/classifier.test.ts
git commit -m "feat: add classifier with batched prompt building, fail-open parsing, and embedded agent invocation"
```

---

### Task 8: Pipeline

**Files:**
- Create: `src/pipeline.ts`
- Create: `test/pipeline.test.ts`

**Step 1: Write the failing test**

Test the pipeline orchestration with mocked dependencies.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { TrimmedEmail, ClassificationResult, DigestEntry } from "../src/types.js";

function makeEmail(overrides: Partial<TrimmedEmail> = {}): TrimmedEmail {
  return {
    id: "msg-1", threadId: "t-1", account: "test@gmail.com",
    from: "sender@test.com", to: "test@gmail.com", subject: "Test",
    date: "2026-02-26T10:00:00Z", body: "Hello", threadLength: 1, hasAttachments: false,
    ...overrides,
  };
}

describe("runPipeline", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockRunCommand = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

  let mockDigest: any;
  let mockEmailLog: any;
  let mockPoller: any;
  let mockClassifier: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDigest = {
      load: vi.fn(),
      save: vi.fn(),
      add: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      getActiveThreadIds: vi.fn().mockReturnValue([]),
      expireDeferrals: vi.fn().mockReturnValue([]),
      markHandled: vi.fn(),
    };

    mockEmailLog = {
      append: vi.fn(),
      hasMessageId: vi.fn().mockResolvedValue(false),
    };

    mockPoller = {
      loadState: vi.fn(),
      saveState: vi.fn(),
      pollAccount: vi.fn().mockResolvedValue([makeEmail()]),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
    };

    mockClassifier = {
      classify: vi.fn().mockResolvedValue([
        { id: "msg-1", importance: "high", reason: "urgent", notify: true } as ClassificationResult,
      ]),
    };
  });

  it("polls accounts, classifies, and adds to digest", async () => {
    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockPoller.pollAccount).toHaveBeenCalledWith("test@gmail.com", expect.any(Set));
    expect(mockClassifier.classify).toHaveBeenCalledWith([expect.objectContaining({ id: "msg-1" })]);
    expect(mockDigest.add).toHaveBeenCalled();
    expect(mockEmailLog.append).toHaveBeenCalled();
  });

  it("skips emails already in digest", async () => {
    mockDigest.has.mockReturnValue(true);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockClassifier.classify).toHaveBeenCalledWith([]);
  });

  it("only adds high/medium to digest, logs all to emailLog", async () => {
    mockPoller.pollAccount.mockResolvedValue([
      makeEmail({ id: "msg-1" }),
      makeEmail({ id: "msg-2" }),
    ]);
    mockClassifier.classify.mockResolvedValue([
      { id: "msg-1", importance: "high", reason: "urgent", notify: true },
      { id: "msg-2", importance: "low", reason: "spam", notify: false },
    ]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    // Both logged
    expect(mockEmailLog.append).toHaveBeenCalledTimes(2);
    // Only high added to digest
    expect(mockDigest.add).toHaveBeenCalledTimes(1);
  });

  it("pushes high+notify emails to main agent", async () => {
    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["openclaw", "agent", "--deliver"]),
      expect.any(Object),
    );
  });

  it("expires deferrals each cycle", async () => {
    mockPoller.pollAccount.mockResolvedValue([]);
    mockDigest.expireDeferrals.mockReturnValue([{ id: "deferred-1" }]);

    await runPipeline({
      accounts: ["test@gmail.com"],
      poller: mockPoller,
      classifier: mockClassifier,
      digest: mockDigest,
      emailLog: mockEmailLog,
      logger: mockLogger,
      runCommand: mockRunCommand,
      consecutiveFailuresBeforeAlert: 3,
    });

    expect(mockDigest.expireDeferrals).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/pipeline.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Follow BetterClaw's `pipeline.ts` pattern at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/pipeline.ts`.

```typescript
import type { TrimmedEmail, ClassificationResult, DigestEntry, EmailLogEntry } from "./types.js";

export interface PipelineDeps {
  accounts: string[];
  poller: {
    loadState(): Promise<void>;
    saveState(): Promise<void>;
    pollAccount(account: string, seenMessageIds: Set<string>): Promise<TrimmedEmail[]>;
    recordSuccess(account: string, historyId: string): void;
    recordFailure(account: string): number;
  };
  classifier: {
    classify(emails: TrimmedEmail[]): Promise<ClassificationResult[]>;
  };
  digest: {
    load(): Promise<void>;
    save(): Promise<void>;
    add(entry: DigestEntry): void;
    has(id: string): boolean;
    getActiveThreadIds(): DigestEntry[];
    expireDeferrals(): DigestEntry[];
    markHandled(id: string): void;
  };
  emailLog: {
    append(entry: EmailLogEntry): Promise<void>;
    hasMessageId(id: string): Promise<boolean>;
  };
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  runCommand: (args: string[], opts: { timeoutMs: number }) => Promise<{ code: number; stdout?: string; stderr?: string }>;
  consecutiveFailuresBeforeAlert: number;
}

const BATCH_SIZE = 10;

export async function runPipeline(deps: PipelineDeps): Promise<void> {
  const { accounts, poller, classifier, digest, emailLog, logger } = deps;

  await poller.loadState();
  await digest.load();

  // Expire deferred emails
  const expired = digest.expireDeferrals();
  if (expired.length > 0) {
    logger.info(`betteremail: ${expired.length} deferred email(s) re-entered digest`);
  }

  // Collect new emails from all accounts
  const allNewEmails: TrimmedEmail[] = [];

  for (const account of accounts) {
    try {
      const emails = await poller.pollAccount(account, new Set());
      // Filter out emails already in digest
      const filtered = emails.filter((e) => !digest.has(e.id));
      allNewEmails.push(...filtered);
      logger.info(`betteremail: ${account} — ${emails.length} fetched, ${filtered.length} new`);
    } catch (err) {
      const failures = poller.recordFailure(account);
      logger.error(`betteremail: poll failed for ${account}: ${err instanceof Error ? err.message : String(err)}`);

      if (failures >= deps.consecutiveFailuresBeforeAlert) {
        try {
          await deps.runCommand(
            [
              "openclaw", "agent",
              "--session-id", "main",
              "--deliver",
              "--message", `[BetterEmail] Gmail polling has failed ${failures} times in a row for ${account}. Likely auth token expiry — please re-authenticate gog.`,
            ],
            { timeoutMs: 30_000 },
          );
        } catch {
          logger.error("betteremail: failed to alert agent about polling failures");
        }
      }
    }
  }

  if (allNewEmails.length === 0) {
    await digest.save();
    await poller.saveState();
    return;
  }

  // Classify in batches
  for (let i = 0; i < allNewEmails.length; i += BATCH_SIZE) {
    const batch = allNewEmails.slice(i, i + BATCH_SIZE);
    const results = await classifier.classify(batch);

    for (let j = 0; j < batch.length; j++) {
      const email = batch[j];
      const result = results[j];

      // Log every email
      await emailLog.append({
        email,
        importance: result.importance,
        reason: result.reason,
        notify: result.notify,
        timestamp: Date.now() / 1000,
      });

      // Only add high/medium to digest
      if (result.importance === "high" || result.importance === "medium") {
        const entry: DigestEntry = {
          id: email.id,
          threadId: email.threadId,
          account: email.account,
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: email.body,
          importance: result.importance,
          reason: result.reason,
          notify: result.notify,
          status: "new",
          firstSeenAt: new Date().toISOString(),
        };
        digest.add(entry);

        // Push high+notify to main agent
        if (result.importance === "high" && result.notify) {
          const message = formatPushMessage(email, result);
          try {
            await deps.runCommand(
              [
                "openclaw", "agent",
                "--session-id", "main",
                "--deliver",
                "--message", message,
              ],
              { timeoutMs: 30_000 },
            );
            logger.info(`betteremail: pushed ${email.id} to agent`);
          } catch (err) {
            logger.error(`betteremail: failed to push to agent: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }

  await digest.save();
  await poller.saveState();
}

function formatPushMessage(email: TrimmedEmail, result: ClassificationResult): string {
  return [
    "[BetterEmail] New high-importance email:",
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Account: ${email.account}`,
    `Date: ${email.date}`,
    `Reason: ${result.reason}`,
    `MessageID: ${email.id}`,
    "",
    "Use defer_email to postpone or mark_email_handled when resolved.",
  ].join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/pipeline.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline.ts test/pipeline.test.ts
git commit -m "feat: add pipeline orchestrator — poll, classify, digest, push, with failure alerting"
```

---

### Task 9: Adaptive Scheduler

**Files:**
- Create: `src/scheduler.ts`
- Create: `test/scheduler.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { getIntervalMs, isWorkHours } from "../src/scheduler.js";
import type { WorkHoursConfig, PollIntervalConfig } from "../src/types.js";

describe("isWorkHours", () => {
  const config: WorkHoursConfig = { start: 9, end: 18, timezone: "UTC" };

  it("returns true during work hours", () => {
    const noon = new Date("2026-02-26T12:00:00Z");
    expect(isWorkHours(noon, config)).toBe(true);
  });

  it("returns false outside work hours", () => {
    const lateNight = new Date("2026-02-26T23:00:00Z");
    expect(isWorkHours(lateNight, config)).toBe(false);
  });

  it("returns true at start boundary", () => {
    const start = new Date("2026-02-26T09:00:00Z");
    expect(isWorkHours(start, config)).toBe(true);
  });

  it("returns false at end boundary", () => {
    const end = new Date("2026-02-26T18:00:00Z");
    expect(isWorkHours(end, config)).toBe(false);
  });
});

describe("getIntervalMs", () => {
  const intervals: PollIntervalConfig = { workHours: 5, offHours: 30 };
  const workConfig: WorkHoursConfig = { start: 9, end: 18, timezone: "UTC" };

  it("returns work interval during work hours", () => {
    const noon = new Date("2026-02-26T12:00:00Z");
    expect(getIntervalMs(noon, intervals, workConfig)).toBe(5 * 60 * 1000);
  });

  it("returns off-hours interval outside work hours", () => {
    const night = new Date("2026-02-26T23:00:00Z");
    expect(getIntervalMs(night, intervals, workConfig)).toBe(30 * 60 * 1000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/scheduler.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
import type { WorkHoursConfig, PollIntervalConfig } from "./types.js";

export function isWorkHours(now: Date, config: WorkHoursConfig): boolean {
  // Get the hour in the configured timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: config.timezone,
  });
  const hour = parseInt(formatter.format(now), 10);
  return hour >= config.start && hour < config.end;
}

export function getIntervalMs(
  now: Date,
  intervals: PollIntervalConfig,
  workConfig: WorkHoursConfig,
): number {
  const minutes = isWorkHours(now, workConfig) ? intervals.workHours : intervals.offHours;
  return minutes * 60 * 1000;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private intervals: PollIntervalConfig;
  private workConfig: WorkHoursConfig;
  private onTick: () => Promise<void>;

  constructor(
    intervals: PollIntervalConfig,
    workConfig: WorkHoursConfig,
    onTick: () => Promise<void>,
  ) {
    this.intervals = intervals;
    this.workConfig = workConfig;
    this.onTick = onTick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const interval = getIntervalMs(new Date(), this.intervals, this.workConfig);
    this.timer = setTimeout(async () => {
      try {
        await this.onTick();
      } catch {
        // Pipeline handles its own errors — scheduler just keeps going
      }
      this.scheduleNext();
    }, interval);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/scheduler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scheduler.ts test/scheduler.test.ts
git commit -m "feat: add adaptive scheduler with work-hours-aware polling intervals"
```

---

### Task 10: Agent Tools

**Files:**
- Create: `src/tools/get-email-digest.ts`
- Create: `src/tools/mark-email-handled.ts`
- Create: `src/tools/defer-email.ts`
- Create: `src/tools/dismiss-email.ts`

**Step 1: Create all four tools**

Follow the BetterClaw tool pattern at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/tools/get-context.ts`. Use `@sinclair/typebox` for parameter schemas.

**`src/tools/get-email-digest.ts`:**
```typescript
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
      const status = (typeof params.status === "string" ? params.status : "new") as DigestStatus | "all";
      const account = typeof params.account === "string" ? params.account : undefined;

      let grouped = digest.getGroupedByAccount(status);

      if (account) {
        grouped = { [account]: grouped[account] ?? [] };
      }

      // Mark returned "new" entries as "surfaced"
      for (const entries of Object.values(grouped)) {
        for (const entry of entries) {
          if (entry.status === "new") {
            digest.markSurfaced(entry.id);
          }
        }
      }

      // Format for agent consumption
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
```

**`src/tools/mark-email-handled.ts`:**
```typescript
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
```

**`src/tools/defer-email.ts`:**
```typescript
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
```

**`src/tools/dismiss-email.ts`:**
```typescript
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
```

**Step 2: Commit**

```bash
git add src/tools/
git commit -m "feat: add agent tools — get_email_digest, mark_email_handled, defer_email, dismiss_email"
```

---

### Task 11: Slash Command

**Files:**
- Modify: `src/index.ts` (will be done in Task 12, but define the handler here)
- Create: `src/commands/emails.ts`

**Step 1: Create the `/emails` command handler**

```typescript
import type { DigestManager } from "../digest.js";

export function createEmailsCommandHandler(digest: DigestManager) {
  return () => {
    const grouped = digest.getGroupedByAccount("all");
    const lines: string[] = [];

    lines.push("Email Digest");
    lines.push("─".repeat(40));

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

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

**Step 2: Commit**

```bash
git add src/commands/emails.ts
git commit -m "feat: add /emails slash command handler"
```

---

### Task 12: Wire Everything in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Wire all components together**

Replace the stub `src/index.ts` with the full registration. Follow the BetterClaw `index.ts` pattern at `/Users/max/Documents/VSC_Projects/betterclaw-plugin/src/index.ts`.

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "./types.js";
import { DigestManager } from "./digest.js";
import { EmailLog } from "./email-log.js";
import { Poller } from "./poller.js";
import { Classifier } from "./classifier.js";
import { Scheduler } from "./scheduler.js";
import { runPipeline } from "./pipeline.js";
import { createGetEmailDigestTool } from "./tools/get-email-digest.js";
import { createMarkEmailHandledTool } from "./tools/mark-email-handled.js";
import { createDeferEmailTool } from "./tools/defer-email.js";
import { createDismissEmailTool } from "./tools/dismiss-email.js";
import { createEmailsCommandHandler } from "./commands/emails.js";

const DEFAULT_CONFIG: PluginConfig = {
  accounts: [],
  pollIntervalMinutes: { workHours: 5, offHours: 30 },
  workHours: { start: 9, end: 18, timezone: "Europe/London" },
  classifierTimeoutMs: 30_000,
  consecutiveFailuresBeforeAlert: 3,
  rescanDaysOnHistoryReset: 7,
};

function resolveConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  return {
    accounts: Array.isArray(raw?.accounts) ? (raw.accounts as string[]) : DEFAULT_CONFIG.accounts,
    pollIntervalMinutes:
      raw?.pollIntervalMinutes && typeof raw.pollIntervalMinutes === "object"
        ? {
            workHours: typeof (raw.pollIntervalMinutes as any).workHours === "number"
              ? (raw.pollIntervalMinutes as any).workHours
              : DEFAULT_CONFIG.pollIntervalMinutes.workHours,
            offHours: typeof (raw.pollIntervalMinutes as any).offHours === "number"
              ? (raw.pollIntervalMinutes as any).offHours
              : DEFAULT_CONFIG.pollIntervalMinutes.offHours,
          }
        : DEFAULT_CONFIG.pollIntervalMinutes,
    workHours:
      raw?.workHours && typeof raw.workHours === "object"
        ? {
            start: typeof (raw.workHours as any).start === "number"
              ? (raw.workHours as any).start
              : DEFAULT_CONFIG.workHours.start,
            end: typeof (raw.workHours as any).end === "number"
              ? (raw.workHours as any).end
              : DEFAULT_CONFIG.workHours.end,
            timezone: typeof (raw.workHours as any).timezone === "string"
              ? (raw.workHours as any).timezone
              : DEFAULT_CONFIG.workHours.timezone,
          }
        : DEFAULT_CONFIG.workHours,
    classifierTimeoutMs:
      typeof raw?.classifierTimeoutMs === "number" ? raw.classifierTimeoutMs : DEFAULT_CONFIG.classifierTimeoutMs,
    consecutiveFailuresBeforeAlert:
      typeof raw?.consecutiveFailuresBeforeAlert === "number"
        ? raw.consecutiveFailuresBeforeAlert
        : DEFAULT_CONFIG.consecutiveFailuresBeforeAlert,
    rescanDaysOnHistoryReset:
      typeof raw?.rescanDaysOnHistoryReset === "number"
        ? raw.rescanDaysOnHistoryReset
        : DEFAULT_CONFIG.rescanDaysOnHistoryReset,
  };
}

export default {
  id: "betteremail",
  name: "BetterEmail Digest",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig as Record<string, unknown> | undefined);
    const stateDir = api.runtime.state.resolveStateDir();

    api.logger.info(
      `betteremail plugin loaded (accounts=${config.accounts.length}, ` +
      `workHours=${config.pollIntervalMinutes.workHours}m, offHours=${config.pollIntervalMinutes.offHours}m)`,
    );

    if (config.accounts.length === 0) {
      api.logger.warn("betteremail: no accounts configured — plugin will not poll");
      return;
    }

    // Core managers
    const digest = new DigestManager(stateDir);
    const emailLog = new EmailLog(stateDir);
    const poller = new Poller(api, stateDir, config.accounts, config.rescanDaysOnHistoryReset);
    const classifier = new Classifier(api, config.classifierTimeoutMs);

    // Async init
    let initialized = false;
    const initPromise = (async () => {
      try {
        await digest.load();
        await poller.loadState();
        initialized = true;
        api.logger.info("betteremail: async init complete");
      } catch (err) {
        api.logger.error(`betteremail: init failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();

    // Agent tools
    api.registerTool(createGetEmailDigestTool(digest), { optional: true });
    api.registerTool(createMarkEmailHandledTool(digest), { optional: true });
    api.registerTool(createDeferEmailTool(digest), { optional: true });
    api.registerTool(createDismissEmailTool(digest), { optional: true });

    // Slash command
    api.registerCommand({
      name: "emails",
      description: "Show current email digest status across all accounts",
      handler: createEmailsCommandHandler(digest),
    });

    // Pipeline runner
    const runOnce = async () => {
      if (!initialized) await initPromise;

      await runPipeline({
        accounts: config.accounts,
        poller,
        classifier,
        digest,
        emailLog,
        logger: api.logger,
        runCommand: (args, opts) => api.runtime.system.runCommandWithTimeout(args, opts),
        consecutiveFailuresBeforeAlert: config.consecutiveFailuresBeforeAlert,
      });

      // Rotate email log periodically
      await emailLog.rotate();
    };

    // Scheduler
    const scheduler = new Scheduler(
      config.pollIntervalMinutes,
      config.workHours,
      runOnce,
    );

    // Background service
    api.registerService({
      id: "betteremail-poller",
      start: () => {
        scheduler.start();
        api.logger.info("betteremail: polling service started");
      },
      stop: () => {
        scheduler.stop();
        api.logger.info("betteremail: polling service stopped");
      },
    });
  },
};
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire all components in plugin entry — tools, command, pipeline, scheduler"
```

---

### Task 13: Integration Test

**Files:**
- Create: `test/integration.test.ts`

**Step 1: Write an integration test that exercises the full pipeline with mocked gog calls**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DigestManager } from "../src/digest.js";
import { EmailLog } from "../src/email-log.js";
import { runPipeline } from "../src/pipeline.js";
import type { TrimmedEmail, ClassificationResult } from "../src/types.js";

describe("Integration: full pipeline cycle", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-integ-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("processes new emails through full pipeline", async () => {
    const digest = new DigestManager(tmpDir);
    const emailLog = new EmailLog(tmpDir);
    await digest.load();

    const mockEmails: TrimmedEmail[] = [
      {
        id: "msg-urgent", threadId: "t-1", account: "work@co.com",
        from: "boss@co.com", to: "work@co.com", subject: "Contract needs signature TODAY",
        date: "2026-02-26T10:00:00Z", body: "Please sign ASAP", threadLength: 1, hasAttachments: true,
      },
      {
        id: "msg-spam", threadId: "t-2", account: "personal@gmail.com",
        from: "deals@shop.com", to: "personal@gmail.com", subject: "50% off sale!",
        date: "2026-02-26T10:00:00Z", body: "Buy now", threadLength: 1, hasAttachments: false,
      },
    ];

    const mockClassifications: ClassificationResult[] = [
      { id: "msg-urgent", importance: "high", reason: "Contract deadline today", notify: true },
      { id: "msg-spam", importance: "low", reason: "Marketing email", notify: false },
    ];

    const pushes: string[] = [];

    await runPipeline({
      accounts: ["work@co.com", "personal@gmail.com"],
      poller: {
        loadState: vi.fn(),
        saveState: vi.fn(),
        pollAccount: vi.fn()
          .mockResolvedValueOnce([mockEmails[0]])
          .mockResolvedValueOnce([mockEmails[1]]),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn().mockReturnValue(1),
      },
      classifier: {
        classify: vi.fn().mockResolvedValue(mockClassifications),
      },
      digest,
      emailLog,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runCommand: vi.fn().mockImplementation(async (args) => {
        if (args.includes("--deliver")) {
          pushes.push(args[args.indexOf("--message") + 1]);
        }
        return { code: 0 };
      }),
      consecutiveFailuresBeforeAlert: 3,
    });

    // Urgent email should be in digest
    const urgent = digest.get("msg-urgent");
    expect(urgent).toBeDefined();
    expect(urgent?.importance).toBe("high");
    expect(urgent?.status).toBe("new");

    // Spam should NOT be in digest
    expect(digest.get("msg-spam")).toBeUndefined();

    // Both should be in email log
    const allLogs = await emailLog.readAll();
    expect(allLogs).toHaveLength(2);

    // Push should have been sent for urgent
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain("Contract needs signature TODAY");
  });

  it("marks emails as handled and they don't reappear", async () => {
    const digest = new DigestManager(tmpDir);
    await digest.load();

    digest.add({
      id: "msg-1", threadId: "t-1", account: "work@co.com",
      from: "boss@co.com", subject: "Review doc", date: "2026-02-26T10:00:00Z",
      body: "Please review", importance: "high", reason: "urgent",
      notify: true, status: "surfaced", firstSeenAt: new Date().toISOString(),
    });

    digest.markHandled("msg-1");
    expect(digest.get("msg-1")?.status).toBe("handled");

    // Next pipeline run — this email should be filtered out
    const mockPoller = {
      loadState: vi.fn(), saveState: vi.fn(),
      pollAccount: vi.fn().mockResolvedValue([
        { id: "msg-1", threadId: "t-1", account: "work@co.com",
          from: "boss@co.com", to: "work@co.com", subject: "Review doc",
          date: "2026-02-26T10:00:00Z", body: "Please review",
          threadLength: 1, hasAttachments: false },
      ]),
      recordSuccess: vi.fn(), recordFailure: vi.fn().mockReturnValue(1),
    };

    await runPipeline({
      accounts: ["work@co.com"],
      poller: mockPoller,
      classifier: { classify: vi.fn().mockResolvedValue([]) },
      digest,
      emailLog: new EmailLog(tmpDir),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runCommand: vi.fn().mockResolvedValue({ code: 0 }),
      consecutiveFailuresBeforeAlert: 3,
    });

    // Still handled, not re-added
    expect(digest.get("msg-1")?.status).toBe("handled");
  });
});
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "feat: add integration test covering full pipeline cycle and dedup"
```

---

### Task 14: Final Review & Cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: Verify file structure matches design**

Run: `find src/ -type f | sort`
Expected output:
```
src/classifier.ts
src/commands/emails.ts
src/digest.ts
src/email-log.ts
src/index.ts
src/pipeline.ts
src/poller.ts
src/scheduler.ts
src/trimmer.ts
src/tools/defer-email.ts
src/tools/dismiss-email.ts
src/tools/get-email-digest.ts
src/tools/mark-email-handled.ts
src/types.ts
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: BetterEmail plugin v0.1.0 — ready for testing"
```
