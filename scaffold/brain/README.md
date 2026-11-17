# Brain

## TLDR

A **shared brain** for a team of agents: one git repo where they keep what they all need (`shared/`) and what's their own (`agents/<name>/`), plus **routines** that run on a schedule. Add as many brains as you like (one per team, Prism group, profile or project) with `brainium brain add`.

## Folder map

```
shared/        # What every agent reads and writes
  sessions/ memories/ learnings/ decisions/ questions/ improvements/
agents/        # One folder per agent
  <name>/
    card.md    # Who it is: instructions, tools, how to recreate it
    memories/ learnings/ sessions/ …   # Its own notes
    …          # Any supporting docs it needs
routines/      # Scheduled jobs (prompts, upkeep, shell commands)
```

## How agents use it

- An agent says who it is on every brain call (`agent: <name>`). It **writes to its own folder** by default and to `shared/` when the others should know.
- It **searches its own folder and `shared/`**. Other agents' notes are separate by default, not locked: it can look at them when asked (`everyone: true`).
- `brain_share` moves one of an agent's notes into `shared/`.

**No secrets.** Never store keys, tokens, passwords or login details — cards name connectors, never their credentials.

## Routines

See [routines/README.md](./routines/README.md).
