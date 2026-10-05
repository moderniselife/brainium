# Project-specific extensions

## TLDR

The stock `brainium.mdc` is **generic**. Copy a fragment below into your own agent config:

- Cursor: `.cursor/rules/<project>-extensions.mdc`
- Claude: append to `CLAUDE.md` or a dedicated `.claude/skills/<project>/SKILL.md`
- Generic: append to `AGENTS.md`

## Example: production data honesty

See [production-data-honesty.mdc.fragment](./production-data-honesty.mdc.fragment).

## Example: commit and push policy

If your household always pushes after capture, add a user or project rule — the stock package only says “commit; push if project rules expect it” so OSS users are not forced into one git workflow.

## Contributing extensions

Submit generic patterns (not company secrets) as `.mdc.fragment` files with a one-line README entry.
