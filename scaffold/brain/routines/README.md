# Routines

## TLDR

Jobs that run on a schedule. Each routine is one file here: settings at the top, the prompt or command below. A run is logged to its agent's `sessions/` (or `shared/sessions/`), and the full output is kept in `~/.brainium-raw/routines/` on the machine that ran it.

| Type | Does | Example |
|------|------|---------|
| `prompt` | Runs a prompt through an agent app headlessly (`claude -p`, `codex exec`) in a chosen profile | Morning brief, weekly research digest |
| `upkeep` | A built-in job: `sync` (pull/push this brain), `distill` (file captured sessions), `digest` (what each agent wrote this week) | Nightly sync |
| `shell` | Runs a command | Back up a folder, ping a service |

**Approval:** this folder syncs through git, so `prompt` and `shell` routines only run on a machine after you approve them there (Prism → Settings → Second brain → Routines, or `brainium routines approve`). Changing the file needs approving again. `upkeep` routines are built in and need no approval.

**Schedules** are cron (`0 8 * * 1-5` = 8am on weekdays, local time), `@hourly`, `@daily`, `@weekly`, `@monthly`, or `every 15m` / `every 2h`.

Template: [_template.md](./_template.md)
