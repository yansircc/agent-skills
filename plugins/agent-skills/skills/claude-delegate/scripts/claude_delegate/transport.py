"""Transport utilities for stream-json events.

``parse_transport`` and ``extract_tool_uses`` have been superseded by
the SDK adapter in ``sdk_transport.py``.  This module retains only
``summarize_tool_uses`` which is used by the pipeline to compact
tool-use records in the normalised envelope.
"""
from __future__ import annotations


def _truncate_text(value: str, *, limit: int = 160) -> tuple[str, bool]:
    normalized = value.replace("\r\n", "\n")
    if len(normalized) <= limit:
        return normalized, False
    return normalized[: limit - 3] + "...", True


def _summarize_input_field(key: str, value: object) -> dict[str, object]:
    if isinstance(value, str):
        preview, truncated = _truncate_text(value)
        if not truncated:
            return {key: preview}
        return {
            f"{key}_preview": preview,
            f"{key}_length": len(value),
            f"{key}_truncated": True,
        }
    if isinstance(value, (int, float, bool)) or value is None:
        return {key: value}
    if isinstance(value, list):
        sample: list[object] = []
        for item in value[:3]:
            if isinstance(item, str):
                sample.append(_truncate_text(item, limit=80)[0])
            elif isinstance(item, (int, float, bool)) or item is None:
                sample.append(item)
            elif isinstance(item, dict):
                sample.append({"keys": sorted(item.keys())[:8]})
            else:
                sample.append(type(item).__name__)
        summary: dict[str, object] = {f"{key}_count": len(value)}
        if sample:
            summary[f"{key}_sample"] = sample
        return summary
    if isinstance(value, dict):
        return {f"{key}_keys": sorted(value.keys())}
    return {f"{key}_type": type(value).__name__}


def summarize_tool_uses(tool_uses: list[dict]) -> list[dict]:
    summarized: list[dict] = []
    for item in tool_uses:
        tool_input = item.get("input")
        summary = {
            "id": item.get("id"),
            "name": item.get("name"),
            "input": {},
        }
        if isinstance(tool_input, dict):
            summarized_input: dict[str, object] = {}
            for key, value in tool_input.items():
                summarized_input.update(_summarize_input_field(key, value))
            summary["input"] = summarized_input
        else:
            summary["input"] = _summarize_input_field("value", tool_input)
        summarized.append(summary)
    return summarized
