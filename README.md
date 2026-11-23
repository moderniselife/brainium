# Brainium

Git-backed agent memory for **Cursor**, **Claude Code**, **Claude Desktop**, **Grok Bot** and **generic** agents.  
Repository: [github.com/moderniselife/brainium](https://github.com/moderniselife/brainium)

## TLDR

Portable **git-backed agent memory**: session logs, failures, learnings, and promotion into each tool’s hooks. One `docs/brainium/` tree per project; install the adapters you use.

**New in 0.2 — a second brain that survives switching apps and accounts:** a **personal brain** (preferences, cross-project learnings, and **agent cards** to recreate any agent on a new account), an **MCP server** so Claude Code, Claude Desktop and Cursor can search and write both brains, and **session capture** for Claude Code that your own AI files (or Anthropic, OpenAI, Bonsai, any OpenAI-compatible API, or no AI at all). See [docs/SECOND-BRAIN.md](./docs/SECOND-BRAIN.md). [Prism](https://github.com/moderniselife/prism) wires it into every profile for you.

**New in 0.3 — team brains, agents and routines:** add as many brains as you like (one per team, Prism group, profile or project). Each keeps a `shared/` area every agent sees and an `agents/<name>/` folder per agent for its own notes and supporting docs, and **routines** that run prompts, upkeep jobs or shell commands on a schedule. See [docs/TEAMS-AND-ROUTINES.md](./docs/TEAMS-AND-ROUTINES.md).

## What you get

| Piece | Purpose |
|-------|---------|
| `docs/brainium/` | Typed folders + README indexes + templates |
| `docs/brainium/POLICY.md` | Canonical incident + close-out rules (all agents) |
| **Cursor** | `.cursor/rules/brainium.mdc` + `.cursor/skills/brainium/` |
| **Claude Code** | `.claude/skills/brainium/` + `CLAUDE.md` section |
| **Generic** | `AGENTS.md` + [prompt snippet](./agents/generic/prompts/closeout-system.md) |
| **Personal brain** | `brainium init-personal` → `~/Brainium` (sessions, memories, learnings, **agents/** cards…) |
| **Organize + librarian** | Every brain tidies itself. A daily `organize` job makes the one-right-answer fixes (misfiled records, unsigned notes with evidence, old or broken links), and a `librarian` AI routine (shadow first) links notes to their records, moves misplaced notes, merges duplicates and flags stale records |
| **Preflight** | Before any work, `brain_preflight` (or the Claude Code session-start hook, or `brainium preflight`) fast-forwards the repos `.brainium.json` lists and tells the agent which rule files changed since it last looked — no more "pull first" reminders |
| **MCP server** | `brainium mcp` — `brain_search`, `brain_log`, `agent_card_save`, `brain_pending`… |
| **Capture** | Claude Code `SessionEnd` hook → redacted, private queue → filed by your AI or a summarizer |
| **Team brains** | `brainium brain add NAME DIR --create` → `shared/`, `agents/<name>/`, `routines/` |
| **Routines** | `routines/<name>.md` → prompts (Claude Code / Codex), upkeep (`sync`, `distill`, `digest`, `lint`) or shell, on a schedule and/or `on:` file changes, staged `shadow` → `limited` → `full`; run by `brainium scheduler install` (launchd / systemd / Task Scheduler) or Prism |
| **Records** | `shared/{projects,people,teams,customers,meetings,documents}/` — one file per thing, linked with `[[folder/id]]` (e.g. `[[people/sam]]`, which Obsidian resolves too); `record_save`, `record_get` (follows links one hop) |
| **Health** | `brainium lint` / `brain_lint` and a weekly routine → `shared/health.md`: unsigned notes, missing fields, broken links, stale records, factories without a production prompt or evals |
| **Factories** | Shared agents (`kind: factory`) with versioned `prompts/` and `evals/` |
| **Repo → brain** | `.brainium.json` (`{ "brain": "NAME" }`) at a repo root sends "auto" writes to that brain |

See [docs/CONTEXT-SYSTEM.md](./docs/CONTEXT-SYSTEM.md) for how these fit together.

## Quick install

```bash
git clone https://github.com/moderniselife/brainium.git
cd brainium

# Everything (recommended for mixed teams)
./scripts/install.sh /path/to/your-project --all

# Or pick platforms
./scripts/install.sh /path/to/your-project --cursor
./scripts/install.sh /path/to/your-project --claude
./scripts/install.sh /path/to/your-project --generic
```

Then commit the new files. Details: [INSTALL.md](./INSTALL.md).

## Philosophy

1. **Chat is volatile; git is memory.**
2. **Incidents need files** — `failures/` + `learnings/`, not session-only prose.
3. **Index tables are mandatory** for new slugs.
4. **Promote repeats** into Cursor rules, Claude skills, or `AGENTS.md`.
5. **No secrets** in Brainium — and Brainium redacts what it can before anything touches disk.
6. **Memory belongs to you, not an account** — switch Cursor, Claude or Grok accounts and your brain comes along.

## Layout

```
core/POLICY.md              # single policy source
scaffold/docs/brainium/     # tree copied into projects
scaffold/personal/          # personal brain (incl. agents/ cards)
bin/brainium.mjs            # CLI: init-personal, wire, mcp, capture, distill (zero deps, Node 18.17+)
cli/                        # CLI library, templates and tests (npm test)
agents/
  cursor/                   # Cursor rule + skill
  claude/                   # Claude skill + CLAUDE.md fragment
  generic/                  # AGENTS.md + prompts
extensions/                 # optional project-specific rule fragments
scripts/install.sh
```

## License

MIT — [LICENSE](./LICENSE).

## Contributing

Keep **core** and **scaffold** tool-agnostic. Tool-specific wiring stays under **agents/**.
