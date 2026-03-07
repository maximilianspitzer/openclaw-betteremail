# BetterEmail

An OpenClaw plugin that polls Gmail, deduplicates, and tracks email state so the agent can triage during heartbeats. No Pub/Sub, no webhooks, no Tailscale — just `gog` and a polling loop.

> **Why this exists:** The old email workflow was duct-taped together — raw CLI calls burning 30k+ tokens per check, no shared state between sessions, and the same emails getting flagged over and over. [Read the full story →](#why-this-exists)

## Prerequisites

- [OpenClaw](https://github.com/steipete/openclaw) instance
- [gog CLI](https://github.com/steipete/gog) installed and authenticated (`brew install steipete/tap/gogcli`)

## Install

```bash
openclaw plugins install @better_openclaw/betteremail
```

## gog authentication

If gog is already set up on your OpenClaw server (most setups), the plugin works out of the box — it inherits `GOG_KEYRING_PASSWORD` from your OpenClaw `env.vars`.

If gog isn't authenticated yet, see the [gog docs](https://github.com/steipete/gogcli) for setup. On a headless server, use `gog auth add you@gmail.com --services user --manual` and make sure `GOG_KEYRING_PASSWORD` is set in your OpenClaw `env.vars`.

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
      workHours: 5                      # Poll Gmail every 5 min during work hours
      offHours: 30                      # Poll Gmail every 30 min outside work hours
    workHours:
      start: 9                          # Work hours start (24h)
      end: 18                           # Work hours end (24h)
      timezone: "Europe/London"         # IANA timezone
    consecutiveFailuresBeforeAlert: 3   # Alert agent after N consecutive poll failures
    rescanDaysOnHistoryReset: 7         # Days to look back on first poll or history reset
```

**Note:** `pollIntervalMinutes` controls how often the plugin fetches new emails from Gmail in the background — this is separate from the cron job, which controls how often the agent triages what's been collected. The plugin fills the digest; the cron tells the agent to look at it.

## Agent setup

After installing, send the following message to your agent in the main session:

```
Set up a cron job for the BetterEmail plugin. It should run in an isolated session during my work hours — call get_email_digest, triage what it finds (dismiss junk, defer what can wait, mark handled what's done), and then notify me in the main session only if there's something important or actionable. Use `openclaw cron add` with isolated session mode and announce delivery to the main session. Pick a sensible schedule based on my timezone and work hours (check my preferences/config if unsure). Don't run it too often — every couple of hours during work hours is a good default. Make sure the cron expression avoids off-hours and weekends unless I've indicated otherwise.
```

The agent will create a tailored cron job based on your setup. You can always adjust the schedule later with `openclaw cron list` and `openclaw cron remove`.

## How it works

1. **Poll** — Uses `gog gmail history` (incremental) or `gog gmail messages search` (initial/fallback) to fetch new emails
2. **Deduplicate** — Skips emails already seen via an append-only email log
3. **Auto-resolve** — Checks active threads for owner replies and marks them handled
4. **Digest** — All new emails enter the digest with status "new"
5. **Agent triage** — A cron job triggers the agent to check the digest and triage (dismiss, defer, handle)

The agent runs triage in an isolated session with full context (skills, memory, user preferences) and only notifies the main session when something matters.

## Agent tools

| Tool | Description |
|------|-------------|
| `get_email_digest` | Get actionable emails (new + surfaced). Use `includeDeferred`/`includeDismissed` flags for more. |
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

## Security audit note

Running `openclaw security audit --deep` may flag a `potential-exfiltration` warning in `src/poller.ts`. This is a false positive — the file read is loading the plugin's own state file (`state.json`) and the network call is `gog` fetching emails from the Gmail API. No user data is sent anywhere other than Gmail's API via gog.

## Why this exists

Before this plugin, the email workflow was held together with duct tape and hope.

The agent had to run raw `gog gmail messages search` commands during heartbeats to check for new email. Every check meant parsing full Gmail output in the LLM context — on Claude Opus, a single email triage could burn 30–40k tokens just to find out there was nothing urgent. Do that a few times a day across heartbeats and cron jobs, and it adds up fast.

But the real problem was state. There was no shared tracking between sessions. A cron job would flag an email that the main session already handled. The main session would surface something the cron already reported. At one point, the same email from a lawyer got flagged **8 times** across different sessions, heartbeats, and manual checks — because nothing knew what anything else had already seen.

The attempted fix was a manual `notified-emails.json` file that the agent maintained by hand. It was unreliable. It didn't survive context resets, didn't work across isolated cron sessions, and frequently fell out of sync.

BetterEmail exists to make email triage a solved problem:

- **Zero agent tokens for fetching** — polling happens at the plugin level, not in the LLM context
- **Persistent shared state** — dismissed means dismissed, handled means handled, across every session and cron job
- **Actionable by default** — the agent only sees new and surfaced emails unless it explicitly asks for more
- **Simple triage tools** — dismiss, defer, and handle are stateful and permanent
- **No more duplicates** — cron jobs and the main session share the same state at the plugin level

Built by someone who watched his AI assistant waste tokens and duplicate work because there was no proper foundation under the email workflow. This plugin is that foundation.

## License

AGPL-3.0-only
