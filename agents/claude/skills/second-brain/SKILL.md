---
name: second-brain
description: >-
  Mandatory close-out for Claude Code: append docs/second-brain/sessions,
  file failures and learnings with README indexes, commit. Use before saying
  done on any substantive task. User must not need to ask for logging.
---

# Second brain (Claude Code)

Canonical policy: `core/POLICY.md` in this package, or `docs/second-brain/README.md` in the project.

The user should not say “log this.” **Capture is automatic.**

## End-of-turn checklist

- [ ] Append **session** → `docs/second-brain/sessions/YYYY-MM-DD.md` (use `sessions/_template.md`)
- [ ] **Incidents?** (deploy fail, trust break, “done” but broken) → **`failures/`** + **`learnings/`** when reusable. Session-only = incomplete.
- [ ] **Route** other detail:
  - new knowledge → `learnings/`
  - mistakes → `failures/`
  - preferences → `memories/`
  - researched Q&A → `questions/`
  - follow-ups → `improvements/`
  - pre-ADR chatter → `decisions/`
  - new guardrail → `docs/second-brain/rules/` + update `CLAUDE.md` pointer and/or `.cursor/rules` if the project uses Cursor too
  - new workflow skill → `docs/second-brain/skills/` + `.claude/skills/` or `.cursor/skills/`
- [ ] Update **`failures/README.md` and `learnings/README.md`** — one row per new slug (mandatory)
- [ ] User said you missed documentation? → `failures/` for the miss + `learnings/` + indexes + update this skill or `CLAUDE.md` in the same commit
- [ ] `git commit` (and `git push` if project rules say so)
- [ ] One line to the user listing paths updated

## Incident bar

| Thread included… | File |
|----------------|------|
| Build / CI / deploy failed | `failures/` + `learnings/` if reusable |
| User: broken, fake, untrustworthy | `failures/` |
| Honesty gap (docs vs production) | `failures/` + audit doc if exists |
| User: you should have documented X | `failures/` + `learnings/` + README indexes + hook update |

Ask: *Would a co-founder call this a mistake or lesson?* → file before done.

## Templates

| Folder | Template |
|--------|----------|
| sessions | `docs/second-brain/sessions/_template.md` |
| learnings | `docs/second-brain/learnings/_template.md` |
| failures | `docs/second-brain/failures/_template.md` |
| memories | `docs/second-brain/memories/_template.md` |
| questions | `docs/second-brain/questions/_template.md` |
| improvements | `docs/second-brain/improvements/_template.md` |
| rules | `docs/second-brain/rules/_template.md` |
| skills | `docs/second-brain/skills/_template.md` |

## Noise control

- Distilled bullets, not chat dumps.
- No secrets (`.env`, tokens, credentials).
- Trivial ack → one session line max.

## User-facing line

“Logged in second brain: `sessions/…` (+ `learnings/…` / `failures/…` if applicable).”
