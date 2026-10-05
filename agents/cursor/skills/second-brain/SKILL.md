---
name: second-brain
description: >-
  Mandatory end-of-conversation capture under docs/second-brain (sessions,
  failures, learnings, memories, questions, improvements, decisions). Use
  before every substantive "done" reply in Cursor or any agent with this repo.
---

# Second brain

Read `core/POLICY.md` for the full incident bar. **Capture is automatic** — the user should not say “log this.”

## End-of-turn checklist

- [ ] Append **session** → `docs/second-brain/sessions/YYYY-MM-DD.md`
- [ ] **Incidents?** → `failures/` (+ `learnings/`). Session alone = incomplete.
- [ ] **Route** detail: learnings, failures, memories, questions, improvements, decisions
- [ ] **Promotion:** new Cursor rule → `docs/second-brain/rules/` + `.cursor/rules/`; skill → `docs/second-brain/skills/` + `.cursor/skills/`
- [ ] Update **`failures/README.md` and `learnings/README.md`** per new slug
- [ ] User challenged missing doc? → failures + learnings + index + rule/skill bump same commit
- [ ] `git commit` (and `git push` if project rules say so)
- [ ] One line to user with paths

## Templates

Under `docs/second-brain/*/\_template.md` — see package scaffold or your installed copy.

## Noise control

Distilled bullets; no secrets; trivial ack → one session line max.
