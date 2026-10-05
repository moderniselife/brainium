# Second brain

## TLDR

Mandatory project memory outside chat. **Every substantive conversation** → `sessions/`. Route detail by type. Locked ADRs live in your main decision register (e.g. `docs/decisions/register.md`); `decisions/` here is **index + informal notes**. Canonical Cursor **rules/skills** live under `.cursor/`; `rules/` and `skills/` here record **why** they exist.

## Folder map

```
docs/second-brain/
├── sessions/       # Daily conversation roll-ups (mandatory)
├── learnings/      # What we now know
├── failures/       # What broke, root cause, prevention
├── memories/       # Preferences and context
├── questions/      # Researched Q&A
├── improvements/   # Backlog from sessions
├── decisions/      # Pointer to register + pre-ADR notes
├── rules/          # Rationale for .cursor/rules
└── skills/         # Rationale for .cursor/skills
```

## Agent workflow

1. End of substantive turn → append `sessions/YYYY-MM-DD.md` ([template](./sessions/_template.md)).
2. Route detail to the right folder (same commit when possible).
3. Update `failures/README.md` / `learnings/README.md` for **each** new slug.
4. **Incidents** → `failures/` + `learnings/` — not session-only.
5. Commit (and push per team rules); tell the user which paths changed.

**Policy:** [POLICY.md](./POLICY.md) (same as package `core/POLICY.md`).

**Agent hooks (use what your repo has):**

| Tool | Hook |
|------|------|
| Cursor | `.cursor/rules/second-brain.mdc`, `.cursor/skills/second-brain/` |
| Claude Code | `CLAUDE.md`, `.claude/skills/second-brain/` |
| Other | `AGENTS.md` at repo root |

## Quick index

| Folder | Latest |
|--------|--------|
| [sessions](./sessions/) | — |
| [learnings](./learnings/) | — |
| [failures](./failures/) | — |
| [memories](./memories/) | — |
| [rules](./rules/) | — |
| [skills](./skills/) | — |
| [decisions](./decisions/) | [README](./decisions/README.md) |
| [questions](./questions/) | — |
| [improvements](./improvements/) | — |
