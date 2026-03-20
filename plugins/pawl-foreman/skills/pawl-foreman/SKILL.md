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

Orchestration has three phases: **think → validate → scale**. Never skip straight to config.

### Phase 1: Pre-flight

Before writing any workflow file, answer these questions sequentially. Each layer's output feeds the next.

#### Classify — what's fixed, what needs a brain?

List every piece of work needed to achieve the goal. For each item, ask:

> Is the input AND output fully determined?

- **Yes → Foreman step.** git branch, worktree create, dependency install, file copy, merge, cleanup, deploy. Foreman runs these as shell commands — no agent involved.
- **No → Worker task.** The output requires reasoning, creativity, or judgment. Only these get assigned to a worker agent.

The line is simple: if you can write it as a shell command with a predictable outcome, it's a foreman step. Workers only do work where the output is uncertain.

#### Size — will the worker finish within 200K context?

For each worker task from the previous step:

> How much context does the worker need to read? How large is the expected change?

Token budget for a 200K context window:
- System prompt + tool definitions: ~20K
- Reserve ~40% for tool call interactions (reads, writes, edits, test runs)
- Leaves ~100K for reading source files + generating output

Sizing rules:

| Signal | Action |
|--------|--------|
| Expected work < 10 tool calls | **Merge** with an adjacent task. Agent startup overhead (~20K tokens) makes tiny tasks wasteful. |
| Needs to read > 15-20 files for context | **Split** along a natural seam (module, layer, or feature boundary). |
| Touches > 8-10 files | **Split.** Large change sets increase conflict risk and make verify harder. |
| One coherent unit of change, 1-5 files | **Right-sized.** Focused reads, related changes, independently verifiable. |

#### Serve — can the worker start immediately and leave cleanly?

For each worker task:

> When the worker starts, does it have everything it needs? When it finishes, does it owe anything?

- **Before** — what environment prep is needed? Create branch, worktree, install deps, generate boilerplate, copy templates → these are foreman **setup** steps, run BEFORE the worker.
- **After** — what post-processing follows? Run full test suite, merge to main, clean up worktree, deploy → these are foreman **post** steps, run AFTER the worker.
- **Prompt** — is it self-contained? Must contain: goal (desired outcome, not steps), constraints (tech choices, scope, standards), acceptance criteria (maps to verify). Worker should never need to "explore to understand what to do."

#### Pre-flight output

A task list where each task follows this shape:

```
setup  (foreman) → deterministic shell commands, no agent
work   (worker)  → the ONE creative step that needs an agent
post   (foreman) → deterministic shell commands, no agent
```

Workers only touch the middle. Foreman does the rest.

### Phase 2: Minimal Closed Loop

**Don't start all tasks.** Pick ONE task — the simplest or most representative — and run it through the full pipeline end-to-end:

1. Foreman executes setup steps (worktree, branch, deps)
2. Worker runs with the prompt
3. Verify fires and produces a clear pass/fail
4. Foreman executes post steps (merge, cleanup)
5. Confirm the deliverable is correct

What you're validating:

| Check | Failure symptom if skipped |
|-------|---------------------------|
| Driver launches correctly | "command not found", permission denied |
| Prompt produces right-shaped output | Worker goes off-track, modifies wrong files |
| Verify catches both pass AND fail | Silent false-positive, blind retry loops |
| Worktree/branch ops work | Merge conflicts, wrong paths in verify |
| Post steps succeed | Orphaned worktrees, unmerged branches |

If any step fails → fix the pipeline before scaling. One broken task is cheap to debug; eight tasks failing the same way is not.

### Phase 3: Scale

Closed loop passed → start remaining tasks. See **Supervision** for monitoring and intervention patterns.

---

### Config Reference

The sections below are reference material for configuring workflow files. Consult as needed during the phases above.

#### Workflow File Conventions

