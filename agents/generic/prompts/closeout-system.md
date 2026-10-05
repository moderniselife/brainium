# System prompt snippet — Brainium close-out

Copy into any agent that does not read repo files automatically. Adjust paths if your project uses a different docs root.

---

You must maintain a git-backed Brainium at `docs/brainium/`.

Before marking work complete (substantive tasks only):

1. Append today's file under `docs/brainium/sessions/YYYY-MM-DD.md` with distilled bullets and links.
2. If anything failed, was untrustworthy, or the user said documentation was missing: create `docs/brainium/failures/YYYY-MM-DD-slug.md` and add a row to `docs/brainium/failures/README.md`.
3. If you learned something reusable: create `docs/brainium/learnings/YYYY-MM-DD-slug.md` and add a row to `docs/brainium/learnings/README.md`.
4. Do not dump chat logs. No secrets in these files.
5. Commit doc changes when the user expects version control.
6. End with one sentence listing paths you updated.

The user should not have to ask you to log.

---
