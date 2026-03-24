---
name: claude-delegate
description: Delegate a bounded task to a local Claude-compatible CLI runtime through a stable adapter that returns normalized JSON plus durable artifacts.
---

# Claude Delegate

Use this skill when the work is easier to bound than to do inline: a narrow implementation pass, a shell task, a review, a verification run, or a resumable follow-up on the same worker.

Your contract is the outcome boundary, not the worker's search strategy:

- `goal`
- `cwd`
- assistant role
- tool boundary
- completion contract
- optional `runtime`, `provider`, `model`, and session routing

## Runtime Model

The adapter is runtime-neutral.

- Repo default runtime: `claude`
- Built-in runtimes: `claude`, `ccc`
- Runtime selection order: explicit flag, provider profile, local user config, built-in default

Provider routing is also profile-driven:

- `native_provider`: pass `--provider ...` to runtimes that support it, such as `ccc`
- `process_env`: inject transport env vars for runtimes that do not expose native provider flags

The repo should stay generic. Machine-specific runtime/provider choices belong in user config, not in the skill source.

Default config search paths:

- `~/.codex/claude-delegate/runtime_profiles.json`
- `~/.config/claude-delegate/runtime_profiles.json`

Example: keep repo generic, but make one machine default to `ccc`:

```json
{
  "default_runtime": "ccc",
  "providers": {
    "minimax": {
      "runtime": "ccc",
      "native_provider": "minimax"
    }
  }
}
```

Example: support a non-`ccc` user through env-based routing:

```json
{
  "providers": {
    "minimax": {
      "runtime": "claude",
      "process_env": {
        "ANTHROPIC_BASE_URL": "${MINIMAX_BASE_URL}",
        "ANTHROPIC_AUTH_TOKEN": "${MINIMAX_AUTH_TOKEN}"
      }
    }
  }
}
```

Example: define an explicit official-direct profile (no secrets in file):

```json
{
  "providers": {
    "official": {
      "runtime": "claude",
      "process_env": {
        "ANTHROPIC_BASE_URL": "${CLAUDE_DIRECT_BASE_URL}",
        "ANTHROPIC_AUTH_TOKEN": "${CLAUDE_DIRECT_AUTH_TOKEN}"
      }
    }
  }
}
```

Then run with `--provider official` and set env at runtime:

```bash
export CLAUDE_DIRECT_BASE_URL='https://...'
export CLAUDE_DIRECT_AUTH_TOKEN='...'
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --runtime claude \
  --provider official \
  --cwd /abs/path \
  --assistant-role explorer \
  --prompt 'Say hello and finish.'
```

## Truth Surfaces

Trust these in order:

- `request.json`
- `job.json`
- `normalized.json`
- `handoff.json`
- `workspace.patch`

Treat these as observability only:

- `events.jsonl`
- `stdout.jsonl`
- `stderr.txt`

If `job.json` or `normalized.json` already answers the question, do not infer state from the raw transcript.

## Fast Path

Run one bounded task:

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --cwd /abs/path \
  --assistant-role explorer \
  --prompt 'Inspect the repo and return a short JSON summary.'
```

Run asynchronously, then wait without busy polling:

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --submit \
  --cwd /abs/path \
  --assistant-role implementer \
  --prompt 'Make the bounded fix and return structured output.'
```

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --wait \
  --job-path /tmp/claude-delegate-runs/.../<job-id>
```

Wait on multiple jobs:

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --wait-any \
  --job-path /tmp/claude-delegate-runs/.../<job-a> \
  --job-path /tmp/claude-delegate-runs/.../<job-b>
```

Pick a runtime or provider explicitly when needed:

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --cwd /abs/path \
  --runtime ccc \
  --provider minimax \
  --assistant-role explorer \
  --prompt 'Return a short JSON status.'
```

Resume, fork, or retry from a prior job:

```bash
npx tsx /Users/yansir/.codex/skills/claude-delegate/src/cli/index.ts \
  --resume-job /tmp/claude-delegate-runs/.../<job-id> \
  --delta-prompt 'Continue and finish.'
