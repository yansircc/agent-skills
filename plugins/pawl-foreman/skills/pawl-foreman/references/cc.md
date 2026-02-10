# Claude Code — Agent Reference

## Permissions

The driver defaults to `--allowedTools "Bash,Read,Write,Edit,Glob,Grep"` — enough for most coding tasks. Customize via `CLAUDE_ALLOWED_TOOLS` env var in your config.json run command:

```json
{ "run": "CLAUDE_ALLOWED_TOOLS='Bash,Read,Write,Edit,Glob,Grep,WebFetch' cat ${prompt} | ${driver}" }
```

For maximum convenience (skip all permission prompts), use `--dangerously-skip-permissions` instead:

```bash
FLAGS=(--dangerously-skip-permissions)
```

This is useful for local development in sandboxed environments but not recommended for production.

## TUI Graceful Shutdown

Claude TUI swallows Ctrl+C when the input box is focused. You must exit input mode first:

```bash
tmux send-keys -t <session>:<task> Escape
sleep 0.5
tmux send-keys -t <session>:<task> C-c
sleep 0.5
tmux send-keys -t <session>:<task> C-c
```

→ exit code 0 → `_run` captures → settle_step runs verify normally.

**Fallback**: `pawl done <task>` sends exit_code=0 (verify still runs, but process lifecycle is less clean than graceful shutdown).

## Completion Detection

Read the session log, find the most recent `type: "assistant"` entry. If the last content block is `type: "text"` (not `type: "tool_use"`) → agent has finished working, waiting for input.

Trigger graceful shutdown at this point.

## Session Log

Location: `~/.claude/projects/-<project-hash>/<session-id>.jsonl`

- project-hash = cwd path with leading `/` removed, `/` replaced by `-`
- session-id = `$PAWL_RUN_ID-$PAWL_STEP_INDEX` (unique per step)

Get `run_id` from `pawl status <task>`, combine with step index to locate the session log.

## Token Optimization

Tool definitions occupy ~18K tokens in the system prompt. `--tools` is the key lever:

| Config | Tokens | Cost/call |
|--------|--------|-----------|
| Default (20 tools) | 19,714 | $0.0086 |
| `--tools "Bash,Write"` | ~3,000 | ~$0.003 |
| `--tools "StructuredOutput"` | 1,478 | $0.0018 |

Minimal parameter combination:

```bash
claude --model haiku \
  --tools "Bash,Write" \
  --setting-sources "" \
  --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands
```

Adjust `--tools` based on task requirements.

## Retry Session Continuation

- First run: `--session-id "$SID"` creates new session (SID = `$PAWL_RUN_ID-$PAWL_STEP_INDEX`)
- Retry: `-r "$SID"` continues the same step's session, agent sees previous context + new fix instructions

This logic is built into the driver script.
