# Claude Code — optional hooks

## TLDR

Skills + `CLAUDE.md` are enough for most teams. Use hooks only if you want mechanical reminders (not a substitute for the skill).

## Skills (required for this package)

- Project: `.claude/skills/second-brain/SKILL.md`
- User-global: `~/.claude/skills/second-brain/SKILL.md`

Claude discovers skills from frontmatter `description` — keep it explicit about “before done” and `docs/second-brain`.

## CLAUDE.md

Merge `CLAUDE.md.fragment` at repo root. Keep it short; detail lives in the skill and `core/POLICY.md`.

## Permissions

If your team uses `.claude/settings.json` or managed permissions, allow the agent to write under `docs/second-brain/` and run `git` for doc commits.

## Hooks (advanced)

Claude Code supports project hooks (see Anthropic docs for current schema). A **Stop** or **SubagentStop** hook that only prints “Run second-brain checklist” is possible but easy to annoy — prefer the skill + `CLAUDE.md` mandate.

Do not block commits in hooks unless your team explicitly wants that workflow.
