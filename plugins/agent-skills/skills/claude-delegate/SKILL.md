---
name: claude-delegate
description: Delegate a bounded task to the local Claude Code CLI (`ccc`) through a stable adapter that returns normalized JSON plus durable artifacts. Use it when you need resumable assistant work with explicit boundaries, provider control, and replayable traces.
---

# Claude Delegate

Use this skill when the work is easier to bound than to do inline: a narrow implementation pass, a shell task, a review, a verification run, or a resumable follow-up on the same Claude worker.

You are the caller. Your job is to state the outcome and the boundary:
- goal
- `cwd`
- assistant role
- tool boundary
- completion contract
- optional provider, model, and session choices

Do not over-specify search strategy unless the task is fragile. This adapter is for result contracts, not prompt choreography.

## Truth Surfaces

Trust these files in this order:

- `request.json`: typed request sent to the adapter
- `job.json`: live job state, artifact lifecycle, and lock-backed status
- `normalized.json`: final normalized delegate result
- `handoff.json`: compact cross-job context for resume, fork, and retry flows
- `workspace.patch`: semantic workspace delta when workspace observation is enabled

Treat these as observability only:

- `events.jsonl`
- `stdout.jsonl`
- `stderr.txt`

Do not infer final state from the raw transcript when `job.json` or `normalized.json` already says it.

## Fast Path

Run one bounded task:

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --cwd /abs/path \
  --assistant-role explorer \
  --prompt 'Inspect the repo and return a short JSON summary.'
```

Run asynchronously, then wait without busy polling:

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --submit \
  --cwd /abs/path \
  --assistant-role implementer \
  --prompt 'Make the bounded fix and return structured output.'
```

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --wait \
  --job-path /tmp/claude-delegate-runs/.../<job-id>
```

Wait on multiple jobs:

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --wait-any \
  --job-path /tmp/claude-delegate-runs/.../<job-a> \
  --job-path /tmp/claude-delegate-runs/.../<job-b>
```

Target a non-default provider:

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --cwd /abs/path \
  --assistant-role explorer \
  --provider minimax \
  --prompt 'Return a short JSON status.'
```

Resume, fork, or retry from a prior job:

```bash
python3 /Users/yansir/.codex/skills/claude-delegate/scripts/run_claude_delegate.py \
  --resume-job /tmp/claude-delegate-runs/.../<job-id> \
  --delta-prompt 'Continue and finish.'
