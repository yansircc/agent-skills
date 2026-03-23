#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
[ "$TOOL_NAME" = "Bash" ] || exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[ -n "$COMMAND" ] || exit 0

REFS_DIR="$(cd "$(dirname "$0")" && pwd)/../references/bash"
[ -d "$REFS_DIR" ] || exit 0

shopt -s nullglob
FILES=("$REFS_DIR"/*.md)
shopt -u nullglob
[ ${#FILES[@]} -gt 0 ] || exit 0

extract_frontmatter_field() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && $0 ~ "^" key ":[[:space:]]*" {
      sub("^" key ":[[:space:]]*", "", $0)
      print $0
      exit
    }
  ' "$file"
}

extract_title() {
  local file="$1"
  awk '
    /^# / {
      sub(/^# /, "", $0)
      print $0
      exit
    }
  ' "$file"
}

WARNINGS=""
BLOCK_MSG=""

for ref_file in "${FILES[@]}"; do
  match=$(extract_frontmatter_field "$ref_file" "match")
  action=$(extract_frontmatter_field "$ref_file" "action")
  [ -n "$match" ] || continue
  [ -n "$action" ] || action="inject"

  echo "$COMMAND" | grep -qE "$match" || continue

  filename=$(basename "$ref_file")
  title=$(extract_title "$ref_file")

  if [ "$action" = "block" ]; then
    message=$(extract_frontmatter_field "$ref_file" "message")
    if [ -n "$title" ]; then
      BLOCK_MSG="${BLOCK_MSG}${message:-See $filename} (${title})\n"
    else
      BLOCK_MSG="${BLOCK_MSG}${message:-See $filename}\n"
    fi
  else
    WARNINGS="${WARNINGS}⚠️ Read ${ref_file}"
    if [ -n "$title" ]; then
      WARNINGS="${WARNINGS} — ${title}"
    fi
    WARNINGS="${WARNINGS}\n"
  fi
done

if [ -n "$BLOCK_MSG" ]; then
  printf "BLOCKED:\n%b" "$BLOCK_MSG" >&2
  exit 2
fi

if [ -n "$WARNINGS" ]; then
  CTX=$(printf "%b" "$WARNINGS")
  jq -n --arg ctx "$CTX" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $ctx
    }
  }'
fi
