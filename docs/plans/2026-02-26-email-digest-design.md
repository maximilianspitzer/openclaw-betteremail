# BetterEmail Plugin — Design Document

**Date:** 2026-02-26
**Status:** Approved
**Reference:** BetterClaw plugin (`/Users/max/Documents/VSC_Projects/betterclaw-plugin/`)

## Problem

The OpenClaw AI agent checks Gmail directly in heartbeats and cron jobs, but has no persistent memory. Each session starts fresh, re-flagging the same emails repeatedly. Emails have been flagged 8+ times. Additionally, the agent has no awareness of whether an email has already been replied to.

## Solution

An OpenClaw plugin that sits between Gmail and the AI agent. The plugin handles polling, deduplication, reply detection, importance scoring, and digest management at the infrastructure level. The agent consumes the plugin's output via tools and slash commands instead of scanning emails directly.

---

## Architecture

```
Gmail (3 accounts)
    ↓ gog CLI (system binary)
[POLLER] — incremental sync via Gmail history IDs
    ↓
[REPLY DETECTION] — check thread for replies from owner → auto-skip
    ↓
[TRIMMER] — strip HTML, quoted chains, signatures, disclaimers, truncate to 3000 chars
    ↓
[CLASSIFIER] — headless agent instance via runEmbeddedPiAgent (full agent config/skills/memory)
    ↓
[DIGEST MANAGER] — persist scored emails, manage lifecycle states
    ↓
[AGENT TOOLS] — get_email_digest, mark_email_handled, defer_email, dismiss_email
[SLASH COMMAND] — /emails for instant status
[PUSH] — high-importance emails pushed to main agent via openclaw agent --deliver
```

---

## Plugin Structure

```
openclaw_betterEmail/
├── package.json
├── openclaw.plugin.json
├── src/
│   ├── index.ts          # Plugin entry, registers everything
│   ├── types.ts          # All type definitions
│   ├── poller.ts         # Gmail polling via gog CLI
│   ├── trimmer.ts        # Email body cleaning/trimming
│   ├── classifier.ts     # Headless agent scoring via runEmbeddedPiAgent
│   ├── digest.ts         # Digest state manager (CRUD + persistence)
│   ├── pipeline.ts       # Orchestrates: poll → trim → classify → digest
│   ├── scheduler.ts      # Adaptive polling schedule
│   └── tools/
│       ├── get-email-digest.ts
│       ├── mark-email-handled.ts
│       ├── defer-email.ts
│       └── dismiss-email.ts
```

---

## Configuration

`openclaw.plugin.json` config schema:

```json
{
  "accounts": ["work@company.com", "personal@gmail.com", "other@domain.com"],
  "pollIntervalMinutes": { "workHours": 5, "offHours": 30 },
  "workHours": { "start": 9, "end": 18, "timezone": "Europe/London" },
  "classifierTimeoutMs": 30000,
  "consecutiveFailuresBeforeAlert": 3,
  "rescanDaysOnHistoryReset": 7
}
```

---

## Polling & Deduplication

**Incremental sync via Gmail history IDs:**

For each account on each poll cycle:
1. Read last `historyId` from `state.json`
2. If exists: `gog gmail history --since <historyId> --account <email> --json`
3. If missing (first run or invalidation): `gog gmail messages search 'newer_than:7d' --account <email> --json --include-body`
4. For each new message: fetch full thread via `gog gmail thread get <threadId>`
5. **Reply detection:** if any message in thread is `from` one of the 3 configured accounts, skip the email entirely
6. Update `historyId` in `state.json`

**History ID invalidation recovery:**
- If `gog gmail history` returns an error → fall back to `newer_than:7d` search
- Dedup against `emails.jsonl` by message ID
- Log the event, store new history ID going forward

**Error handling:**
- `gog` failure → log, increment consecutive failure counter, skip cycle
- After N consecutive failures → push alert to main agent via `openclaw agent --deliver`
- Counter resets on successful poll

---

## Body Trimming

Stripping order:
1. HTML → plaintext (strip tags, decode entities)
2. Quoted reply chains (`On <date>, <person> wrote:` blocks, `>` prefixed lines)
3. Email signatures (`--`, `Sent from my iPhone`, `Best regards,`, corporate footers)
4. Legal disclaimers ("This email is confidential...")
5. Tracking pixels / image references (`[image]`, `[cid:...]`, inline base64)
6. Excessive whitespace → collapse to single blank lines
7. Truncate to 3000 characters