```

## Request Rules

- Use `--prompt` for simple jobs.
- Use `--task-packet-json` or `--task-packet-file` when you need explicit execution bounds or verification rules.
- Use `--schema-json`, `--schema-file`, `--completion-contract-json`, or `--completion-contract-file` when the result must be typed.
- Omit `--tools` to leave tool selection to `ccc`.
- Use `--tools 'Bash,Read'` for an explicit hard boundary.
- Use `--tools ''` for an explicit no-tools boundary.
- Use `--provider` to select a non-default provider.
- Add `--model` only when you need an exact provider/model pair. If `--provider` is set and `--model` is omitted, model choice is left to the provider.
- Use `--session-id` for a stable assistant identity.
- Use `--resume-session-id` to continue an existing session directly.
- Use `--assistant-role supervisor --workflow-roles explorer,implementer,critic` only when you actually want Claude to run a local multi-role workflow.
- Repeat `--job-path` only with `--wait-any` or `--wait-all`. Single-job modes still require exactly one path.

## Settings Boundary

The adapter owns the job-local Claude settings file.

- Each job gets an artifact-local `claude_settings.json`.
- Omitting `--settings` does not inherit `~/.claude/settings.json`.
- If `--provider` is explicit, conflicting transport keys inside supplied settings are scrubbed.
- If `--provider` or `--model` is explicit, conflicting top-level `model` inside supplied settings is scrubbed.
- The adapter injects its own `PreToolUse:Bash` guardrail hook.

This keeps request-time routing and transport choices as the source of truth.

## Execution Workspace

Implementer jobs no longer need to edit the source workspace directly.

- `request.cwd` remains the logical source workspace and routing identity.
- The worker runs in an execution workspace.
- `workspace.patch` and `workspace_changes` are mapped back onto source paths.
- Verification commands run in the execution workspace.
- `job.json` and `normalized.json` expose `execution_workspace` metadata.

`execution_policy.workspace_mode` controls the strategy:

- `auto`: implementers use `worktree` for clean git repos, otherwise `copy`
- `worktree`: require a clean git repo
- `copy`: mirror the source tree into an isolated temp workspace
- `shared`: run directly in the source workspace

## Shell Boundary

Delegated shell work must be non-interactive.

- Do not rely on prompts, pagers, editors, passwords, or confirmation screens.
- Prefer tool-native non-interactive flags such as `-f`, `-y`, `--yes`, or `--no-input` when the command supports them.
- If shell aliases or functions may interfere, use `command rm`, `command mv`, `command cp`, and similar alias-safe forms.
- If stdin confirmation is unavoidable, pipe it explicitly.

Read [interactive-commands-skip-confirm.md](/Users/yansir/.codex/skills/claude-delegate/references/bash/interactive-commands-skip-confirm.md) when the task touches alias-sensitive or normally interactive shell commands.

## Session And Lineage

- `--session-routing new` starts a fresh Claude session.
- `--session-routing auto` reuses the latest resumable session matching the logical workspace boundary, `assistant_role`, `task_type`, `provider`, and `model`.
- Active sessions are never auto-reused.
- `--resume-job` continues the same logical thread from a prior job.
- `--fork-job` starts a fresh Claude session but carries forward parent handoff context.
- `--retry-job` starts a fresh Claude session for the same work shape after failure or bad output.

Use `handoff.json` as the durable cross-job context surface. Do not depend on raw transcript replay.

## Operations

These modes are stable and worth remembering:

- `--status`: read current `job.json` state immediately
- `--wait`: block on the job lock until the job reaches a terminal state
- `--wait-any`: block until the first listed job reaches a terminal state
- `--wait-all`: block until all listed jobs reach terminal state
- `--cancel`: terminate the worker and return terminal job state
- `--pause`: terminate the worker but preserve resumability on the same Claude session
- `--ledger`: list recent jobs
- `--ledger-stats`: aggregate counts, cost, and status
- `--list-sessions`: inspect resumable sessions before deciding to resume or fork
- `--prune-terminal-older-than-hours`: delete old terminal jobs
- `--compact-terminal-older-than-hours`: gzip raw observability artifacts for old terminal jobs

`--wait` is lock-based. It is not a busy-poll loop.

## Read The Result

The adapter prints one normalized JSON object. The fields that usually matter are:

- `ok`
- `error_type`, `error_message`, `exit_code`
- `assistant_role`, `task_type`, `workflow_roles`
- `session_id`, `provider`, `model`, `model_usage`
- `completion`, `structured_output`, `result`
- `boundary`, `verification`
- `changed_files`, `diff_summary`, `findings`, `open_risks`
- `artifacts.request_path`, `artifacts.job_metadata_path`, `artifacts.normalized_path`, `artifacts.handoff_path`, `artifacts.patch_path`

Read `normalized.json` first. Drop to `job.json` when you need runtime state or artifact lifecycle. Drop to raw transcript files only when the normalized view is insufficient.

## Failure Rules

- If `ok` is `false`, the run failed even if `result` contains text.
- If a schema or completion contract was supplied but `structured_output` is missing, treat that as a protocol failure.
- If you need live status, trust `job.json`, not the existence of raw output files.
- If you need actual file deltas, trust `workspace.patch`, not tool narration.
- If the job changed files or ran checks, do your own targeted verification before reporting success upstream.

## Minimal Review Loop

1. State the smallest outcome contract that would let another agent succeed.
2. Run the adapter with the narrowest tool and write boundary that still permits completion.
3. Read `normalized.json`.
4. If needed, inspect `handoff.json`, `workspace.patch`, or `events.jsonl`.
5. Accept, retry, fork, or resume based on artifact truth, not transcript impressions.
