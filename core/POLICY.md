# Brainium policy (all agents)

## TLDR

Git-backed memory under `docs/brainium/`. The user does **not** ask you to log — you capture before saying done. Incidents need `failures/` (+ `learnings/`); session-only is incomplete. Index every new failure/learning slug in that folder’s `README.md`.

## Folder tree

```
docs/brainium/
  sessions/      # mandatory daily roll-up
  learnings/     # durable knowledge
  failures/      # mistakes + prevention
  memories/      # preferences, stakeholders
  questions/     # researched Q&A
  improvements/  # follow-up actions
  decisions/     # pre-ADR → main register
  rules/         # why agent guardrails exist
  skills/        # why workflow skills exist
```

## Session file = calendar day (strict)

- **`sessions/YYYY-MM-DD.md`** is keyed by **calendar date** (user/team local day unless the project defines a timezone). It is **not** one file per conversation thread.
- **`### HH:MM` headings** are clock time on **that** date. After midnight, append **today’s** file — e.g. `00:02` belongs on the **new** day, not yesterday’s, even if the chat never stopped.
- **Before every append:** confirm today’s `YYYY-MM-DD`; create the file and `sessions/README.md` index row if missing.
- **Wrong file?** Move sections to the correct date in the same fix; do not leave split logs.

## Close-out (substantive work)

1. Append **`sessions/YYYY-MM-DD.md` for today’s calendar date** — link all `failures/` and `learnings/` touched.
2. Route detail to typed folders.
3. Update `failures/README.md` / `learnings/README.md` index tables.
4. Commit (push per team rules).
5. Tell the user which paths were updated once.

## Incident triggers

| Trigger | Capture |
|---------|---------|
| Deploy / CI / build failed | `failures/` + `learnings/` if reusable |
| User: broken, fake, missing, untrustworthy | `failures/` |
| Docs/agent “done” but prod/shared env wrong | `failures/` + project audit doc if any |
| New guardrail agents must obey | `learnings/` + promote to agent config |
| User: agent missed documentation | `failures/` (doc miss) + `learnings/` + update agent hooks same commit |
| Fix for issue introduced earlier same initiative | Retro `failures/` for original ship |

**Test:** Would a co-founder call this a mistake or lesson? → file before done.

## Promotion

| Must repeat | Action |
|-------------|--------|
| Agent guard | Tool-specific rules + `docs/brainium/rules/` note |
| Workflow | Tool-specific skill + `docs/brainium/skills/` note |
| Locked decision | ADR in `docs/decisions/` (or your register) |

## Before risky work

Search `docs/brainium/failures/` and `learnings/` plus project how-tos.

## Tooling map

| Environment | Hook |
|-------------|------|
| Cursor | `.cursor/rules/brainium.mdc` + `.cursor/skills/brainium/` |
| Claude Code | `.claude/skills/brainium/` + `CLAUDE.md` section |
| Generic / other | `AGENTS.md` + [agents/generic/prompts/closeout-system.md](../agents/generic/prompts/closeout-system.md) |
