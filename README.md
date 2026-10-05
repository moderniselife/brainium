# Agent Second Brain

> Repo folder name `cursor-second-brain` is historical — the package supports **Cursor, Claude Code, and generic agents**.

## TLDR

Portable **git-backed agent memory**: session logs, failures, learnings, and promotion into each tool’s hooks. One `docs/second-brain/` tree; install the adapters you use.

## What you get

| Piece | Purpose |
|-------|---------|
| `docs/second-brain/` | Typed folders + README indexes + templates |
| `docs/second-brain/POLICY.md` | Canonical incident + close-out rules (all agents) |
| **Cursor** | `.cursor/rules/second-brain.mdc` + `.cursor/skills/second-brain/` |
| **Claude Code** | `.claude/skills/second-brain/` + `CLAUDE.md` section |
| **Generic** | `AGENTS.md` + [prompt snippet](./agents/generic/prompts/closeout-system.md) |

## Quick install

```bash
git clone <this-repo>
cd cursor-second-brain   # or rename locally to agent-second-brain

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
5. **No secrets** in second brain.

## Layout

```
core/POLICY.md              # single policy source
scaffold/docs/second-brain/ # tree copied into projects
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
