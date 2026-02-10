# Claude Code — Agent Reference

## TUI 优雅关闭

Claude TUI 在输入框聚焦时吞 Ctrl+C。必须先退出输入模式：

```bash
tmux send-keys -t <session>:<task> Escape
sleep 0.5
tmux send-keys -t <session>:<task> C-c
sleep 0.5
tmux send-keys -t <session>:<task> C-c
```

→ exit code 0 → `_run` 捕获 → settle_step 正常跑 verify。

**兜底**：`pawl done <task>` 传 exit_code=0（verify 照跑，但进程生命周期不如优雅关闭干净）。

## 完成检测

读 session log，找最近的 `type: "assistant"` entry。如果最后一个 content block 是 `type: "text"`（不是 `type: "tool_use"`）→ agent 已完成工作，等待输入。

此时触发优雅关闭。

## Session Log

位置：`~/.claude/projects/-<project-hash>/<session-id>.jsonl`

- project-hash = cwd 路径去掉开头 `/`，`/` 替换为 `-`
- session-id = `$PAWL_RUN_ID-$PAWL_STEP_INDEX`（每步唯一）

`run_id` 从 `pawl status <task>` 获取，拼上 step index 即可定位 session log。

## Token 优化

工具定义占 system prompt ~18K tokens。`--tools` 是关键杠杆：

| 配置 | Tokens | 成本/调用 |
|------|--------|----------|
| 默认 (20 tools) | 19,714 | $0.0086 |
| `--tools "Bash,Write"` | ~3,000 | ~$0.003 |
| `--tools "StructuredOutput"` | 1,478 | $0.0018 |

最小化参数组合：

```bash
claude --model haiku \
  --tools "Bash,Write" \
  --setting-sources "" \
  --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands
```

按任务需要调整 `--tools`。

## 重试 Session 续接

- 首次运行：`--session-id "$SID"` 建新 session（SID = `$PAWL_RUN_ID-$PAWL_STEP_INDEX`）
- 重试：`-r "$SID"` 续接同一步骤的 session，agent 看到之前的上下文 + 新的修复指令

driver 脚本已内置此逻辑。
