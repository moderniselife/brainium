# Cursor Second Brain

## TLDR

Portable **agent memory in git**: daily session logs, failures, learnings, and promotion paths into Cursor rules/skills. Drop into any repo so the agent captures work **without you asking** — same workflow as a disciplined household docs tree, but generic and MIT-licensed.

## What you get

| Piece | Purpose |
|-------|---------|
| `.cursor/rules/second-brain.mdc` | Always-on agent law: close-out checklist + incident triggers |
| `.cursor/skills/second-brain/SKILL.md` | End-of-turn checklist the agent reads before saying “done” |
| `docs/second-brain/` | Typed folders (`sessions/`, `failures/`, `learnings/`, …) with README indexes + `_template.md` |

## Quick install

From this repo:

```bash
./scripts/install.sh /path/to/your-project
cd /path/to/your-project
git add docs/second-brain .cursor/rules/second-brain.mdc .cursor/skills/second-brain
git commit -m "Add Cursor second brain scaffold"
```

Or clone and copy manually — see [INSTALL.md](./INSTALL.md).

## Philosophy

1. **Chat is volatile; git is memory.** Summarize substance into `docs/second-brain/sessions/YYYY-MM-DD.md`.
2. **Incidents need files, not vibes.** Build/deploy failures, trust breaks, and “you said it was done” → `failures/` (+ `learnings/` when reusable). Session bullets alone are incomplete.
3. **Index tables are mandatory.** New `failures/` or `learnings/` slugs get a row in that folder’s `README.md`.
4. **Promote repeats.** Patterns that must hold → `.cursor/rules` + a note in `second-brain/rules/`; workflows → `.cursor/skills` + `second-brain/skills/`.
5. **No secrets** in second brain. No chat dumps.

## Customize

- **Decisions:** Point `decisions/README.md` at your ADR register (default: `docs/decisions/register.md`).
- **Project-specific incidents:** Copy patterns from [extensions/](./extensions/) into your own `.mdc` rule (e.g. production data honesty, seed policies).
- **Commit/push:** The stock rule assumes you want `git commit` + `git push` on close-out; trim that in `second-brain.mdc` if your team uses another flow.

## Folder map

```
docs/second-brain/
├── sessions/       # Daily roll-ups (mandatory)
├── learnings/      # Durable knowledge
├── failures/       # Mistakes + prevention
├── memories/       # Preferences & context
├── questions/      # Researched Q&A
├── improvements/   # Follow-up actions
├── decisions/      # Pre-ADR notes → main register
├── rules/          # Why each .cursor rule exists
└── skills/         # Why each .cursor skill exists
```

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

PRs welcome. Keep templates and rules **project-agnostic**; put product-specific examples under `extensions/`.
