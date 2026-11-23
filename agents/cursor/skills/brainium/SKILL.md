---
name: brainium
description: >-
  Second brain for this repo. At the start of work, check brain_pending and
  search the brain (brain_search); before saying done on substantive work,
  log it with brain_log (or into docs/brainium when the Brainium tools are not
  connected), filing failures and learnings with their README indexes. The
  user must not need to ask.
---

# Brainium (Cursor, project install)

Canonical policy: `docs/brainium/POLICY.md` (or `docs/brainium/README.md`). For user-wide setup with the MCP server and session capture, run `brainium wire --app cursor`.

The user should not say "log this." **Capture is automatic.**

## Brains

- **Project brain** — `docs/brainium/` in this repo: code, tickets, incidents, decisions for *this* project.
- **Profile / team brain** — the brain Brainium calls use when you don't name one. A team brain has `shared/`, `agents/<name>/` and `routines/`.
- **Personal brain** — the user's preferences, agent cards and cross-project learnings. It follows the user across apps and accounts.

## Agents

Working as a named agent (your instructions give you a name, or you run as a named subagent or routine)? Pass **`agent: "<your name>"` on every Brainium call**:

- `brain_search` covers your notes plus `shared/` (`everyone: true` for other agents' notes).
- `brain_log` writes to your folder; `shared: true` when every agent should know it. `brain_share` moves a note into `shared/`.
- Keep your card current with `agent_card_save`.

Not a named agent? Leave `agent` out.

## Start of work

1. `brain_pending` — if captured sessions are waiting, read each with `brain_pending_get` and file a concise entry with `brain_resolve` (What we did / Learnings / Mistakes / Open threads / Artifacts).
2. `brain_search` for the task's key terms when prior context could matter.

## Before saying done (substantive work)

With the Brainium MCP tools:

- [ ] `brain_log` kind `session` (brain `auto` = this repo's `docs/brainium/`).
- [ ] **Incidents?** → `failure` (+ `learning` when reusable). Session-only = incomplete.
- [ ] Durable knowledge → `learning`; preferences → `memory`; researched Q&A → `question`; follow-ups → `improvement`; pre-ADR chatter → `decision`.
- [ ] New or changed agent instructions → `agent_card_save`.
- [ ] Projects, people, teams, customers, meetings, documents → a **record** (`record_save`, linked with `[[type/id]]`; `record_get` follows links one hop). Update the record rather than writing another note.
- [ ] Recurring work → `routine_save` (schedule and/or `on:` file changes; starts at `stage: shadow`; stays off until the user approves it on their machine).
- [ ] One line to the user listing the brain paths updated.

Without the tools, edit the files directly:

- [ ] **Today's calendar date** → `docs/brainium/sessions/YYYY-MM-DD.md` (after midnight it's the new day's file; create it + a `sessions/README.md` row). Use `sessions/_template.md`.
- [ ] Route detail to `learnings/`, `failures/`, `memories/`, `questions/`, `improvements/`, `decisions/`, each from its `_template.md`.
- [ ] One row per new slug in **`failures/README.md` and `learnings/README.md`** (mandatory).
- [ ] `git commit` (and `git push` if project rules say so).

## Promotion

- New guardrail → `docs/brainium/rules/` + `.cursor/rules/*.mdc` (and a pointer in `CLAUDE.md` if the project uses Claude Code too).
- New workflow → `docs/brainium/skills/` + `.cursor/skills/` (or `.claude/skills/`).
- User said you missed documentation? → `failures/` for the miss + `learnings/` + indexes + update this skill or the Cursor rule in the same commit.

## Incident bar

| Thread included… | File |
|----------------|------|
| Build / CI / deploy failed | `failures/` + `learnings/` if reusable |
| User: broken, fake, untrustworthy | `failures/` |
| Honesty gap (docs vs production) | `failures/` + audit doc if exists |
| User: you should have documented X | `failures/` + `learnings/` + README indexes + hook update |

Ask: *Would a co-founder call this a mistake or lesson?* → file before done.

## Noise control

- Distilled bullets, not chat dumps. Trivial ack → one session line max.
- **Never store secrets** — no keys, tokens, passwords or credentials (Brainium redacts what it can, but don't rely on it).
