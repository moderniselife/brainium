# Team brains, agents and routines

## TLDR

Brainium 0.3 lets one brain serve a **team of agents**. Say a single Claude profile runs five agents for Mojo Layers: they get one git repo with

- **`shared/`** for what they all need to know,
- **`agents/<name>/`** for each agent's own notes and supporting docs,
- **`routines/`** for jobs that run on a schedule.

You can keep as many brains as you like (one per team, Prism group, profile or project) next to your personal brain. [Prism](https://github.com/moderniselife/prism) sets all of this up from Settings → Second brain.

## Brains

```bash
brainium brain add mojo-layers ~/Brainium/mojo-layers --create   # scaffold + register
brainium brain add research ~/code/research-brain                 # use an existing folder
brainium brain default mojo-layers                                # used when a call names none
brainium brains                                                   # list (add --json)
```

```
mojo-layers/
  shared/        sessions/ memories/ learnings/ decisions/ questions/ improvements/
  agents/
    researcher/  card.md  memories/ learnings/ sessions/  …and any docs it needs
    writer/      …
  routines/      morning-brief.md  nightly-sync.md
```

Refs name the brain: `mojo-layers:shared/decisions/2026-11-17-use-postgres.md`, `personal:memories/…`, `project:learnings/…`. Your older personal brain keeps its layout: its root acts as its shared area, and cards stay single files (`agents/<name>.md`).

**Brains inside brains.** A brain can live in a folder of another (say one brain per team under a company brain's `teams/`). Register each one: a search of the outer brain then leaves the inner brains out, so team notes don't leak into company-wide searches. Search the team's brain, or every brain with `brain: "*"`, to see them.

**Which brain a call uses:** the one it names (`brain`), else "auto": the project brain (`docs/brainium/`) when there is one, else the profile's brain, else personal. The profile's brain is `$BRAINIUM_BRAIN` on its MCP server, which `brainium wire --brain NAME` (and Prism) set per profile. Searches cover the project, profile and personal brains (`brain: "*"` for every brain).

## Agents

An agent is a folder under `agents/`. Brainium finds folders you made by hand (`agents/Mojo Researcher/` with a `README.md` and docs) by their name, so `agent: "mojo researcher"` writes into that same folder. Their card is `card.md` (or an existing `README.md`/`AGENT.md`); `agent_card_save` writes `card.md` and leaves your own files alone.

An agent passes **`agent: "<its name>"`** on every Brainium call:

| Call | Without `agent` | With `agent` |
|---|---|---|
| `brain_log` | `shared/` | `agents/<name>/` (add `shared: true` for `shared/`) |
| `brain_search` | everything | its own notes + `shared/` + everyone's cards (`everyone: true` for the rest) |
| `brain_list` | `shared/<folder>` | `agents/<name>/<folder>` |
| `brain_share` | — | moves one of its notes into `shared/` |

**Private means separate, not locked.** It's one repo: any agent can read the others' folders when asked, and anyone with the repo can read it all. That's by design ("sharing is caring"); keep something truly confidential in its own brain.

To tell an agent its name, add this to its instructions (a Claude Code subagent's file, a Desktop project, a Cursor rule):

```bash
brainium snippet agent --agent "Researcher" --brain mojo-layers
brainium snippet grok --agent "Researcher" --brain mojo-layers   # Grok Bot, via its GitHub connector
```

Routines set it for you (`$BRAINIUM_AGENT`).

## Routines

A routine is a file in a brain's `routines/`:

```markdown
---
name: Morning brief
schedule: "0 8 * * 1-5"        # cron (local time), @daily/@hourly/@weekly/@monthly, or "every 30m"
type: prompt                   # prompt | upkeep | shell
agent: researcher              # who runs it; its log goes to that agent's sessions/
app: claude-code               # prompt: claude-code (claude -p) or codex (codex exec)
profile: ~/.claude_code_profiles/Mojo Layers   # CLAUDE_CONFIG_DIR (or CODEX_HOME) to run in
cwd: ~/Projects/mojo           # optional
args: --permission-mode acceptEdits            # optional extra CLI arguments
timeout: 20m                   # default 30m
catch_up: true                 # run once after a missed time (asleep); false records a miss
log: always                    # session entry per run: always (default; upkeep defaults to failures), failures (first failure + recovery), never
enabled: true
---

Read yesterday's shared sessions and write a short brief of what needs attention today.
```

| Type | Runs | Approval |
|---|---|---|
| `prompt` | The prompt through Claude Code or Codex, headless, in the profile you name, as the agent | Yes |
| `shell` | The first ```` ``` ```` block (or the body) with your login shell | Yes |
| `upkeep` | `job: sync` (git pull --rebase, then push this brain), `distill` (file captured sessions), `digest` (what each agent and `shared/` wrote since the last run) | No |

```bash
brainium routines                         # next/last run, approval, problems
brainium routines new "Morning brief" --brain mojo-layers [--type prompt|upkeep|shell]
brainium routines approve mojo-layers/morning-brief     # or --all
brainium routines enable mojo-layers/morning-brief
brainium routines run mojo-layers/morning-brief         # now
```

**Approval.** Routines arrive through git, so a `prompt` or `shell` routine only runs on a machine after you approve it there. Approval is tied to the file's content: any edit (other than switching it on or off) needs approving again, so a pulled-in change can't run commands on your machine by itself. Approvals live in `~/.config/brainium/routines-approved.json`, never in a brain.

**Runs.** Each run is logged as a session entry in its agent's `sessions/` (or `shared/sessions/`) with the status, duration and the last lines of output. The full redacted output stays on the machine that ran it, in `~/.brainium-raw/routines/<brain>/<routine>/`. A routine never runs twice at once, and a slot already handled by one scheduler is skipped by another.

**Headless prompts can't answer permission prompts.** Give a prompt routine what it needs up front with `args` (`--permission-mode acceptEdits`, `--allowedTools "…"`), or keep it to reading and logging.

### What runs them

```bash
brainium scheduler install     # launchd (macOS), systemd user timer (Linux), Task Scheduler (Windows)
brainium scheduler status
brainium scheduler uninstall
```

The OS scheduler runs `brainium routines tick` every minute, so routines run even when nothing else is open. Or let Prism run them while it's open (Settings → Second brain → Routines → "While Prism is open"). Both can run at once safely.

If `claude` or `codex` isn't found (launchd doesn't get your shell's `PATH`), set `brainium config set routines.claudePath /path/to/claude`.

## MCP tools added

`brain_share`, `agent_list`, `routine_list`, `routine_save` (saves a routine switched off and unapproved, for you to review), plus `brain`, `agent`, `shared` and `everyone` on the existing tools.
