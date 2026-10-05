#!/usr/bin/env bash
# Install Brainium into a target repository.
set -euo pipefail

FORCE=0
TARGET=""
INSTALL_CURSOR=0
INSTALL_CLAUDE=0
INSTALL_GENERIC=0
INSTALL_ALL=0

usage() {
  cat <<'EOF'
Usage: install.sh /path/to/repo [options]

Options:
  --all       Install docs + Cursor + Claude + generic (default if no platform flags)
  --cursor    .cursor/rules + .cursor/skills
  --claude    .claude/skills + merge CLAUDE.md fragment
  --generic   AGENTS.md + docs/brainium/POLICY.md
  --force     Overwrite existing agent hooks and template READMEs
  -h, --help  This help

Examples:
  install.sh ~/my-app --all
  install.sh ~/my-app --cursor --claude
EOF
}

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --all) INSTALL_ALL=1 ;;
    --cursor) INSTALL_CURSOR=1 ;;
    --claude) INSTALL_CLAUDE=1 ;;
    --generic) INSTALL_GENERIC=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ -z "$TARGET" ]]; then TARGET="$arg"; else echo "Unexpected arg: $arg"; exit 1; fi
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

if [[ "$INSTALL_ALL" -eq 1 ]] || [[ "$INSTALL_CURSOR$INSTALL_CLAUDE$INSTALL_GENERIC" == "000" ]]; then
  INSTALL_CURSOR=1
  INSTALL_CLAUDE=1
  INSTALL_GENERIC=1
fi

TARGET="$(cd "$TARGET" && pwd)"
PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAFFOLD="$PKG_ROOT/scaffold/docs/brainium"
POLICY="$PKG_ROOT/core/POLICY.md"

copy_tree() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    if [[ "$FORCE" -eq 1 ]]; then
      rsync -a "$src/" "$dest/"
    else
      rsync -a --ignore-existing "$src/" "$dest/"
    fi
  else
    while IFS= read -r -d '' f; do
      rel="${f#"$src"/}"
      out="$dest/$rel"
      if [[ "$FORCE" -eq 1 ]] || [[ ! -e "$out" ]]; then
        mkdir -p "$(dirname "$out")"
        cp "$f" "$out"
      fi
    done < <(find "$src" -type f -print0)
  fi
}

cp_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ "$FORCE" -eq 1 ]] || [[ ! -f "$dest" ]]; then
    cp "$src" "$dest"
  else
    echo "  (skip — exists: $dest)"
  fi
}

merge_claude_fragment() {
  local dest="$TARGET/CLAUDE.md"
  local fragment="$PKG_ROOT/agents/claude/CLAUDE.md.fragment"
  local marker="## Brainium (mandatory)"
  if [[ -f "$dest" ]] && grep -q "$marker" "$dest" 2>/dev/null; then
    if [[ "$FORCE" -eq 1 ]]; then
      echo "  (CLAUDE.md already has Brainium section — merge manually or edit)"
    else
      echo "  (skip CLAUDE.md — already contains Brainium section)"
    fi
    return
  fi
  if [[ ! -f "$dest" ]]; then
    cp "$fragment" "$dest"
    echo "  → Created CLAUDE.md from fragment"
  else
    printf '\n\n' >> "$dest"
    cat "$fragment" >> "$dest"
    echo "  → Appended Brainium section to CLAUDE.md"
  fi
}

echo "→ Scaffolding docs/brainium in $TARGET"
copy_tree "$SCAFFOLD" "$TARGET/docs/brainium"
cp_file "$POLICY" "$TARGET/docs/brainium/POLICY.md"

if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  echo "→ Cursor: rule + skill"
  mkdir -p "$TARGET/.cursor/rules" "$TARGET/.cursor/skills/brainium"
  cp_file "$PKG_ROOT/agents/cursor/rules/brainium.mdc" "$TARGET/.cursor/rules/brainium.mdc"
  cp_file "$PKG_ROOT/agents/cursor/skills/brainium/SKILL.md" "$TARGET/.cursor/skills/brainium/SKILL.md"
fi

if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  echo "→ Claude Code: project skill + CLAUDE.md"
  mkdir -p "$TARGET/.claude/skills/brainium"
  cp_file "$PKG_ROOT/agents/claude/skills/brainium/SKILL.md" "$TARGET/.claude/skills/brainium/SKILL.md"
  merge_claude_fragment
fi

if [[ "$INSTALL_GENERIC" -eq 1 ]]; then
  echo "→ Generic: AGENTS.md"
  cp_file "$PKG_ROOT/agents/generic/AGENTS.md.template" "$TARGET/AGENTS.md"
fi

echo ""
echo "Done. Suggested git add:"
echo "  docs/brainium/"
[[ "$INSTALL_CURSOR" -eq 1 ]] && echo "  .cursor/rules/brainium.mdc .cursor/skills/brainium/"
[[ "$INSTALL_CLAUDE" -eq 1 ]] && echo "  .claude/skills/brainium/ CLAUDE.md"
[[ "$INSTALL_GENERIC" -eq 1 ]] && echo "  AGENTS.md"
echo ""
echo "Docs: agents/cursor/README.md agents/claude/README.md agents/generic/README.md"
