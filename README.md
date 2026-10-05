# Brainium

Git-backed agent memory for **Cursor**, **Claude Code**, and **generic** agents.  
Repository: [github.com/moderniselife/brainium](https://github.com/moderniselife/brainium)

## TLDR

Portable **git-backed agent memory**: session logs, failures, learnings, and promotion into each tool’s hooks. One `docs/brainium/` tree; install the adapters you use.

## What you get

| Piece | Purpose |
|-------|---------|
| `docs/brainium/` | Typed folders + README indexes + templates |
| `docs/brainium/POLICY.md` | Canonical incident + close-out rules (all agents) |
| **Cursor** | `.cursor/rules/brainium.mdc` + `.cursor/skills/brainium/` |
| **Claude Code** | `.claude/skills/brainium/` + `CLAUDE.md` section |
| **Generic** | `AGENTS.md` + [prompt snippet](./agents/generic/prompts/closeout-system.md) |

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
5. **No secrets** in Brainium.

## Layout

```
core/POLICY.md              # single policy source
scaffold/docs/brainium/ # tree copied into projects
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
