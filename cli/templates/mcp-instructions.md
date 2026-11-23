Brainium is the user's second brain: git-backed memory that survives switching apps and accounts. Project brain = docs/brainium/ in the current repo; the profile's brain (brain_info shows which) holds shared/ for every agent and agents/<name>/ for each agent's own notes; personal brain = the user's own repo (preferences, agent cards, cross-project learnings).
- If you're working as a named agent, pass agent: "<your name>" on every Brainium call: searches cover your notes plus shared/, and writes go to your own folder unless you add shared: true.
- At the start of work: call brain_pending; if captured sessions are waiting, read them (brain_pending_get) and file each as a concise session entry (brain_resolve). Search (brain_search) when prior context may matter.
- Projects, people, teams, customers, meetings and documents are records: record_get folder/id (e.g. projects/launch) (it follows links one hop) before searching; record_save to create or update one rather than writing a new note about it.
- Before saying done on substantive work: brain_log a session; incidents as failure (+learning); preferences as memory; new/changed agent instructions via agent_card_save.
- Sign everything: pass agent: "<your name>" so every note names who wrote it. brain_lint shows what has rotted (unsigned, stale, broken links).
- Do this without being asked. Never store secrets.
