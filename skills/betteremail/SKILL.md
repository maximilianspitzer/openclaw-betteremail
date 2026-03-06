---
name: BetterEmail Digest
description: Instructions for managing the user's email digest — checking, triaging, deferring, and dismissing emails
---

# BetterEmail Digest

You have access to an intelligent email digest that polls the user's Gmail accounts, classifies emails by importance, and surfaces the ones that matter.

## How It Works

- The plugin polls Gmail in the background (every 5 min during work hours, 30 min off-hours).
- New emails are classified as high, medium, or low importance using an AI classifier that has access to your skills and memory.
- High and medium emails enter the digest. Low emails are logged but not surfaced.
- High-importance emails with `notify: true` are pushed to you immediately as `[BetterEmail]` messages.

## Tools

| Tool | When to use |
|------|-------------|
| `get_email_digest` | Check for new/pending emails. Defaults to "new" status. Use `status: "all"` to see everything. |
| `mark_email_handled` | After the user has dealt with an email or you've taken action on it. |
| `defer_email` | User can't deal with it now (in a meeting, busy). Set minutes until it comes back. |
| `dismiss_email` | Email is irrelevant. Optionally provide a reason so you remember why. |

## Push Messages

When you receive a `[BetterEmail]` message, it means a high-importance email just arrived. You should:
1. Relay the key info to the user naturally (don't dump raw fields).
2. Ask if they want to handle it now or defer.
3. Use `mark_email_handled` or `defer_email` based on their response.

## Guidelines

- Call `get_email_digest` when the user asks about email, or proactively during check-ins.
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
