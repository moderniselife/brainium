---
name: Brain health
schedule: "0 7 * * 1"
type: upkeep
job: lint
enabled: true
---

Weekly check for context rot (unsigned notes, missing record fields, broken links, stale records, factories without a production prompt or evals). Writes `shared/health.md`. Upkeep jobs need no approval.
