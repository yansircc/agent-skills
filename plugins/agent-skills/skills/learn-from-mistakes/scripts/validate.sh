#!/usr/bin/env bash
# PostToolUse hook — validate mistake file format after write.
#
# Only fires on Write/Edit to .../learn-from-mistakes/references/*.md
# Outputs additionalContext with errors if format is invalid.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Fast path: only care about mistake files in references/
case "$FILE_PATH" in
  */learn-from-mistakes/references/*.md) ;;
  *) exit 0 ;;
esac

ERRORS=""

match=$(grep -m1 '^match:' "$FILE_PATH" | sed 's/^match: *//') || true
action=$(grep -m1 '^action:' "$FILE_PATH" | sed 's/^action: *//') || true

# 1. match field required
[ -z "$match" ] && ERRORS="${ERRORS}missing match field\n"

# 2. match regex must be valid
if [ -n "$match" ]; then
  echo "" | grep -E "$match" >/dev/null 2>&1 || {
    [ $? -eq 2 ] && ERRORS="${ERRORS}invalid match regex: $match\n"
  }
fi

# 3. action must be inject or block
case "$action" in
  inject|block) ;;
  "") ERRORS="${ERRORS}missing action field\n" ;;
  *)  ERRORS="${ERRORS}action must be inject or block, got: $action\n" ;;
esac

# 4. block requires message
if [ "$action" = "block" ] && ! grep -q '^message:' "$FILE_PATH"; then
  ERRORS="${ERRORS}action=block requires a message field\n"
fi

# 5. match should target code content (WHAT), not file paths (WHERE)
if echo "$match" | grep -qE '^\*\*/|\*\.(ts|tsx|js|jsx|md|sql|css)$|^src/|^lib/|^app/'; then
  ERRORS="${ERRORS}match looks like a file path glob — should match code content instead:\n"
  ERRORS="${ERRORS}  BAD:  match: src/**/*.ts          -> triggers on any ts file\n"
  ERRORS="${ERRORS}  GOOD: match: db\\.insert.*\\.values -> triggers on batch insert code\n"
fi

# Output validation errors
if [ -n "$ERRORS" ]; then
  CTX=$(printf "MISTAKE format error (%s):\n%bFix and re-save." "$(basename "$FILE_PATH")" "$ERRORS")
  jq -n --arg ctx "$CTX" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi

exit 0
