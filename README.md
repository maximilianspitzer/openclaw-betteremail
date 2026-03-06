# BetterEmail

An OpenClaw plugin that polls Gmail, classifies emails by importance, and exposes a digest to the agent. No Pub/Sub, no webhooks, no Tailscale — just `gog` and a polling loop.

## Prerequisites

- [OpenClaw](https://github.com/steipete/openclaw) instance
- [gog CLI](https://github.com/steipete/gog) installed and authenticated (`brew install steipete/tap/gogcli`)

## Install

```bash
openclaw plugins add @better_openclaw/betteremail
```

## Configure

In your OpenClaw config (`openclaw.yaml` or via the UI):

```yaml
plugins:
  betteremail:
    accounts:
      - you@gmail.com
      - work@gmail.com
```

That's the minimum. The plugin will start polling immediately using defaults.

### All options

```yaml
plugins:
  betteremail:
    accounts: []                        # Gmail accounts to poll (required)
    pollIntervalMinutes:
      workHours: 5                      # Poll every 5 min during work hours
      offHours: 30                      # Poll every 30 min outside work hours
    workHours:
      start: 9                          # Work hours start (24h)
      end: 18                           # Work hours end (24h)
      timezone: "Europe/London"         # IANA timezone
    classifierTimeoutMs: 30000          # Timeout for the AI classifier
    consecutiveFailuresBeforeAlert: 3   # Alert agent after N consecutive poll failures
    rescanDaysOnHistoryReset: 7         # Days to look back on first poll or history reset
```

## How it works

1. **Poll** — Uses `gog gmail history` (incremental) or `gog gmail messages search` (initial/fallback) to fetch new emails
2. **Deduplicate** — Skips emails already seen via an append-only email log
3. **Auto-resolve** — Checks active threads for owner replies and marks them handled
4. **Classify** — Runs a headless agent (via `runEmbeddedPiAgent`) to classify each email as high/medium/low importance
5. **Digest** — High and medium emails enter the digest; low emails are logged but not surfaced
6. **Push** — High-importance + notify emails are pushed to the agent immediately

The classifier has access to the user's skills and memory, so it learns what matters over time.

## Agent tools

| Tool | Description |
|------|-------------|
| `get_email_digest` | Get unresolved emails, optionally filtered by status or account |
| `mark_email_handled` | Mark an email as dealt with — removes it from the digest |
| `defer_email` | Snooze an email for N minutes — it re-enters the digest later |
| `dismiss_email` | Permanently dismiss an email with an optional reason |

## Commands

| Command | Description |
|---------|-------------|
| `/emails` | Show current digest status across all accounts |

## Email lifecycle

```
new → surfaced → handled
                → dismissed
      → deferred → (re-enters as new after timeout)
```

- **new** — Just arrived, not yet shown to the agent
- **surfaced** — Agent has seen it via `get_email_digest`
- **deferred** — Snoozed, will come back
- **handled** — Done
- **dismissed** — Permanently ignored

## State files

Stored in the plugin's state directory (managed by OpenClaw):

- `digest.json` — Current digest entries
- `state.json` — Polling state (history IDs, failure counts)
- `emails.jsonl` — Append-only log of all emails seen

All writes are atomic (write-to-temp-then-rename) to prevent corruption.

## License

AGPL-3.0-only
