#!/usr/bin/env bash
# Claude Code adapter for pawl — see references/cc.md
# Usually, there is no need to modify this script. To switch between Pipe and TUI, just change the run and in_viewport in config.json.
set -euo pipefail

FLAGS=(--dangerously-skip-permissions)
[ -t 0 ] || FLAGS+=(-p)

# Per-step customization via env vars (set in config.json run command)
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
  if [ -t 0 ]; then
    claude "${FLAGS[@]}" --session-id "$SID" \
      -- "$(cat "$PROMPT_FILE")"
  else
    claude "${FLAGS[@]}" --session-id "$SID"
  fi
fi
