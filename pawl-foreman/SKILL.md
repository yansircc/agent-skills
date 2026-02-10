---
name: pawl-foreman
description: >
  AI agent 工头——用 pawl 编排多步骤任务、监工 agent 干活。支持 Claude Code / Codex 混排。
  触发：编排任务、监工、orchestrate、supervise、foreman、开始干活、安排工作。
---

# pawl-foreman — AI Agent 工头

用 pawl 编排多步骤任务，监工 AI agent 干活。支持多 agent 混排。

## 前置条件

1. `which pawl` — 未安装则 `cargo install pawl`
2. `.pawl/` 存在 — 没有则 `pawl init`
3. 读 `.pawl/README.md` 了解 pawl 基础（首次使用时）

## 意图路由

用户说"编排/设计/安排" → 编排章节
用户说"开始/监工/跑起来" → 监工章节

---

## 编排

### Config 约定

config.json 中用 vars 定义 driver（启动 agent 的脚本，位于本 skill 的 `scripts/`）和 prompt 路径：

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

| 模式 | run | 行为 |
|------|-----|------|
| Pipe | `"cat ${prompt} \| ${driver}"` | agent 读 stdin，完成自动退出 → verify 自动跑 |
| TUI | `"PROMPT_FILE=${prompt} ${driver}", "in_viewport": true` | agent 交互运行，需检测完成并触发关闭 |

Pipe 适合确定性任务（全自动）。TUI 适合需要交互、观察、或创造性的任务。

**原则：driver 是模式无关的，切模式只改 config**。driver 内部 `[ -t 0 ]` 自动检测 stdin，不需要也不应该修改 driver 脚本。切换 Pipe ↔ TUI 只需改 `run` 写法和 `in_viewport` 字段。

### Task Prompt

pawl 不管 prompt。创建 prompt 文件（路径对应 vars 中的 `${prompt}`），内容包含：目标（期望结果，不是步骤）、约束（技术选型、范围、标准）、验收标准（映射到 verify 命令）。

### Agent 选型

| 特征 | 推荐 |
|------|------|
| 创造性工作（设计、重构、复杂 bug） | Claude Code (TUI) |
| 机械性工作（批量修改、格式化、迁移） | Codex (pipe) |
| 需要人工介入的关键步骤 | TUI + manual verify |

混排：同一 workflow 不同步骤用不同 driver。每个步骤的 `run` 指向各自的 driver 脚本。

### 重试反馈

重试时 `$PAWL_RETRY_COUNT` 和 `$PAWL_LAST_VERIFY_OUTPUT` 自动可用，driver 据此给 agent 传修复上下文。`$PAWL_RUN_ID` 跨 retry 稳定，用于 session 续接。

### Verify 策略

| 场景 | verify | on_fail | 效果 |
|------|--------|---------|------|
| 有自动化测试 | `"cargo test"` | `"retry"` | 快速反馈，自动修复 |
| 关键路径需人工审查 | `"manual"` | `"manual"` | 人工审 + 人工决策 |
| 测试可靠但失败需分析 | `"cargo test"` | `"manual"` | 自动检测，人工决策 |
| 简单步骤无测试 | 省略 | 省略 | 失败即终止，手动 reset |

两条约束：

1. **verify = completeness + correctness**。correctness（测试通过）不够——空项目测试也通过。worktree 场景加 completeness 检查（有文件变更），注意 `git diff` 不含 untracked files，需要 `git ls-files --others`。
2. **verify 失败时必须有输出**。静默失败使 retry 变成盲目重复。对每个 verify 子句问：它失败时打印什么？无输出则补 `|| { echo "..." >&2; false; }`。

### Work Step 组合

两个正交维度：

| | auto verify | manual verify |
|---|---|---|
| **viewport** | `"in_viewport": true, "verify": "<test>", "on_fail": "retry"` | `"in_viewport": true, "verify": "manual", "on_fail": "manual"` |
| **sync** | `"on_fail": "retry"` | `"verify": "manual"` |

