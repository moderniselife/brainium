# Second brain: personal brain, MCP server and session capture

## TLDR

Brainium 0.2 adds three things on top of per-project `docs/brainium/`:

1. **A personal brain** — one git repo that follows *you* across projects, apps and accounts: preferences, cross-project learnings, sessions with no repo, and **agent cards** so any agent can be recreated on a new account.
2. **An MCP server** (`brainium mcp`) so Claude Code, Claude Desktop and Cursor can search, read and write both brains.
3. **Session capture** for Claude Code: a hook stores each transcript (redacted, private, outside git) and queues it to be filed — by **your own AI** over MCP (no extra AI calls), or by Anthropic, OpenAI, Bonsai or any OpenAI-compatible API, or with no AI at all.

[Prism](https://github.com/moderniselife/prism) sets all of this up for every profile from its Settings → Second brain. Everything below also works by hand.

## Quick start

```bash
git clone https://github.com/moderniselife/brainium.git ~/brainium
node ~/brainium/bin/brainium.mjs init-personal ~/Brainium      # creates + remembers your personal brain
node ~/brainium/bin/brainium.mjs wire --app claude-code --capture
node ~/brainium/bin/brainium.mjs wire --app claude-desktop --profile "$HOME/Library/Application Support/Claude"
node ~/brainium/bin/brainium.mjs wire --app cursor
node ~/brainium/bin/brainium.mjs snippet grok                    # paste into a Grok Bot agent
```

Push the personal brain to a **private** GitHub repo if you want it on other machines (and for Grok Bot, whose agents run in the cloud and reach it through their GitHub connector).

## What `wire` changes

| App | Changes | Undo |
|-----|---------|------|
| Claude Code (`--profile` = its `CLAUDE_CONFIG_DIR`, default `~/.claude`) | `skills/brainium/SKILL.md`, a managed block in `CLAUDE.md`, `mcpServers.brainium` in `.claude.json`, and with `--capture` a `SessionEnd` + `SessionStart` hook in `settings.json` | `brainium unwire --app claude-code --profile …` |
| Claude Desktop (`--profile` = its data folder) | `mcpServers.brainium` in `claude_desktop_config.json` (restart Desktop) | `unwire` |
| Cursor | `mcpServers.brainium` in `~/.cursor/mcp.json` (all Cursor profiles share it). For always-on logging rules, also run `scripts/install.sh --cursor` in each repo | `unwire` |
| Grok Bot | Nothing local — prints an instructions snippet for the agent (its brain is your personal brain's GitHub repo) | remove the snippet |

Edits are idempotent, keep every other setting, refuse to touch a file they can't parse, and use absolute paths to `node` (GUI apps don't get your shell's `PATH`).

## Summarizer

```bash
brainium config set summarizer.provider agent            # default: your AI files captures over MCP
brainium config set summarizer.provider none             # mechanical digest, no AI
brainium config set summarizer.provider anthropic        # key from $ANTHROPIC_API_KEY
brainium config set summarizer.provider openai           # key from $OPENAI_API_KEY; set summarizer.model
brainium config set summarizer.provider bonsai           # local; set summarizer.url (OpenAI-compatible, e.g. http://host:port/v1)
brainium config set summarizer.provider openai-compatible  # any other endpoint: summarizer.url + summarizer.model
```

`summarizer.url`, `summarizer.model` and `summarizer.apiKeyEnv` override the provider defaults (Anthropic `claude-haiku-5-5`, Bonsai `solo-quick`). Prefer an environment variable for keys; `summarizer.apiKey` stores one in the config file (mode 0600) when the hook can't see your shell environment.

With **agent** mode, captures wait in a queue; your AI sees them at session start (hook + MCP instructions), reads each with `brain_pending_get` and files it with `brain_resolve`. `brainium distill --older-than-days 7` files anything left over mechanically so nothing is lost.

## Privacy

- Transcripts are redacted (API keys, tokens, private keys, `KEY=value` secrets, credentials in URLs) **before** they touch disk, and stored in `~/.brainium-raw` (0700/0600) — never in a brain repo.
- Only the redacted digest is sent to an API summarizer, and its reply is redacted again.
- Everything written to a brain is redacted; `brain_log` tells the agent when it removed something.

## MCP tools

`brain_preflight`, `brain_search`, `brain_read`, `brain_list`, `brain_log`, `agent_card_save`, `agent_card_get`, `brain_pending`, `brain_pending_get`, `brain_resolve`, `brain_info`.

## Config

`~/.config/brainium/config.json` (or `$BRAINIUM_CONFIG`). `brainium config show` prints it with stored keys hidden.
