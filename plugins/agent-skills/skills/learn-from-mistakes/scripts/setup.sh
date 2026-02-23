#!/usr/bin/env bash
# Setup learn-from-mistakes guardrails in a project.
#
# Creates:
#   .claude/skills/learn-from-mistakes/{scripts,references}/
#   .claude/skills/learn-from-mistakes/scripts/guardrails.sh
# Registers:
#   PreToolUse  hook → guardrails.sh (match Edit|Write|MultiEdit|Bash)
#   PostToolUse hook → validate.sh   (match Write|Edit)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
SKILL_DIR="$PROJECT_DIR/.claude/skills/learn-from-mistakes"

# ─── 1. Create project directory structure ────────────────────
mkdir -p "$SKILL_DIR/scripts" "$SKILL_DIR/references"

# ─── 2. Generate guardrails.sh ────────────────────────────────
cat > "$SKILL_DIR/scripts/guardrails.sh" << 'GUARDRAILS'
#!/usr/bin/env bash
# Reactive guardrails — reads mistake files, matches against tool_input content.
#
# PreToolUse hook. Input: JSON via stdin.
#   Exit 0 = allow (stdout JSON with additionalContext = warning)
#   Exit 2 = block (stderr shown to agent as error)
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

REFS_DIR="$(cd "$(dirname "$0")" && pwd)/../references"

# ─── Fast path ────────────────────────────────────────────────
[ -d "$REFS_DIR" ] || exit 0
shopt -s nullglob
FILES=("$REFS_DIR"/*.md)
shopt -u nullglob
[ ${#FILES[@]} -gt 0 ] || exit 0

# ─── Only process relevant tools ─────────────────────────────
case "$TOOL_NAME" in
  Edit|Write|MultiEdit|Bash) ;;
  *) exit 0 ;;
esac

# ─── Build content string for matching ────────────────────────
case "$TOOL_NAME" in
  Bash)
    CONTENT=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
    ;;
  Edit)
    CONTENT=$(echo "$INPUT" | jq -r '[.tool_input.file_path, .tool_input.old_string, .tool_input.new_string] | map(select(. != null)) | join("\n")')
    ;;
  Write)
    CONTENT=$(echo "$INPUT" | jq -r '[.tool_input.file_path, .tool_input.content] | map(select(. != null)) | join("\n")')
    ;;
  MultiEdit)
    CONTENT=$(echo "$INPUT" | jq -r '[.tool_input.file_path] + [.tool_input.edits[]? | .old_string, .new_string] | map(select(. != null)) | join("\n")')
    ;;
esac

# ─── Match against mistake files ─────────────────────────────
WARNINGS=""
BLOCK_MSG=""

for ref_file in "${FILES[@]}"; do
  match=$(grep -m1 '^match:' "$ref_file" | sed 's/^match: *//') || continue
  action=$(grep -m1 '^action:' "$ref_file" | sed 's/^action: *//') || true

  [ -z "$match" ] && continue

  if echo "$CONTENT" | grep -qE "$match"; then
    filename=$(basename "$ref_file")

    if [ "$action" = "block" ]; then
      message=$(grep -m1 '^message:' "$ref_file" | sed 's/^message: *//') || true
      BLOCK_MSG="${BLOCK_MSG}${message:-See $filename}\n"
    else
      WARNINGS="${WARNINGS}⚠️ 读 @.claude/skills/learn-from-mistakes/references/${filename}\n"
    fi
  fi
done

# ─── Block takes priority ────────────────────────────────────
if [ -n "$BLOCK_MSG" ]; then
  printf "BLOCKED:\n%b" "$BLOCK_MSG" >&2
  exit 2
fi

# ─── Inject context warnings ─────────────────────────────────
if [ -n "$WARNINGS" ]; then
  CTX=$(printf "%b" "$WARNINGS")
  jq -n --arg ctx "$CTX" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $ctx
    }
  }'
  exit 0
fi

exit 0
GUARDRAILS

chmod +x "$SKILL_DIR/scripts/guardrails.sh"
echo "✓ Generated guardrails.sh"

# ─── 3. Register hooks in .claude/settings.json ──────────────
SETTINGS="$PROJECT_DIR/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"

# Idempotency: skip if already registered
if [ -f "$SETTINGS" ] && grep -q "guardrails.sh" "$SETTINGS"; then
  echo "✓ Hooks already registered"
  exit 0
fi

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

GUARDRAILS_CMD="bash .claude/skills/learn-from-mistakes/scripts/guardrails.sh"
VALIDATE_CMD="bash $SCRIPT_DIR/validate.sh"

tmp=$(mktemp)
jq \
  --arg g_cmd "$GUARDRAILS_CMD" \
  --arg v_cmd "$VALIDATE_CMD" \
  '
  .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{
    matcher: "Edit|Write|MultiEdit|Bash",
    hooks: [{type: "command", command: $g_cmd, timeout: 5}]
  }]) |
  .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [{
    matcher: "Write|Edit",
    hooks: [{type: "command", command: $v_cmd, timeout: 3}]
  }])
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"

echo "✓ Hooks registered in .claude/settings.json"
echo ""
echo "Done! Add mistake files to:"
echo "  .claude/skills/learn-from-mistakes/references/<name>.md"
