---
name: pawl-foreman
description: >
  AI agent foreman — orchestrate multi-step tasks and supervise agents using pawl. Supports Claude Code / Codex mixing.
  Triggers: orchestrate, supervise, foreman, start working, assign work.
---

# pawl-foreman — AI Agent Foreman

Orchestrate multi-step tasks using pawl, supervise AI agents doing the work. Supports multi-agent mixing.

## Prerequisites

1. `which pawl` — if not installed, `cargo install pawl`
2. `.pawl/` exists — if not, `pawl init`
3. Read `.pawl/README.md` to understand pawl basics (first time only)

## Intent Routing

User says "orchestrate/design/arrange" → Orchestration section
User says "start/supervise/run" → Supervision section

---

## Orchestration

### Config Conventions

In config.json, use vars to define the driver (script that launches the agent, located in this skill's `scripts/`) and prompt path:

```json
{
  "vars": {
    "driver": "<path-to>/claude-driver.sh",
    "prompt": "<path-to>/${task}.md"
  },
  "workflow": [
    { "name": "develop", "run": "PROMPT_FILE=${prompt} ${driver}",
      "in_viewport": true, "verify": "...", "on_fail": "retry" }
  ]
}
```

### Pipe vs TUI

| Mode | run | Behavior |
|------|-----|----------|
| Pipe | `"cat ${prompt} \| ${driver}"` | Agent reads stdin, auto-exits on completion → verify runs automatically |
| TUI | `"PROMPT_FILE=${prompt} ${driver}", "in_viewport": true` | Agent runs interactively, requires completion detection and shutdown trigger |

Pipe suits deterministic tasks (fully automatic). TUI suits tasks requiring interaction, observation, or creativity.

**Principle: the driver is mode-agnostic — switching modes only changes config**. The driver internally uses `[ -t 0 ]` to auto-detect stdin; it should never be modified for mode switching. Switching Pipe ↔ TUI only requires changing the `run` format and `in_viewport` field.

### Task Prompt

pawl doesn't manage prompts. Create prompt files (path corresponds to `${prompt}` in vars), containing: goal (desired outcome, not steps), constraints (tech choices, scope, standards), acceptance criteria (maps to verify commands).

### Agent Selection

| Characteristic | Recommendation |
|---------------|----------------|
| Creative work (design, refactoring, complex bugs) | Claude Code (TUI) |
| Mechanical work (batch changes, formatting, migration) | Codex (pipe) |
| Critical steps requiring human intervention | TUI + manual verify |

Mixing: different steps in the same workflow can use different drivers. Each step's `run` points to its own driver script.

### Retry Feedback

On retry, `$PAWL_RETRY_COUNT` and `$PAWL_LAST_VERIFY_OUTPUT` are automatically available. The driver uses these to pass fix context to the agent. `$PAWL_RUN_ID` is stable across retries, used for session continuation.

### Verify Strategy

| Scenario | verify | on_fail | Effect |
|----------|--------|---------|--------|
| Has automated tests | `"cargo test"` | `"retry"` | Fast feedback, auto-fix |
| Critical path needs human review | `"manual"` | `"manual"` | Human review + human decision |
| Tests reliable but failure needs analysis | `"cargo test"` | `"manual"` | Auto-detect, human decision |
| Simple step without tests | omit | omit | Fail = terminate, manual reset |

Two constraints:

1. **verify = completeness + correctness**. Correctness (tests pass) isn't enough — an empty project passes tests too. In worktree scenarios, add completeness checks (files changed). Note that `git diff` doesn't include untracked files — use `git ls-files --others`.
2. **verify failure must produce output**. Silent failure turns retry into blind repetition. For each verify clause, ask: what does it print on failure? If nothing, add `|| { echo "..." >&2; false; }`.

### Work Step Composition

Two orthogonal dimensions:

| | auto verify | manual verify |
|---|---|---|
| **viewport** | `"in_viewport": true, "verify": "<test>", "on_fail": "retry"` | `"in_viewport": true, "verify": "manual", "on_fail": "manual"` |
| **sync** | `"on_fail": "retry"` | `"verify": "manual"` |

### Multi-Step Composition

Split work into sequential steps, each with different verify strategy (e.g., plan → execute):

```json
{ "name": "plan",    "run": "PROMPT_FILE=... ${driver}",
  "in_viewport": true, "verify": "manual", "on_fail": "manual" },
{ "name": "develop", "run": "PROMPT_FILE=... ${driver}",
  "in_viewport": true, "verify": "cargo test", "on_fail": "retry" }
```

Plan rejected: `pawl reset --step` to roll back the plan step.

### Git Worktree Skeleton

Use worktrees to isolate file changes per task. Define git variables in `vars`, reference in workflow:

```json
{
  "vars": {
    "base_branch": "main",
    "branch": "pawl/${task}",
    "worktree": "${project_root}/.pawl/worktrees/${task}"
  },
  "workflow": [
    { "name": "setup",   "run": "git branch ${branch} ${base_branch} 2>/dev/null; git worktree add ${worktree} ${branch}" },
    { "name": "develop", "run": "PROMPT_FILE=... ${driver}",
      "in_viewport": true, "verify": "cd ${worktree} && <completeness> && <test>",
      "on_fail": "retry" },
    { "name": "merge",   "run": "cd ${project_root} && git merge --squash ${branch} && git commit -m 'feat(${task}): merge'" },
    { "name": "cleanup", "run": "git -C ${project_root} worktree remove ${worktree} --force 2>/dev/null; git -C ${project_root} branch -D ${branch} 2>/dev/null; true" }
  ]
}
```

Multi-task: `pawl start task-a && pawl start task-b` — each task gets independent JSONL/worktree/viewport.

### .env Secrets

Don't put secrets in pawl vars (they appear in logs). Load at shell level:

```json
{
  "vars": { "env": "set -a && source ${project_root}/.env.local && set +a" },
  "workflow": [
    { "name": "deploy", "run": "${env} && npm run deploy" }
  ]
}
```

---

## Supervision

### Pipe Mode (Fully Automatic)

```bash
pawl start <task>        # Blocks until completed or failed
```

On failure, check verify_output for diagnosis:

```bash
pawl log <task> --step <N>   # step_finished event contains verify_output
```

### TUI Mode (Semi-Automatic)

1. `pawl start <task>` → viewport launches, returns immediately
2. Read agent session log to check output (path in agent reference)
3. Detect agent completion → trigger shutdown (shutdown method varies by agent, see agent reference)
4. `pawl _run` captures exit → auto-runs verify → complete or retry

**Fallback**: `pawl done <task>` sends exit_code=0 to settle_step (verify still runs). Use when shutdown methods are inconvenient.

### Monitoring Tools

| Method | Command | Scenario |
|--------|---------|----------|
| Wait | `pawl wait <task> --until waiting,completed,failed [-t 60]` | Suspend while waiting for results in multi-task parallel |
| Event stream | `pawl events --follow [--type step_finished,step_yielded]` | Real-time dashboard |
| Logs | `pawl log <task> --all` | Step-level diagnosis (verify_output) |
| Agent logs | Read session log directly (path in agent reference) | Tool-level diagnosis (what agent did) |
| Poll | `pawl list` | One-time status snapshot |

Multi-task parallel wait:

```bash
pawl wait task-a --until waiting,completed,failed &
pawl wait task-b --until waiting,completed,failed &
wait
pawl list   # All settled, process one by one
```

### Key Constraints

- **Viewport failure has two paths**: (1) Normal: viewport killed → `_run` captures → normal failure routing (retry/yield/fail per on_fail). (2) Safety net: `_run` crashes → `viewport_lost` passively detected by status/list/wait/done. Periodic polling catches path 2.
- **in_viewport completion has two paths**: (A) Agent exits (or graceful shutdown) → `_run` → verify. (B) `pawl done` → verify. **Prefer A** — clean process lifecycle.
- **Retries exhausted**: After max_retries, status becomes Failed, requires human intervention.

### Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| "Task already running" | Another pawl start is running | `pawl stop <task> && pawl start <task>` |
| viewport_lost but process alive | Viewport name conflict | `tmux list-windows -t <session>` to check |
| Dependency blocked | Predecessor task not completed | `pawl list` to find blocking source |
| JSONL corrupted | Write interrupted | `pawl reset` |
| Agent finished but step still running | TUI agent doesn't auto-exit | Read session log to confirm completion → trigger shutdown (see agent reference) |

---

## Agent Reference

| Agent | Details | Driver |
|-------|---------|--------|
| Claude Code | [references/cc.md](references/cc.md) | `scripts/claude-driver.sh` |
| Codex | references/codex.md (future) | — |
