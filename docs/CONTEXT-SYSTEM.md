# Brainium as a context system

## TLDR

A brain is the one governed place a team's people and agents read and write. Since 0.4 it keeps that context structured and current without anyone having to ask:

- **Records** give the brain a small ontology: projects, people, teams, customers, meetings and documents, one file each, linked to each other. Following a link is one hop, which beats searching.
- **Every note is signed** with the agent that wrote it.
- **Lint** finds rot (unsigned notes, missing fields, broken links, stale records) and a weekly routine writes the report.
- **Routines** run on a schedule or when files change, and are rolled out in stages: shadow, then limited, then full.
- **Factories**, the shared agents many people rely on, keep versioned prompts and evals.
- **Teams** get their own brains, so one team's notes don't bleed into another's.

This follows the shape argued for in Notion's essay [A new shape for work](https://www.notion.com/a-new-shape-for-work): one governed context store with a small ontology, shared factories over many personal agents, scheduled and event triggers, staged autonomy, and validation against context rot.

## The layers

| Layer | Where | Who writes it |
|---|---|---|
| An agent's own notes | `agents/<name>/` (sessions, learnings, memories, …) | that agent |
| Shared knowledge | `shared/` (sessions, decisions, learnings, memories, …) | anyone, signed |
| Records | `shared/projects/`, `people/`, `teams/`, `customers/`, `meetings/`, `documents/` | anyone, via `record_save` |
| Factory definition | `agents/<name>/card.md` (`kind: factory`), `prompts/`, `evals/` | its `maintainers` |
| Automation | `routines/` | humans approve them on each machine |
| Health | `shared/health.md` | the weekly `lint` routine |

A brain for a whole organisation can hold a brain per team in a folder of its own (for example `teams/<team>/`). Register each one with `brainium brain add`. Searches of the outer brain leave the team brains out, so team notes stay with the team unless someone searches that brain or every brain (`brain: "*"`). Cross-team handoffs go in the outer brain's `shared/`.

## Records

A record is a markdown file with frontmatter:

```markdown
---
type: project
id: launch
title: Spring launch
status: active
owner: sam
team: marketing
links: [person/sam, customer/acme, document/launch-brief]
review_by: 2026-06-30
agent: planner
created_by: planner
updated: 2026-04-02
---

# Spring launch
...
```

- `record_save` creates or updates one. Fields merge into what's there, links are added, and the body is replaced only when you give one. It stamps `updated`, `agent` and (first time) `created_by`.
- `record_get project/launch` returns the record, the title and status of everything it links to (or that a link is missing), and every note or record that links back to it.
- Link from anywhere with `[[type/id]]`, or `[[brain:type/id]]` across brains.
- Required fields: project `status` and `owner`, person `role`, customer `status`, meeting `date`, document `status`.

Prefer updating a record over writing a new note about the same thing: that's what keeps one source of truth.

## Signing

Every entry the Brainium tools write names its agent (`_agent: name_` on notes, `agent:` on records), including notes in the agent's own folder, so a note can always be traced after it's moved or shared. Agents that edit files directly should add `agent: <name>` frontmatter, or an `Agent: <name>` line on a section they add to someone else's file. Lint lists unsigned notes in the shared area.

## Health (lint)

`brainium lint [--brain NAME] [--write]`, the `brain_lint` tool, or the `brain-health` routine every new brain comes with (Mondays 07:00, upkeep, no approval needed) checks:

| Check | Meaning |
|---|---|
| `unsigned` | a note in `shared/` with no agent on it |
| `missing-field` | a record without its type's required fields |
| `broken-link` | `[[type/id]]` to a record that doesn't exist |
| `stale` | a live record (active, open, draft, testing, …) untouched for 30 days, or past its `review_by` |
| `misfiled` | a record whose `type` doesn't match its folder |
| `factory` | a factory without exactly one production prompt, or without evals |

The report goes to `shared/health.md`. Team brains are checked by their own health routine.

## Routines: triggers and stages

```markdown
---
name: Triage inbox
on: "shared/messages/*/inbox/**"   # run when these files change (any glob, comma-separated)
schedule: "0 9 * * 1-5"            # and/or on a schedule
debounce: 2m                       # wait for a burst of changes to settle (default 1m)
stage: limited                     # shadow | limited | full
limit: 3
type: prompt
agent: triage
enabled: true
---
Read the new messages and act on them.
```

- **Event triggers.** `on:` globs are matched against brain-relative paths. When a matching file changes, the routine runs once; the changed paths are passed in (`BRAINIUM_CHANGED`, and listed in a prompt routine's preface).
- **Stages.** `shadow` tells a prompt routine to change nothing outside the brain and log a proposal instead. `limited` caps it at `limit` items per run. `full` lets it work. Shell routines get `BRAINIUM_STAGE` and `BRAINIUM_LIMIT` and decide what that means. New prompt and shell routines saved with `routine_save` start in `shadow`. A human promotes them by editing `stage:`, which needs approving again on each machine.

## Factories

A factory is a shared agent many people rely on, owned by a few. Mark its card `kind: factory` with `maintainers`, then keep:

- `prompts/v<N>.md`, with `status: testing | production | retired`. Keep exactly one production version. Try changes as a new testing version, and retire old ones rather than deleting them.
- `evals/<case>.md`, with the input, what passing looks like, and a results table per prompt version.

Lint reports a factory that's missing either.

## A repo's brain

A repo can name the brain its "auto" writes go to, instead of its own `docs/brainium/`. Add `.brainium.json` at the repo root:

```json
{ "brain": "my-team" }
```

The project brain is still there by name (`brain: "project"`). An unregistered name is ignored.

## Syncing other tools in

Keep one governed store rather than giving every agent a connection to everything. To pull another tool's data in (a tracker, a CRM, meeting notes), write a shell or prompt routine that fetches it and writes records with `record_save`, on a schedule or on a file trigger. Start it in `shadow`.
