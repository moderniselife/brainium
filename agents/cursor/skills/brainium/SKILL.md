---
name: brainium
description: >-
  Mandatory end-of-conversation capture under docs/brainium (sessions,
  failures, learnings, memories, questions, improvements, decisions). Use
  before every substantive "done" reply in Cursor or any agent with this repo.
---

# Brainium

Read `core/POLICY.md` for the full incident bar. **Capture is automatic** — the user should not say “log this.”

## End-of-turn checklist

- [ ] Append **session** → `docs/brainium/sessions/YYYY-MM-DD.md`
- [ ] **Incidents?** → `failures/` (+ `learnings/`). Session alone = incomplete.
- [ ] **Route** detail: learnings, failures, memories, questions, improvements, decisions
- [ ] **Promotion:** new Cursor rule → `docs/brainium/rules/` + `.cursor/rules/`; skill → `docs/brainium/skills/` + `.cursor/skills/`
- [ ] Update **`failures/README.md` and `learnings/README.md`** per new slug
- [ ] User challenged missing doc? → failures + learnings + index + rule/skill bump same commit
- [ ] `git commit` (and `git push` if project rules say so)
- [ ] One line to user with paths

## Templates

Under `docs/brainium/*/\_template.md` — see package scaffold or your installed copy.

## Noise control

Distilled bullets; no secrets; trivial ack → one session line max.
