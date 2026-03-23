from __future__ import annotations

import json


MAX_LIST_ITEMS = 3
MAX_STRING_CHARS = 200


def prompt_literal(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def _truncate_text(value: object, max_chars: int = MAX_STRING_CHARS) -> str:
    normalized = " ".join(str(value).split())
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[: max_chars - 3]}..."


def _compact_string_list(values: list[object], *, limit: int = MAX_LIST_ITEMS) -> list[str]:
    result: list[str] = []
    for value in values:
        if value in (None, ""):
            continue
        result.append(_truncate_text(value))
        if len(result) >= limit:
            break
    return result


def _compact_findings(findings: list[dict], *, limit: int = MAX_LIST_ITEMS) -> list[dict]:
    result: list[dict] = []
    for finding in findings[:limit]:
        item: dict = {}
        for key in ("severity", "file", "line"):
            value = finding.get(key)
            if value not in (None, ""):
                item[key] = value
        issue = finding.get("issue")
        if issue:
            item["issue"] = _truncate_text(issue)
        if item:
            result.append(item)
    return result


def compact_prior_step(step: dict) -> dict:
    payload: dict = {}
    for key in ("role", "ok", "error_type", "boundary_status", "verification_status"):
        value = step.get(key)
        if value is not None:
            payload[key] = value

    summary = step.get("summary")
    if summary:
        payload["summary"] = _truncate_text(summary)

    findings = _compact_findings(step.get("findings", []))
    if findings:
        payload["findings"] = findings

    for key in ("open_risks", "changed_files", "diff_summary", "files_examined", "test_commands", "suggested_actions"):
        items = _compact_string_list(step.get(key, []))
        if items:
            payload[key] = items

    return payload


def compact_parent_handoff(parent_handoff: dict) -> dict:
    payload: dict = {}
    for key in ("assistant_role", "ok", "error_type", "boundary_status", "verification_status"):
        value = parent_handoff.get(key)
        if value is not None:
            payload[key] = value

    for key in ("summary", "error_message"):
        value = parent_handoff.get(key)
        if value:
            payload[key] = _truncate_text(value)

    task_packet_summary = parent_handoff.get("task_packet_summary") or {}
    if task_packet_summary:
        task_payload: dict = {}
        if task_packet_summary.get("goal"):
            task_payload["goal"] = _truncate_text(task_packet_summary["goal"])
        if task_packet_summary.get("task_type"):
            task_payload["task_type"] = task_packet_summary["task_type"]
        if task_payload:
            payload["task_packet_summary"] = task_payload

    execution_summary = parent_handoff.get("execution_summary") or {}
    execution_payload = {
        key: execution_summary.get(key)
        for key in ("duration_ms", "num_turns", "total_cost_usd")
        if execution_summary.get(key) is not None
    }
    if execution_payload:
        payload["execution_summary"] = execution_payload

    findings = _compact_findings(parent_handoff.get("findings", []))
    if findings:
        payload["findings"] = findings

    for key in ("open_risks", "changed_files", "diff_summary", "files_examined", "test_commands", "suggested_actions"):
        items = _compact_string_list(parent_handoff.get(key, []))
        if items:
            payload[key] = items

    return payload


def render_structured_item(title: str, payload: dict | None) -> list[str]:
    if not payload:
        return []
    return [title, f"- {prompt_literal(payload)}"]


def render_structured_items(title: str, payloads: list[dict]) -> list[str]:
    items = [payload for payload in payloads if payload]
    if not items:
        return []
    lines = [title]
    lines.extend(f"- {prompt_literal(payload)}" for payload in items)
    return lines
