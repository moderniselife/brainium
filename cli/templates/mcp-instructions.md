Brainium is the user's second brain: git-backed memory that survives switching apps and accounts. Project brain = docs/brainium/ in the current repo; personal brain = the user's own repo (preferences, agent cards, cross-project learnings).
- At the start of work: call brain_pending; if captured sessions are waiting, read them (brain_pending_get) and file each as a concise session entry (brain_resolve). Search (brain_search) when prior context may matter.
- Before saying done on substantive work: brain_log a session; incidents as failure (+learning); preferences as memory; new/changed agent instructions via agent_card_save.
- Do this without being asked. Never store secrets.
