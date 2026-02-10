---
name: codex-cli
description: OpenAI Codex CLI command reference for building executable codex commands
---

# Codex CLI

Install: `npm i -g @openai/codex` or `brew install --cask codex`

## Basic Usage

```bash
codex                            # Interactive UI
codex "query"                    # Start with prompt
codex exec "query"               # Non-interactive (required for automation)
codex resume --last              # Resume last session
codex resume <id>                # Resume specific session
codex fork <id> "query"          # Fork from session
```

## Subcommands

| Command | Description |
|---------|-------------|
| `exec` | Non-interactive execution, supports `--json` |
| `resume` | Resume session (`--last`/`--all`/`<id>`) |
| `fork` | Fork session |
| `apply` | Apply cloud task diff |
| `login/logout` | Authentication management |
| `cloud` | Cloud tasks (experimental) |
| `mcp` | MCP server mode (experimental) |

## Core Flags

| Flag | Description |
|------|-------------|
| `--model` | Model: `gpt-5-codex`(default)/`o3` etc. |
| `--cd` | Working directory |
| `--add-dir` | Extra directory with write access |
| `--sandbox` | `read-only`/`workspace-write`/`danger-full-access` |
| `--ask-for-approval` | `untrusted`/`on-failure`/`on-request`/`never` |
| `--yolo` | Skip approvals and sandbox (`--dangerously-bypass-approvals-and-sandbox`) |
| `--full-auto` | Low-friction local mode |
| `-c key=value` | Override config |
| `--profile` | Config profile |
| `-i, --image` | Attach image |
| `--search` | Enable web search |
| `--oss` | Local models (requires Ollama) |

## exec-Specific Flags

| Flag | Description |
|------|-------------|
| `--json` | JSON event output |
| `--output-last-message <file>` | Save final response |
| `--skip-git-repo-check` | Allow non-Git repos |

## Approval Modes

- **auto** (default): Free operation within working directory, confirmation required outside
- **read-only**: Read-only, modifications require confirmation
- **full-access**: No restrictions

Interactive toggle: `/approvals`

## Common Patterns

```bash
# Automated execution
codex exec "task" --json

# Working directory and permissions
codex --cd /project --add-dir ../lib "query"
codex --sandbox workspace-write "query"

# Approval control
codex --ask-for-approval never "query"
codex --yolo "query"
codex --full-auto "query"

# Config override
codex -c model=o3 -c sandbox=workspace-write "query"

# Image input
codex -i screenshot.png "describe this"
```

## Full Example

```bash
codex exec \
  --model gpt-5-codex \
  --sandbox workspace-write \
  --ask-for-approval never \
  --json \
  "implement HTTP server"
```

## Interactive Commands

`/model` `/approvals` `/review` `/fork` `Ctrl+G`(editor)

## Key Points

1. `exec` is essential for non-interactive execution
2. Config priority: CLI flags > environment variables > `~/.codex/config.toml`
3. Production use: recommend `workspace-write` or `read-only` sandbox

Docs: https://developers.openai.com/codex/cli/
