---
name: second-brain
description: >-
  Mandatory end-of-conversation capture: sessions/ plus learnings, failures,
  memories, questions, improvements, decisions, rules, skills under
  docs/second-brain. Use before every substantive "done" reply.
---

# Second brain

The user should not have to say “log this.” **Capture is automatic.**

## End-of-turn checklist

- [ ] Append **session** → `docs/second-brain/sessions/YYYY-MM-DD.md`
- [ ] **Incidents?** (deploy fail, user trust break, “done” but broken, missing prod data) → **must** add `failures/` (+ `learnings/` for the durable fix). Session alone = incomplete.
- [ ] **Route** other detail:
  - knew something new → `learnings/`
  - something broke / almost did → `failures/`
  - preference or context → `memories/`
  - researched answer → `questions/`
  - follow-up action → `improvements/`
  - pre-lock decision chatter → `decisions/` (then ADR when accepted)
  - new/changed Cursor rule → `rules/` + `.cursor/rules/`
  - new/changed skill → `skills/` + `.cursor/skills/`
- [ ] Update **`failures/README.md` and `learnings/README.md`** — one row per new slug (mandatory)
- [ ] User challenged missing doc? → `failures/` for the miss + `learnings/` + README indexes + rule/skill bump in same commit
- [ ] `git commit` (and `git push` if project rules say so)
- [ ] One line to the user with paths (`sessions/…`, `failures/…`, `learnings/…`)

### Failure / learning bar

| If the thread included… | File |
|-------------------------|------|
| Deploy or CI/build failed | `failures/` + prevention in `learnings/` if reusable |
| Production vs docs honesty gap | `failures/` + update audit/readiness docs if they exist |
| User challenged honesty of “done” | `failures/` for the gap + retro failure if wire-time mistake |
| User said agent should have documented X | `failures/` for the miss + `learnings/` + README indexes + rule update |
| New check script, migration, or data bootstrap | `learnings/` — note member-visible vs infra-only if relevant |

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
- No secrets (tokens, `.env`, credentials).
- Trivial ack → one session line max.

## User-facing line

“Logged in second brain: `sessions/…` (+ `learnings/…` / `failures/…` if applicable).”
