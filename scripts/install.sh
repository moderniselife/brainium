#!/usr/bin/env bash
# Install Agent Second Brain into a target repository.
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
  --generic   AGENTS.md + docs/second-brain/POLICY.md
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
SCAFFOLD="$PKG_ROOT/scaffold/docs/second-brain"
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
  local marker="## Second brain (mandatory)"
  if [[ -f "$dest" ]] && grep -q "$marker" "$dest" 2>/dev/null; then
    if [[ "$FORCE" -eq 1 ]]; then
      echo "  (CLAUDE.md already has second-brain section — merge manually or edit)"
    else
      echo "  (skip CLAUDE.md — already contains second-brain section)"
    fi
    return
  fi
  if [[ ! -f "$dest" ]]; then
    cp "$fragment" "$dest"
    echo "  → Created CLAUDE.md from fragment"
  else
    printf '\n\n' >> "$dest"
    cat "$fragment" >> "$dest"
    echo "  → Appended second-brain section to CLAUDE.md"
  fi
}

echo "→ Scaffolding docs/second-brain in $TARGET"
copy_tree "$SCAFFOLD" "$TARGET/docs/second-brain"
cp_file "$POLICY" "$TARGET/docs/second-brain/POLICY.md"

if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  echo "→ Cursor: rule + skill"
  mkdir -p "$TARGET/.cursor/rules" "$TARGET/.cursor/skills/second-brain"
  cp_file "$PKG_ROOT/agents/cursor/rules/second-brain.mdc" "$TARGET/.cursor/rules/second-brain.mdc"
  cp_file "$PKG_ROOT/agents/cursor/skills/second-brain/SKILL.md" "$TARGET/.cursor/skills/second-brain/SKILL.md"
fi

if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  echo "→ Claude Code: project skill + CLAUDE.md"
  mkdir -p "$TARGET/.claude/skills/second-brain"
  cp_file "$PKG_ROOT/agents/claude/skills/second-brain/SKILL.md" "$TARGET/.claude/skills/second-brain/SKILL.md"
  merge_claude_fragment
fi

if [[ "$INSTALL_GENERIC" -eq 1 ]]; then
  echo "→ Generic: AGENTS.md"
  cp_file "$PKG_ROOT/agents/generic/AGENTS.md.template" "$TARGET/AGENTS.md"
fi

echo ""
echo "Done. Suggested git add:"
echo "  docs/second-brain/"
[[ "$INSTALL_CURSOR" -eq 1 ]] && echo "  .cursor/rules/second-brain.mdc .cursor/skills/second-brain/"
[[ "$INSTALL_CLAUDE" -eq 1 ]] && echo "  .claude/skills/second-brain/ CLAUDE.md"
[[ "$INSTALL_GENERIC" -eq 1 ]] && echo "  AGENTS.md"
echo ""
echo "Docs: agents/cursor/README.md agents/claude/README.md agents/generic/README.md"
