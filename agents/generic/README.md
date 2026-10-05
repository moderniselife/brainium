# Generic agent setup

## TLDR

Any agent that reads repo docs can use the same **`docs/second-brain/`** tree. Wire it with **`AGENTS.md`** (widely supported) plus an optional system prompt snippet.

## Install

```bash
./scripts/install.sh /path/to/repo --generic
```

This copies:

- `agents/generic/AGENTS.md.template` → `AGENTS.md` (skip if exists unless `--force`)
- `docs/second-brain/` scaffold
- `core/POLICY.md` → `docs/second-brain/POLICY.md` (canonical copy in the project)

## AGENTS.md

Many tools (Cursor, Copilot, custom runners) load `AGENTS.md` from the repo root. The template points agents at `docs/second-brain/` and the close-out prompt.

## Custom / chat-only agents

Paste [prompts/closeout-system.md](./prompts/closeout-system.md) into:

- Custom instructions
- CI bot system prompt
- Internal agent orchestrator

## Combine with Cursor or Claude

```bash
./scripts/install.sh /path/to/repo --all
```

One `docs/second-brain/` tree; multiple hooks (`.cursor/rules`, `.claude/skills`, `AGENTS.md`).
