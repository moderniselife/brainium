# Example learning (copy into your repo when onboarding)

## TLDR

A **session bullet is not enough** when the user reports broken behavior, deploy fails, or docs oversold “done.” File **`failures/`** and **`learnings/`** in the same close-out as the fix.

## Incident bar

Write `failures/` when:

- Deploy, CI, or build failed (even if fixed in a follow-up commit)
- User said something is missing, fake, or untrustworthy
- Docs marked ✅ but production path was still wrong

Write `learnings/` when:

- New invariant (hooks, check script, API-only list)
- Tooling change agents must repeat

Always update `failures/README.md` / `learnings/README.md` index tables.
