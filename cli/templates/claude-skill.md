---
name: brainium
description: >-
  Second brain for every session. Before saying done on substantive work, log
  it with the Brainium MCP tools (brain_log) or into docs/brainium; at the
  start of work, check brain_pending for captured sessions to file and search
  the brain (brain_search) for context. The user must not need to ask.
---

# Brainium (managed by `brainium wire`)

You have two brains — use both, and never wait to be asked:

- **Project brain** — `docs/brainium/` in the current repo (if present): code, tickets, incidents, decisions for *this* project.
- **Personal brain** — `{{PERSONAL_BRAIN}}`: the user's preferences, **agent cards**, cross-project learnings, and sessions with no repo. It follows the user across apps and accounts.

## Start of work

1. `brain_pending` — if captured sessions are waiting, read each with `brain_pending_get`, then file a concise session entry with `brain_resolve` (What we did / Learnings / Mistakes / Open threads / Artifacts). This replaces a separate AI summariser: you are the summariser.
2. `brain_search` for the task's key terms when prior context could matter.

## Before saying done (substantive work)

- `brain_log` kind `session` (scope `auto` picks the project brain when there is one).
- Incidents → `failure` (+ `learning` when reusable). Durable knowledge → `learning`. Preferences → `memory` (personal).
- New or changed agent instructions → `agent_card_save` so the agent can be recreated on any account.
- If the MCP tools are unavailable, edit the markdown files directly following each folder's `_template.md`.
- Tell the user once which brain paths you updated.

**Never store secrets** — no keys, tokens, passwords or credentials (Brainium redacts what it can, but don't rely on it).
