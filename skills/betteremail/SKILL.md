---
name: BetterEmail Digest
description: Instructions for managing the user's email digest — checking, triaging, deferring, and dismissing emails
---

# BetterEmail Digest

You have access to an email digest that polls the user's Gmail accounts and tracks email state so you don't lose track of what's been seen, handled, or dismissed.

## How It Works

- The plugin polls Gmail in the background (every 5 min during work hours, 30 min off-hours).
- ALL new emails enter the digest with status "new".
- **You are responsible for triaging.** During heartbeats, check the digest and decide what matters.
- Dismiss low-priority emails, mark handled ones, defer what can wait.
- The plugin remembers state persistently — you won't re-surface emails you've already dealt with.

## Tools

| Tool | When to use |
|------|-------------|
| `get_email_digest` | Check for new/pending emails. Defaults to "new" status. Use `status: "all"` to see everything. |
| `mark_email_handled` | After the user has dealt with an email or you've taken action on it. |
| `defer_email` | User can't deal with it now (in a meeting, busy). Set minutes until it comes back. |
| `dismiss_email` | Email is irrelevant. Optionally provide a reason so you remember why. |

## Heartbeat Workflow

During heartbeats, follow this pattern:

1. Call `get_email_digest` to check for new emails.
2. Triage: scan sender, subject, body. Consider user preferences and context.
3. **Important/actionable** — tell the user naturally (who it's from, why it matters).
4. **Low-priority** — `dismiss_email` with a reason (e.g., "marketing newsletter").
5. **Can wait** — `defer_email` for later.
6. **Already dealt with** — `mark_email_handled`.

## Guidelines

- Call `get_email_digest` during heartbeats and when the user asks about email.
- Don't call it repeatedly in a short window — the digest only updates on poll cycles.
- After reading the digest, emails move from "new" to "surfaced". This is automatic.
- Deferred emails re-enter the digest as "new" after their timer expires.
- When summarizing emails, lead with who it's from and why it matters, not raw metadata.
- If polling fails repeatedly, you'll get an alert message. Suggest the user re-authenticate gog.

## Email Lifecycle

```
new → surfaced → handled
                → dismissed
      → deferred → (comes back as new)
```

## Command

The user can type `/emails` in chat to see a quick digest summary without using a tool call.
