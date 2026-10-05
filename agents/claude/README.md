# Claude Code setup

## TLDR

Claude Code loads **project skills** from `.claude/skills/<name>/SKILL.md` and **project memory** from `CLAUDE.md` at the repo root. Install the Brainium skill and merge the CLAUDE fragment so every session enforces close-out.

## Project install (recommended)

From the package root:

```bash
./scripts/install.sh /path/to/repo --claude
```

Or manually:

1. Copy `agents/claude/skills/brainium/` → `your-repo/.claude/skills/brainium/`
2. Merge `agents/claude/CLAUDE.md.fragment` into `your-repo/CLAUDE.md` (create file if missing).
3. Ensure `docs/brainium/` exists (`install.sh` or `--all`).

## User-wide skill (all repos)

```bash
mkdir -p ~/.claude/skills/brainium
cp agents/claude/skills/brainium/SKILL.md ~/.claude/skills/brainium/
```

Project `CLAUDE.md` + `docs/brainium/` still belong in each repo you care about.

## Codex (optional)

Same skill body works at `~/.codex/skills/brainium/SKILL.md` for OpenAI Codex CLI — copy from `agents/claude/skills/brainium/SKILL.md`.

## Verify

In Claude Code, run a substantive task and confirm the agent appends `docs/brainium/sessions/YYYY-MM-DD.md` without being asked.

## Promotion

When adding guardrails, update **both** `CLAUDE.md` (short pointer) and `docs/brainium/rules/` (rationale). For workflow skills, use `.claude/skills/` + `docs/brainium/skills/`.

See [settings-notes.md](./settings-notes.md) for hooks and permissions (optional).