```

## Request Rules

- Use `--prompt` for simple jobs.
- Use `--task-packet-json` or `--task-packet-file` when execution bounds matter.
- Use `--schema-json`, `--schema-file`, `--completion-contract-json`, or `--completion-contract-file` when the result must be typed.
- Omit `--tools` to leave tool selection to the runtime.
- Use `--tools 'Bash,Read'` for an explicit hard boundary.
- Use `--tools ''` for an explicit no-tools boundary.
- Use `--provider` only when you want a named provider profile or native provider route.
- Add `--model` only when you need an exact provider/model pair.
- Use `--runtime`, `--runtime-bin`, or `--runtime-config` only for explicit overrides.
- Use `--session-id` for a stable worker identity.
- Use `--resume-session-id` to continue an existing session directly.

## Settings Boundary

The adapter owns the job-local settings file.

- Each job gets an artifact-local `claude_settings.json`.
- Omitting `--settings` does not inherit `~/.claude/settings.json`.
- If request-time transport is explicit, conflicting transport keys in supplied settings are scrubbed.
- If request-time model is explicit, conflicting top-level `model` is scrubbed.
- The adapter injects its own `PreToolUse:Bash` guardrail hook.

This keeps request-time routing as the source of truth.

## Execution Workspace

Implementer jobs can run outside the source workspace.

- `request.cwd` stays the logical source workspace and routing identity.
- The worker runs in an execution workspace.
- `workspace.patch` and `workspace_changes` are mapped back onto source paths.
- Verification commands run in the execution workspace.
- `job.json` and `normalized.json` expose `execution_workspace` metadata.

`execution_policy.workspace_mode`:

- `auto`: use `worktree` for clean git repos, otherwise `copy`
- `worktree`: require a clean git repo
- `copy`: mirror the source tree into an isolated temp workspace
- `shared`: run directly in the source workspace

## Shell Boundary

Delegated shell work must be non-interactive.

- Do not rely on prompts, pagers, editors, passwords, or confirmation screens.
- Prefer native non-interactive flags such as `-f`, `-y`, `--yes`, or `--no-input`.
- If aliases may interfere, use `command rm`, `command mv`, `command cp`, and similar alias-safe forms.
- If stdin confirmation is unavoidable, pipe it explicitly.

Read [interactive-commands-skip-confirm.md](/Users/yansir/.codex/skills/claude-delegate/references/bash/interactive-commands-skip-confirm.md) when the task touches alias-sensitive or normally interactive shell commands.

## Session And Lineage

- `--session-routing new` starts a fresh runtime session.
- `--session-routing auto` reuses the latest resumable session matching workspace boundary, runtime, role, task type, provider, and model.
- Active sessions are never auto-reused.
- `--resume-job` continues the same logical thread from a prior job.
- `--fork-job` starts a fresh session with parent handoff context.
- `--retry-job` starts a fresh session for the same work shape after failure or bad output.

Use `handoff.json` as the durable cross-job context surface.

## Operations

- `--status`
- `--wait`
- `--wait-any`
- `--wait-all`
- `--cancel`
- `--pause`
- `--ledger`
- `--ledger-stats`
- `--list-sessions`
- `--prune-terminal-older-than-hours`
- `--compact-terminal-older-than-hours`

`--wait` is lock-based, not a busy poll loop.

## Result Read Path

Read `normalized.json` first. Drop to `job.json` for runtime state. Drop to `handoff.json`, `workspace.patch`, or raw transcript files only if the normalized view is insufficient.

Fields that usually matter:

- `ok`
- `error_type`, `error_message`, `exit_code`
- `runtime`, `session_id`, `provider`, `model`, `model_usage`
- `completion`, `structured_output`, `result`
- `boundary`, `verification`
- `changed_files`, `diff_summary`, `findings`, `open_risks`
- artifact paths under `artifacts.*`

## Failure Rules

- If `ok` is `false`, the run failed even if `result` contains text.
- If a schema or completion contract was supplied but `structured_output` is missing, treat that as a protocol failure.
- If you need live state, trust `job.json`.
- If you need actual file deltas, trust `workspace.patch`.
- If the worker changed files or ran checks, do your own targeted verification before reporting success upstream.
