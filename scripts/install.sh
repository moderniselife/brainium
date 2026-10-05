#!/usr/bin/env bash
# Install Cursor Second Brain into a target repository.
set -euo pipefail

FORCE=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      echo "Usage: $0 /path/to/repo [--force]"
      exit 0
      ;;
    *)
      if [[ -z "$TARGET" ]]; then TARGET="$arg"; else echo "Unexpected arg: $arg"; exit 1; fi
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 /path/to/repo [--force]"
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAFFOLD="$PKG_ROOT/scaffold/docs/second-brain"
CURSOR_RULE="$PKG_ROOT/cursor/rules/second-brain.mdc"
CURSOR_SKILL="$PKG_ROOT/cursor/skills/second-brain/SKILL.md"

if [[ ! -d "$SCAFFOLD" ]]; then
  echo "Missing scaffold at $SCAFFOLD"
  exit 1
fi

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
    # Fallback: cp only missing paths when not --force
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

echo "→ Scaffolding docs/second-brain in $TARGET"
copy_tree "$SCAFFOLD" "$TARGET/docs/second-brain"

echo "→ Installing Cursor rule and skill"
mkdir -p "$TARGET/.cursor/rules" "$TARGET/.cursor/skills/second-brain"
if [[ "$FORCE" -eq 1 ]] || [[ ! -f "$TARGET/.cursor/rules/second-brain.mdc" ]]; then
  cp "$CURSOR_RULE" "$TARGET/.cursor/rules/second-brain.mdc"
else
  echo "  (skip rule — already exists; use --force to replace)"
fi
if [[ "$FORCE" -eq 1 ]] || [[ ! -f "$TARGET/.cursor/skills/second-brain/SKILL.md" ]]; then
  cp "$CURSOR_SKILL" "$TARGET/.cursor/skills/second-brain/SKILL.md"
else
  echo "  (skip skill — already exists; use --force to replace)"
fi

echo ""
echo "Done. Next steps:"
echo "  1. cd $TARGET && git status"
echo "  2. Commit docs/second-brain and .cursor/{rules,skills}/second-brain*"
echo "  3. In Cursor, confirm second-brain rule is Always Apply"
