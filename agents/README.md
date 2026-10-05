# Agent adapters

## TLDR

Shared memory lives in **`docs/brainium/`** + **`core/POLICY.md`**. Each subfolder wires a different tool.

| Folder | Tool | Installs to |
|--------|------|-------------|
| [cursor](./cursor/) | Cursor | `.cursor/rules/`, `.cursor/skills/` |
| [claude](./claude/) | Claude Code (+ Codex copy path) | `.claude/skills/`, `CLAUDE.md` |
| [generic](./generic/) | AGENTS.md consumers, custom bots | `AGENTS.md`, prompt snippet |

```bash
./scripts/install.sh /path/to/repo --all
```