### Multi-Step Composition

拆分工作为顺序步骤，每步不同 verify 策略（如 plan → execute）：

```json
{ "name": "plan",    "run": "PROMPT_FILE=... ${driver}",
  "in_viewport": true, "verify": "manual", "on_fail": "manual" },
{ "name": "develop", "run": "PROMPT_FILE=... ${driver}",
  "in_viewport": true, "verify": "cargo test", "on_fail": "retry" }
```

Plan 不通过：`pawl reset --step` 回退 plan 步骤。

### Git Worktree 骨架

用 worktree 隔离每个 task 的文件变更。在 `vars` 中定义 git 变量，workflow 中引用：

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

多任务：`pawl start task-a && pawl start task-b` — 每个 task 独立 JSONL/worktree/viewport。

### .env Secrets

secrets 不放 pawl vars（会出现在日志），用 shell 层加载：

```json
{
  "vars": { "env": "set -a && source ${project_root}/.env.local && set +a" },
  "workflow": [
    { "name": "deploy", "run": "${env} && npm run deploy" }
  ]
}
```

---

## 监工

### Pipe 模式（全自动）

```bash
pawl start <task>        # 阻塞直到完成或失败
```

失败时查 verify_output 诊断：

```bash
pawl log <task> --step <N>   # step_finished 事件含 verify_output
```

### TUI 模式（半自动）

1. `pawl start <task>` → viewport 启动，立即返回
2. 读 agent session log 检查输出（路径见 agent reference）
3. 检测 agent 完成 → 触发关闭（关闭方式因 agent 而异，见 agent reference）
4. `pawl _run` 捕获退出 → 自动跑 verify → 完成或重试

**兜底**：`pawl done <task>` 传 exit_code=0 给 settle_step（verify 照跑）。适用于关闭方式不便时。

### 监控工具

| 方式 | 命令 | 场景 |
|------|------|------|
| 等待 | `pawl wait <task> --until waiting,completed,failed [-t 60]` | 多任务并行时挂起等结果 |
| 事件流 | `pawl events --follow [--type step_finished,step_yielded]` | 实时仪表盘 |
| 日志 | `pawl log <task> --all` | 步骤级诊断（verify_output） |
| Agent 日志 | 直接读 session log（路径见 agent reference） | 工具级诊断（agent 做了什么） |
| 轮询 | `pawl list` | 一次性状态快照 |

多任务并行等待：

```bash
pawl wait task-a --until waiting,completed,failed &
pawl wait task-b --until waiting,completed,failed &
wait
pawl list   # 全部就位，逐个处理
```

### 关键约束

- **viewport 失败两条路径**：(1) 正常：viewport 被杀 → `_run` 捕获 → 正常失败路由（retry/yield/fail 按 on_fail）。(2) 安全网：`_run` 崩溃 → `viewport_lost` 由 status/list/wait/done 被动检测。周期性轮询可发现 path 2
- **in_viewport 完成两条路径**：(A) agent 退出（或优雅关闭）→ `_run` → verify。(B) `pawl done` → verify。**优先 A**——干净的进程生命周期
- **重试耗尽**：达到 max_retries 后状态变 Failed，需人工介入

### 排障

| 症状 | 原因 | 方案 |
|------|------|------|
| "Task already running" | 另一个 pawl start 在跑 | `pawl stop <task> && pawl start <task>` |
| viewport_lost 但进程存活 | viewport 名冲突 | `tmux list-windows -t <session>` 检查 |
| 依赖阻塞 | 前置 task 未完成 | `pawl list` 查阻塞源 |
| JSONL 损坏 | 写入中断 | `pawl reset` |
| Agent 完成但步骤仍在运行 | TUI agent 不自动退出 | 读 session log 确认完成 → 触发关闭（见 agent reference） |

---

## Agent Reference

| Agent | 详情 | Driver |
|-------|------|--------|
| Claude Code | [references/cc.md](references/cc.md) | `scripts/claude-driver.sh` |
| Codex | references/codex.md（未来） | — |
