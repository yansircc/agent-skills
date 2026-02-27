# Claude Code — Agent Reference

## Permissions

The driver defaults to `--allowedTools "Bash,Read,Write,Edit,Glob,Grep"` — enough for most coding tasks. Customize via `CLAUDE_ALLOWED_TOOLS` env var in your workflow file run command:

```json
{ "run": "CLAUDE_ALLOWED_TOOLS='Bash,Read,Write,Edit,Glob,Grep,WebFetch' cat ${prompt} | ${driver}" }
```

For maximum convenience (skip all permission prompts), use `--dangerously-skip-permissions` instead:

```bash
FLAGS=(--dangerously-skip-permissions)
```

This is useful for local development in sandboxed environments but not recommended for production.

## Execution Mode

The driver always runs with `-p --verbose --output-format stream-json`. No interactive TUI — the agent reads its prompt from stdin and outputs stream-json to stdout.

Use `in_viewport: true` in the workflow to run in a tmux window for real-time visibility. The agent auto-exits when done; no manual shutdown needed.

**Fallback**: `pawl done <task>` sends exit_code=0 if the agent hangs (verify still runs).

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
