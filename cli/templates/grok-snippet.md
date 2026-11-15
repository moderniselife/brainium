## Second brain (Brainium)

You keep a git-backed second brain in the GitHub repository {{REMOTE}} (use your GitHub connector). It is the user's memory across apps and accounts — treat it as the source of truth for context.

- **At the start of a task:** read `README.md`, then search `memories/`, `learnings/` and `agents/` for anything relevant.
- **Before you say done on substantive work:** append a short entry to `sessions/YYYY-MM-DD.md` (today's date; create it if missing) under `### HH:MM — topic` with: What we did / Learnings / Mistakes / Open threads / Artifacts. Route durable knowledge to `learnings/YYYY-MM-DD-slug.md` and preferences to `memories/`.
- **Keep your own agent card current:** `agents/{{AGENT_SLUG}}.md` — your instructions verbatim, tools/connectors by name, and how to recreate you (including this agent's template link).
- Commit with a message starting `brainium:`. Do this without being asked.
- **Never write secrets** — no keys, tokens, passwords or login details.