**Output per email:**
```typescript
{
  id: string;
  threadId: string;
  account: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;           // trimmed
  threadLength: number;
  hasAttachments: boolean;
}
```

---

## Classification

**Uses `runEmbeddedPiAgent` with the main agent's config/skills/memory.**

```typescript
runEmbeddedPiAgent({
  sessionId: "betteremail-classifier",
  sessionFile,
  workspaceDir,
  config: api.config,
  skillsSnapshot,
  prompt: classifierPrompt,
  timeoutMs: 30_000,
  runId: `betteremail-classify-${Date.now()}`,
  disableTools: true,
});
```

**Classifier prompt asks for per-email:**
- `importance`: "high" | "medium" | "low"
- `reason`: one sentence explanation
- `notify`: boolean (should the agent push this?)

**Batching:** Up to 10 emails per classifier call.

**Fail open:** Timeout or unparseable output → all emails in batch default to `importance: "high", notify: true`.

**Only "high" and "medium" enter the digest.** "Low" is logged to `emails.jsonl` but never surfaces.

---

## Digest State Management

### Email lifecycle

```
new → surfaced → handled
                → dismissed
      → deferred → (timer expires) → new
```

### `digest.json`

```typescript
{
  entries: {
    [messageId: string]: {
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
      status: "new" | "surfaced" | "deferred" | "handled" | "dismissed";
      firstSeenAt: string;
      surfacedAt?: string;
      deferredUntil?: string;
      resolvedAt?: string;
    }
  }
}
```

### `state.json`

```typescript
{
  accounts: {
    [email: string]: {
      historyId: string;
      lastPollAt: string;
      consecutiveFailures: number;
    }
  },
  lastClassifierRunAt: string;
}
```

### `emails.jsonl`

Append-only log of all processed emails (all importance levels) with classifier decisions. Used for dedup on history ID reset. Rotated at 10k lines / 30 days.

### Automatic resolution

On each poll cycle, re-check threads for surfaced/deferred emails. If a reply from owner is detected → auto-transition to `handled`.

---

## Agent Tools

### `get_email_digest`
- **Parameters:** `{ status?: "new" | "surfaced" | "deferred" | "all", account?: string }`
- **Default:** `status: "new"`
- **Behavior:** Returns digest entries grouped by account. Marks returned entries as `surfaced`.

### `mark_email_handled`
- **Parameters:** `{ messageId: string }`
- **Behavior:** Transitions to `handled`, sets `resolvedAt`.

### `defer_email`
- **Parameters:** `{ messageId: string, minutes: number }`
- **Behavior:** Transitions to `deferred`, sets `deferredUntil`. Re-enters as `new` when timer expires.

### `dismiss_email`
- **Parameters:** `{ messageId: string, reason?: string }`
- **Behavior:** Transitions to `dismissed` permanently.

### `/emails` slash command
Instant status without LLM invocation. Shows new/deferred counts per account with subject lines, importance levels, and age.

---

## Push Notifications

High-importance emails with `notify: true` are pushed to the main agent:

```
openclaw agent --deliver --session-id main --message <payload>
```

Payload includes from, subject, account, message ID, and instructions for the agent to use `defer_email` or `mark_email_handled`.

The main agent decides whether to surface immediately (may check calendar, current context). If bad timing, calls `defer_email` — the plugin stores the deferral and re-injects when the timer expires.

---

## Adaptive Scheduling

```typescript
{
  workHours: { start: 9, end: 18, timezone: "..." },
  intervals: { workHours: 5, offHours: 30 }  // minutes
}
```

- Dynamic interval based on current time vs work hours
- Each tick: poll all accounts, check deferred email timers
- Registered via `api.registerService({ id, start, stop })` for clean lifecycle

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| New email detection | Gmail history IDs | Incremental, efficient, native to `gog` |
| Classification | Full agent instance via `runEmbeddedPiAgent` | Has skills/memory to judge importance contextually |
| Hard rules vs LLM-only | LLM-only (except reply detection) | Classifier agent handles it; skip patterns for v1 |
| Fail mode on classifier error | Fail open (assume important) | Better to over-flag than miss |
| History ID invalidation | Re-scan 7 days + dedup | Safe recovery without flooding |
| Multi-account handling | Merged digest, tagged by account | Single view, clear provenance |
| Pattern learning | Skipped for v1 | Classifier agent's context is sufficient |
| Body trimming | Smart trim + 3000 char limit | Strip noise, preserve signal, control token cost |
| Auth failure handling | Alert main agent after N failures | Plugin uses system `gog` binary; agent re-auths normally |