In the workflow file, use vars to define the driver (script that launches the agent, located in this skill's `scripts/`) and prompt path:

```json
{
  "vars": {
    "driver": "<path-to>/claude-driver.sh",
    "prompt": "<path-to>/${task}.md"
  },
  "workflow": [
    { "name": "develop", "run": "cat ${prompt} | ${driver}",
      "in_viewport": true, "verify": "...", "on_fail": "retry" }
  ]
}
```

#### Execution Mode

The driver runs in **pipe mode** (`-p --verbose --output-format stream-json`). Use `in_viewport: true` to make output visible in a tmux window for real-time monitoring.

| Visibility | run | Behavior |
|------------|-----|----------|
| Background | `"cat ${prompt} \| ${driver}"` | Agent runs headless, verify runs on exit |
| Viewport | `"cat ${prompt} \| ${driver}"`, `"in_viewport": true` | Same pipe mode, but output visible in tmux window |

Use `in_viewport: true` when you want to watch the agent's stream-json output in real-time. The agent behavior is identical either way — only visibility differs.

#### Task Prompt

pawl doesn't manage prompts. Create prompt files (path corresponds to `${prompt}` in vars), containing: goal (desired outcome, not steps), constraints (tech choices, scope, standards), acceptance criteria (maps to verify commands). The prompt must be **self-contained** — the worker should be able to start productive work immediately without exploring to figure out what to do.

#### Agent Selection

| Characteristic | Recommendation |
|---------------|----------------|
| Creative work (design, refactoring, complex bugs) | Claude Code |
| Semi-mechanical work requiring some judgment | Codex |
| Critical steps requiring human review | pipe + manual verify |

Mixing: different steps in the same workflow can use different drivers. Each step's `run` points to its own driver script.

#### Retry Feedback

On retry, `$PAWL_RETRY_COUNT` and `$PAWL_LAST_VERIFY_OUTPUT` are automatically available. The driver uses these to pass fix context to the agent. `$PAWL_RUN_ID` is stable across retries, used for session continuation. Default retry limit is 3; override per step with `"max_retries": N`.

#### Verify Strategy

| Scenario | verify | on_fail | Effect |
|----------|--------|---------|--------|
| Has automated tests | `"cargo test"` | `"retry"` | Fast feedback, auto-fix |
| Critical path needs human review | `"manual"` | `"manual"` | Human review + human decision |
| Tests reliable but failure needs analysis | `"cargo test"` | `"manual"` | Auto-detect, human decision |
| Simple step without tests | omit | omit | Fail = terminate, manual reset |

Two constraints:

1. **verify = completeness + correctness**. Correctness (tests pass) isn't enough — an empty project passes tests too. In worktree scenarios, add completeness checks (files changed). Note that `git diff` doesn't include untracked files — use `git ls-files --others`.
2. **verify failure must produce output**. Silent failure turns retry into blind repetition. For each verify clause, ask: what does it print on failure? If nothing, add `|| { echo "..." >&2; false; }`.

#### Work Step Composition

Two orthogonal dimensions:

| | auto verify | manual verify |
|---|---|---|
| **viewport** | `"in_viewport": true, "verify": "<test>", "on_fail": "retry"` | `"in_viewport": true, "verify": "manual", "on_fail": "manual"` |
| **sync** | `"on_fail": "retry"` | `"verify": "manual"` |

#### Multi-Step Composition

Split work into sequential steps, each with different verify strategy (e.g., develop → typecheck):

```json
{ "name": "develop", "run": "cat ${prompt} | ${driver}",
  "in_viewport": true, "verify": "cd ${worktree} && git diff --name-only HEAD | grep -q .",
  "on_fail": "retry" },
{ "name": "typecheck", "run": "cd ${worktree} && bun typecheck",
  "verify": "true", "on_fail": "retry" }
```

#### Git Worktree Skeleton

Use worktrees to isolate file changes per task. Note the foreman/worker separation — setup, merge, and cleanup are deterministic foreman steps; only develop needs a worker:

```json
{
  "vars": {
    "base_branch": "main",
    "branch": "pawl/${task}",
    "worktree": "${project_root}/.pawl/worktrees/${task}"
  },
  "workflow": [
    { "name": "setup",   "run": "git branch ${branch} ${base_branch} 2>/dev/null; git worktree add ${worktree} ${branch}" },
    { "name": "develop", "run": "cat ${prompt} | ${driver}",
      "in_viewport": true, "verify": "cd ${worktree} && <completeness> && <test>",
      "on_fail": "retry" },
    { "name": "merge",   "run": "cd ${project_root} && git merge --squash ${branch} && git commit -m 'feat(${task}): merge'" },
    { "name": "cleanup", "run": "git -C ${project_root} worktree remove ${worktree} --force 2>/dev/null; git -C ${project_root} branch -D ${branch} 2>/dev/null; true" }
  ]
}
```

Multi-task: `pawl start task-a && pawl start task-b` — each task gets independent JSONL/worktree/viewport.

#### .env Secrets

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

### Running Tasks

```bash
pawl start <task>            # Blocks until completed or failed
pawl start <task> --reset    # Reset first, then start (one command)
```

With `in_viewport: true`, the agent runs in a tmux window — stream-json output is visible in real-time. The agent auto-exits when done; verify runs automatically.

On failure, check verify_output for diagnosis:

```bash
pawl log <task> --step <N>   # step_finished event contains verify_output
```

**Fallback**: `pawl done <task>` sends exit_code=0 if the agent hangs (verify still runs).

### Monitoring Tools

| Method | Command | Scenario |
|--------|---------|----------|
| Dashboard | `pawl serve --ui <skill-dir>/ui/dist/index.html` | Live web UI: task cards, DAG, event stream |
| Wait (any) | `pawl wait task-a task-b --until completed --any` | Return when ANY task finishes |
| Wait (all) | `pawl wait task-a task-b --until completed [-t 60]` | Return when ALL tasks finish |
| Event stream | `pawl events --follow [--type step_finished,step_yielded]` | Real-time event tail |
| Logs | `pawl log <task> --all` | Step-level diagnosis (verify_output) |
| Agent logs | Read session log directly (path in agent reference) | Tool-level diagnosis (what agent did) |
| Poll | `pawl list` | One-time status snapshot |
| Ready | `pawl list --ready` | Pending tasks with deps met |

Multi-task parallel orchestration:

```bash
# Launch all ready tasks (pending + deps met)
for task in $(pawl list --ready | jq -r '.[].name'); do pawl start "$task" & done

# Wait for any to need attention, process one by one
pawl wait task-a task-b --until waiting,completed,failed --any
pawl list   # Check which settled, act accordingly
```

### Key Constraints

- **Viewport failure has two paths**: (1) Normal: viewport killed → `_run` captures → normal failure routing (retry/yield/fail per on_fail). (2) Safety net: `_run` crashes → `viewport_lost` passively detected by status/list/wait/done. Periodic polling catches path 2.
- **Retries exhausted**: After max_retries, status becomes Failed, requires human intervention.

### Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| "Task already running" | Another pawl start is running | `pawl stop <task> && pawl start <task>` or `pawl start <task> --reset` |
| viewport_lost but process alive | Viewport name conflict | `tmux list-windows -t <session>` to check |
| Dependency blocked | Predecessor task not completed | `pawl list` to find blocking source |
| JSONL corrupted | Write interrupted | `pawl reset` |
| Agent finished but step still running | Agent hung | `pawl done <task>` to force complete |

---

## Agent Reference

| Agent | Details | Driver |
|-------|---------|--------|
| Claude Code | [references/cc.md](references/cc.md) | `scripts/claude-driver.sh` |
| Codex | references/codex.md (future) | — |
