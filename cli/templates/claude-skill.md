---
name: brainium
description: >-
  Second brain for every session. Before saying done on substantive work, log
  it with the Brainium MCP tools (brain_log) or into docs/brainium; at the
  start of work, check brain_pending for captured sessions to file and search
  the brain (brain_search) for context. The user must not need to ask.
---

# Brainium (managed by `brainium wire`)

Your memory lives in brains — use them, and never wait to be asked:

- **Project brain** — `docs/brainium/` in the current repo (if present): code, tickets, incidents, decisions for *this* project.
- **This profile's brain** — `{{BRAIN}}` (Brainium calls use it when you don't name one). A team brain has `shared/` (what every agent knows) and `agents/<name>/` (each agent's own notes and supporting docs), plus `routines/`.
- **Personal brain** — `{{PERSONAL_BRAIN}}`: the user's preferences, agent cards, cross-project learnings, and sessions with no repo. It follows the user across apps and accounts.

## Agents

If you're working as a named agent (your instructions give you a name, or you were started as a subagent or routine with one), pass **`agent: "<your name>"` on every Brainium call**:

- `brain_search` then covers your own notes plus `shared/` (add `everyone: true` to look at other agents' notes too).
- `brain_log` writes to your own folder; add `shared: true` when every agent should know it. `brain_share` moves one of your notes into `shared/`.
- Keep your card current with `agent_card_save` (it lives in `agents/<you>/card.md`).

Not a named agent? Leave `agent` out: everything goes to `shared/`.

## Start of work

1. `brain_pending` — if captured sessions are waiting, read each with `brain_pending_get`, then file a concise session entry with `brain_resolve` (What we did / Learnings / Mistakes / Open threads / Artifacts). This replaces a separate AI summariser: you are the summariser.
2. `brain_search` for the task's key terms when prior context could matter.

## Before saying done (substantive work)

- `brain_log` kind `session` (brain `auto` picks the project brain when there is one).
- Incidents → `failure` (+ `learning` when reusable). Durable knowledge → `learning`. Preferences → `memory`.
- New or changed agent instructions → `agent_card_save` so the agent can be recreated on any account.
- Recurring work the user wants done on a schedule → `routine_save` (it stays off until the user approves it on their machine).
- If the MCP tools are unavailable, edit the markdown files directly following each folder's `_template.md`.
- Tell the user once which brain paths you updated.

**Never store secrets** — no keys, tokens, passwords or credentials (Brainium redacts what it can, but don't rely on it).
