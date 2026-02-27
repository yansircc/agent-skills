#!/usr/bin/env bash
# Claude Code adapter for pawl — non-interactive pipe mode with stream-json output
# Use in_viewport: true in workflow to watch output in tmux
set -euo pipefail

FLAGS=(
  -p
  --verbose
  --output-format stream-json
  --allowedTools "${CLAUDE_ALLOWED_TOOLS:-Bash,Read,Write,Edit,Glob,Grep}"
)

# Per-step customization via env vars (set in workflow file run command)
[ -n "${CLAUDE_TOOLS:-}" ] && FLAGS+=(--tools "$CLAUDE_TOOLS")
[ -n "${CLAUDE_SYSTEM_PROMPT_FILE:-}" ] && FLAGS+=(--append-system-prompt-file "$CLAUDE_SYSTEM_PROMPT_FILE")
[ -n "${CLAUDE_MODEL:-}" ] && FLAGS+=(--model "$CLAUDE_MODEL")

# Derive per-step session ID: offset UUID's last hex group by step index (must remain a valid UUID)
_prefix="${PAWL_RUN_ID%-*}"
_suffix="${PAWL_RUN_ID##*-}"
SID="${_prefix}-$(printf '%012x' $(( 16#$_suffix + PAWL_STEP_INDEX )))"

if [ "${PAWL_RETRY_COUNT:-0}" -gt 0 ]; then
  claude "${FLAGS[@]}" -r "$SID" \
    -- "Fix: ${PAWL_LAST_VERIFY_OUTPUT:-verify failed}"
else
  claude "${FLAGS[@]}" --session-id "$SID"
fi
