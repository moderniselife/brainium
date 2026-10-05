# Install Cursor Second Brain

## TLDR

Run `scripts/install.sh` against your repo root, commit, and ensure Cursor loads `.cursor/rules/second-brain.mdc` with **Always Apply** (default when `alwaysApply: true` in the file).

## Prerequisites

- Git repo (recommended — second brain is meant to be versioned)
- [Cursor](https://cursor.com) with project rules + agent skills enabled

## Automated install

```bash
git clone https://github.com/YOUR_USER/cursor-second-brain.git  # after you publish
cd cursor-second-brain
./scripts/install.sh ~/Projects/my-app
```

The script:

1. Creates `docs/second-brain/**` from `scaffold/` (skips overwriting existing files unless you pass `--force`)
2. Copies `cursor/rules/second-brain.mdc` → `target/.cursor/rules/`
3. Copies `cursor/skills/second-brain/SKILL.md` → `target/.cursor/skills/second-brain/`

### Options

```bash
./scripts/install.sh /path/to/repo           # merge scaffold (no overwrite)
./scripts/install.sh /path/to/repo --force   # overwrite templates/READMEs from package
```

## Manual install

1. Copy `scaffold/docs/second-brain` → `your-repo/docs/second-brain`
2. Copy `cursor/rules/second-brain.mdc` → `your-repo/.cursor/rules/`
3. Copy `cursor/skills/second-brain/SKILL.md` → `your-repo/.cursor/skills/second-brain/`

## After install

1. Open the project in Cursor.
2. Confirm **Rules** includes `second-brain` (always apply).
3. Optionally add user rule: “Follow second-brain skill on every substantive task.”
4. Create `docs/decisions/register.md` if you use the `decisions/` folder and ADRs.
5. Add a project-specific extension rule from `extensions/` if you need extra incident triggers.

## Upgrading

Re-run install without `--force` to add new template files only; with `--force` to refresh stock READMEs and rules from this package (back up local edits first).

## Uninstall

Remove `.cursor/rules/second-brain.mdc`, `.cursor/skills/second-brain/`, and `docs/second-brain/` if you no longer want the workflow. Your git history keeps past captures.
