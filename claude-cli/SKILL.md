---
name: claude-cli
description: Claude CLI command reference for building executable claude commands
---

# Claude CLI

## Basic Usage

```bash
claude                           # Interactive REPL
claude "query"                   # Start REPL with prompt
claude -p "query"                # Non-interactive, exit after execution
cat file | claude -p "query"     # Pipe input
claude -c                        # Continue most recent conversation
claude -r "session" "query"      # Resume specific session
```

## Core Flags

| Flag | Description |
|------|-------------|
| `-p, --print` | **Non-interactive mode** (required for automation) |
| `--output-format` | `text`(default)/`json`/`stream-json` |
| `--input-format` | Input format: `text`/`stream-json` (-p only) |
| `--model` | Model: `sonnet`/`opus`/`haiku` or full name |
| `--fallback-model` | Fallback model on overload (-p only) |
| `--system-prompt` | Replace system prompt |
| `--append-system-prompt` | Append to system prompt (recommended) |
| `--system-prompt-file` | Load system prompt from file (-p only) |
| `--append-system-prompt-file` | Append system prompt from file (-p only) |
| `--tools` | Limit tools: `"Bash,Edit,Read"` or `""` to disable all |
| `--allowedTools` | Allow without confirmation: `"Bash(git *)" "Read"` |
| `--disallowedTools` | Disable specific tools |
| `--mcp-config` | MCP config: file path or JSON |
| `--strict-mcp-config` | Use only specified MCP config |
| `--setting-sources` | Setting sources: `user,project,local` or `""` to disable |
| `--settings` | Additional settings file |
| `--permission-mode` | Permission mode: `plan` etc. |
| `--dangerously-skip-permissions` | Skip all permissions |
| `--permission-prompt-tool` | MCP tool for permission prompts (-p only) |
| `--max-budget-usd` | API spend limit (-p only) |
| `--max-turns` | Turn limit (-p only) |
| `--json-schema` | Validate output JSON structure (-p only) |
| `--agent` | Specify agent for current session |
| `--agents` | Custom sub-agent JSON |
| `--add-dir` | Add extra working directory |
| `--chrome` / `--no-chrome` | Enable/disable Chrome browser integration |
| `--init` / `--init-only` | Run init hooks (latter exits after running) |
| `--session-id` | Specify session ID (must be UUID) |
| `--fork-session` | Create new session on resume (with -r/-c) |
| `--from-pr` | Resume session associated with specified PR |
| `--remote` | Create web session on claude.ai |
| `--teleport` | Resume web session to local terminal |
| `--no-session-persistence` | Disable session persistence (-p only) |
| `--disable-slash-commands` | Disable slash commands |
| `--include-partial-messages` | Include partial stream events (requires stream-json) |
| `--betas` | API beta headers (API key users only) |
| `--plugin-dir` | Load plugin directory (repeatable) |
| `--debug` | Debug: `"api,mcp"` or `"!statsig,!file"` |
| `--verbose` | Verbose output |

## Token-Saving Mode

Minimize token consumption (suitable for simple tasks):

```bash
claude -p \
  --setting-sources "" \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands \
  --tools "" \
  "query"
```

Result: 76k tokens → 1.5k tokens (~98% reduction)

## Structured Output

```bash
# Boolean
claude -p --output-format json \
  --json-schema '{"type":"object","properties":{"result":{"type":"boolean"}},"required":["result"]}' \
  "query" | jq '.structured_output'

# Complex structure
claude -p --output-format json \
  --json-schema '{"type":"object","properties":{"items":{"type":"array","items":{"type":"string"}}},"required":["items"]}' \
  "query"
```

## Sub-Agent Format

```bash
claude --agents '{
  "reviewer": {
    "description": "Code review expert, use proactively after code changes",
    "prompt": "You are a senior code reviewer focusing on quality, security, and best practices",
    "tools": ["Read", "Grep", "Glob"],
    "model": "sonnet"
  }
}'
```

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | When to invoke |
| `prompt` | Yes | Sub-agent system prompt |
| `tools` | No | Available tools, inherits all by default |
| `model` | No | `sonnet`/`opus`/`haiku`/`inherit` |

## System Prompt Strategy

| Flag | Behavior | Use Case |
|------|----------|----------|
| `--system-prompt` | Full replacement | Need full control |
| `--append-system-prompt` | Append | Preserve default capabilities (recommended) |
| `--system-prompt-file` | Replace from file | Version-controlled prompts |
| `--append-system-prompt-file` | Append from file | Version-controlled appending |

## Comparison with Codex

| Operation | Claude | Codex |
|-----------|--------|-------|
| Non-interactive | `-p` | `exec` |
| Skip confirmation | `--dangerously-skip-permissions` | `--yolo` |
| JSON output | `--output-format json` | `--json` |
| Session resume | `-r` / `-c` | `resume` |

Docs: https://code.claude.com/docs/llms.txt
