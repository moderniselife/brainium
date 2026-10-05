# Install Agent Second Brain

## TLDR

`./scripts/install.sh TARGET [--all|--cursor|--claude|--generic] [--force]`

Default with no platform flags: **`--all`** (docs + Cursor + Claude + generic).

## Prerequisites

- Git repository (recommended)
- At least one of: [Cursor](https://cursor.com), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or any agent that reads `AGENTS.md`

## Platform guides

| Platform | After install | Verify |
|----------|---------------|--------|
| **Cursor** | Rule `alwaysApply: true` on `second-brain.mdc` | Agent logs session without being asked |
| **Claude Code** | `CLAUDE.md` + `.claude/skills/second-brain/` | Same; see [agents/claude/README.md](./agents/claude/README.md) |
| **Codex CLI** | Copy skill to `~/.codex/skills/second-brain/` | Optional; see Claude README |
| **Generic** | Root `AGENTS.md` points at `docs/second-brain/POLICY.md` | Paste [closeout prompt](./agents/generic/prompts/closeout-system.md) if needed |

## Claude Code (details)

1. **Project skill** — `.claude/skills/second-brain/SKILL.md` (installed by `--claude` or `--all`).
2. **CLAUDE.md** — install script appends `agents/claude/CLAUDE.md.fragment` if missing.
3. **User-global skill** (optional):

   ```bash
   mkdir -p ~/.claude/skills/second-brain
   cp agents/claude/skills/second-brain/SKILL.md ~/.claude/skills/second-brain/
   ```

4. **Hooks** — optional; see [agents/claude/settings-notes.md](./agents/claude/settings-notes.md).

## Cursor (details)

1. `.cursor/rules/second-brain.mdc` — always apply.
2. `.cursor/skills/second-brain/SKILL.md` — end-of-turn checklist.

## Generic (details)

1. `AGENTS.md` from template — add your stack commands below the second-brain section.
2. `docs/second-brain/POLICY.md` — copy of `core/POLICY.md`.

## Upgrading

Re-run with `--force` to replace agent hooks and refresh scaffold READMEs. Back up custom edits first.

## Uninstall

Remove installed paths listed in the install script output. Git history retains past captures.
