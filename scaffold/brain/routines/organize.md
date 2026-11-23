---
name: Organize
schedule: "30 6 * * *"
type: upkeep
job: organize
enabled: true
---

Daily mechanical tidy-up: fixes the parts of the lint report that have exactly one right answer, then commits them. It moves misfiled records to their type's folder, signs unsigned shared notes from evidence (their agent folder, an import note, an `Agent:` commit trailer or the commit that added them), and rewrites old or broken record links. Anything ambiguous is left for the librarian. Upkeep jobs need no approval.
