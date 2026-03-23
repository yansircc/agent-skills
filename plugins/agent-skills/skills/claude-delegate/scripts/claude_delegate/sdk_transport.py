"""SDK transport adapter.

Maps between ``claude-agent-sdk`` message objects and the envelope /
event formats consumed by the rest of claude-delegate.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from .runtime_profiles import build_process_env

# ---------------------------------------------------------------------------
# SDK options construction
# ---------------------------------------------------------------------------

_INTERACTIVE_CMD_RE = re.compile(r"^((command\s+)|\\)?(rm|cp|mv)\s+[^-\s]")


async def _bash_guardrail(input_data: dict, _tool_use_id: str | None, _context: Any) -> dict:
    """Python port of ``hooks/bash_guardrails.sh``.

    Blocks bare ``rm``, ``cp``, ``mv`` without ``-f`` flag to prevent
    interactive prompts that hang a headless delegate runtime.  Scans
    ``references/bash/*.md`` for additional match/block rules.
    """
    if input_data.get("tool_name") != "Bash":
        return {}

    command = (input_data.get("tool_input") or {}).get("command", "")
    if not command:
        return {}

    refs_dir = Path(__file__).resolve().parents[1] / "references" / "bash"
    if not refs_dir.is_dir():
        return {}

    warnings: list[str] = []
    blocks: list[str] = []

    for ref_file in sorted(refs_dir.glob("*.md")):
        match_pattern, action, message, title = _parse_ref_frontmatter(ref_file)
        if match_pattern is None:
            continue
        if not re.search(match_pattern, command):
            continue
        if action == "block":
            label = f"{message or f'See {ref_file.name}'}"
            if title:
                label += f" ({title})"
            blocks.append(label)
        else:
            label = f"\u26a0\ufe0f Read {ref_file}"
            if title:
                label += f" \u2014 {title}"
            warnings.append(label)

    if blocks:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "BLOCKED:\n" + "\n".join(blocks),
            }
        }
    if warnings:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": "\n".join(warnings),
            }
        }
    return {}


def _parse_ref_frontmatter(path: Path) -> tuple[str | None, str, str | None, str | None]:
    """Extract ``match``, ``action``, ``message``, and first ``# title``."""
    text = path.read_text()
    match_val: str | None = None
    action = "inject"
    message: str | None = None
    title: str | None = None

    in_fm = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "---":
            if not in_fm:
                in_fm = True
                continue
            else:
                in_fm = False
                continue
        if in_fm:
            if stripped.startswith("match:"):
                match_val = stripped[len("match:"):].strip()
            elif stripped.startswith("action:"):
                action = stripped[len("action:"):].strip() or "inject"
            elif stripped.startswith("message:"):
                message = stripped[len("message:"):].strip() or None
        elif stripped.startswith("# ") and title is None:
            title = stripped[2:].strip() or None

    return match_val, action, message, title


def _normalize_extra_arg_flag(flag: str) -> str:
    normalized = flag.strip()
    while normalized.startswith("-"):
        normalized = normalized[1:]
    if not normalized:
        raise ValueError("Provider profile extra_args contains an empty flag.")
    return normalized


def _argv_to_extra_args(argv: list[str]) -> dict[str, str | None]:
    parsed: dict[str, str | None] = {}
    index = 0
    while index < len(argv):
        token = argv[index].strip()
        if not token:
            index += 1
            continue

        if token.startswith("-"):
            token = token.lstrip("-")
        if not token:
            raise ValueError("Provider profile extra_args contains an empty flag token.")

        if "=" in token:
            flag, value = token.split("=", 1)
            parsed[_normalize_extra_arg_flag(flag)] = value
            index += 1
            continue

        next_value = argv[index + 1].strip() if index + 1 < len(argv) else None
        if next_value and not next_value.startswith("-"):
            parsed[_normalize_extra_arg_flag(token)] = next_value
            index += 2
            continue

        parsed[_normalize_extra_arg_flag(token)] = None
        index += 1

    return parsed


def build_sdk_options(
    request: dict,
    *,
    stderr_callback: Callable[[str], None] | None = None,
) -> ClaudeAgentOptions:
    """Build ``ClaudeAgentOptions`` from a finalised request dict.

    Replaces ``build_command_from_request``.
    """
    runtime_resolution = request.get("runtime_resolution") or {}
    provider_strategy = runtime_resolution.get("provider_strategy") or {}
    execution_policy = (request.get("task_packet") or {}).get("execution_policy") or {}

    # Provider routing via extra_args (SDK has no native --provider)
    extra_args: dict[str, str | None] = {}
    native_provider = provider_strategy.get("native_provider")
    if native_provider:
        extra_args["provider"] = native_provider
    extra_args.update(_argv_to_extra_args(provider_strategy.get("extra_args", [])))

    # Structured output schema
    schema = request.get("schema")
    output_format = None if schema is None else {"type": "json_schema", "schema": schema}

    # CLI binary override (SDK defaults to bundled CLI)
    runtime_bin = request.get("runtime_bin") or runtime_resolution.get("bin")
    cli_path = runtime_bin if runtime_bin and runtime_bin != "claude" else None

    # Environment variables for provider routing
    env = build_process_env(request)

    # Hooks: bash guardrails as Python callback
    hooks: dict[str, list[HookMatcher]] = {
        "PreToolUse": [HookMatcher(matcher="Bash", hooks=[_bash_guardrail])],
    }

    # Tools
    tools_value = request.get("tools")
    tools: list[str] | None = None
    if tools_value is not None:
        tools = [t for t in tools_value.split(",") if t] if tools_value else []

    return ClaudeAgentOptions(
        system_prompt=request["system_prompt"],
        model=request.get("model"),
        tools=tools,
        permission_mode="bypassPermissions",
        cwd=(request.get("execution_workspace") or {}).get("execution_cwd") or request["cwd"],
        cli_path=cli_path,
        resume=request.get("resume_session_id"),
        max_budget_usd=execution_policy.get("max_budget_usd"),
        settings=request.get("settings"),
        env=env,
        setting_sources=[],
        include_partial_messages=True,
        hooks=hooks,
        extra_args=extra_args,
        thinking={"type": "enabled", "budget_tokens": 10000},
        stderr=stderr_callback,
        output_format=output_format,
    )


# ---------------------------------------------------------------------------
# Message → event dict (events.jsonl compat)
# ---------------------------------------------------------------------------

def _content_blocks_to_dicts(blocks: list) -> list[dict]:
    """Serialize SDK content blocks to stream-json compatible dicts."""
    result: list[dict] = []
    for block in blocks:
        if isinstance(block, TextBlock):
            result.append({"type": "text", "text": block.text})
        elif isinstance(block, ThinkingBlock):
            result.append({"type": "thinking", "thinking": block.thinking})
        elif isinstance(block, ToolUseBlock):
            result.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
        elif isinstance(block, ToolResultBlock):
            result.append({
                "type": "tool_result",
                "tool_use_id": block.tool_use_id,
                "content": block.content,
                "is_error": block.is_error,
            })
        else:
            result.append({"type": type(block).__name__, "raw": str(block)})
    return result


def message_to_event(msg: object) -> dict | None:
    """Convert an SDK ``Message`` to a stream-json compatible dict.

    Returns ``None`` for message types that have no meaningful
    event representation (e.g. partial stream events without
    useful content).
    """
    if isinstance(msg, SystemMessage):
        event: dict = {"type": "system", "subtype": msg.subtype}
        if msg.data:
            event.update(msg.data)
        return event

    if isinstance(msg, AssistantMessage):
        return {
            "type": "assistant",
            "message": {
                "model": msg.model,
                "content": _content_blocks_to_dicts(msg.content),
            },
        }

    if isinstance(msg, UserMessage):
        content = msg.content
        if isinstance(content, str):
            content_dicts = [{"type": "text", "text": content}]
        elif isinstance(content, list):
            content_dicts = _content_blocks_to_dicts(content)
        else:
            content_dicts = [{"type": "text", "text": str(content)}]
        event = {"type": "user", "message": {"content": content_dicts}}
        if msg.tool_use_result is not None:
            event["tool_use_result"] = msg.tool_use_result
        return event

    if isinstance(msg, ResultMessage):
        return {
            "type": "result",
            "subtype": msg.subtype,
            "session_id": msg.session_id,
            "is_error": msg.is_error,
            "duration_ms": msg.duration_ms,
            "duration_api_ms": msg.duration_api_ms,
            "num_turns": msg.num_turns,
            "total_cost_usd": msg.total_cost_usd,
            "model_usage": msg.usage,
            "result": msg.result,
            "stop_reason": msg.stop_reason,
            "structured_output": msg.structured_output,
        }

    if isinstance(msg, StreamEvent):
        # Partial events — the key addition for thinking_delta visibility
        return {
            "type": "stream_event",
            "uuid": msg.uuid,
            "session_id": msg.session_id,
            "event": msg.event,
        }

    return None


# ---------------------------------------------------------------------------
# Result → envelope fields
# ---------------------------------------------------------------------------

def result_to_envelope_fields(result: ResultMessage) -> dict:
    """Extract normalised envelope fields from a ``ResultMessage``."""
    fields: dict[str, Any] = {
        "session_id": result.session_id,
        "duration_ms": result.duration_ms,
        "model_usage": result.usage,
        "num_turns": result.num_turns,
        "stop_reason": result.stop_reason,
        "total_cost_usd": result.total_cost_usd,
        "result": result.result,
        "structured_output": result.structured_output,
    }
    if result.is_error:
        fields["ok"] = False
        fields["error_type"] = "delegate_error"
        fields["error_message"] = result.result or "delegate reported is_error=true"
    else:
        fields["ok"] = True
    return fields


# ---------------------------------------------------------------------------
# Tool-use extraction from SDK messages
# ---------------------------------------------------------------------------

def extract_tool_uses_from_messages(messages: list) -> list[dict]:
    """Pull tool-use blocks out of collected ``AssistantMessage`` objects."""
    tool_uses: list[dict] = []
    for msg in messages:
        if not isinstance(msg, AssistantMessage):
            continue
        for block in msg.content:
            if isinstance(block, ToolUseBlock):
                tool_uses.append({
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })
    return tool_uses
