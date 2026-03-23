from __future__ import annotations


DEFAULT_SESSION_HEALTH_STATUS = "healthy"
SOFT_CAP_NUM_TURNS = 24
SOFT_CAP_DURATION_MS = 180_000
SOFT_CAP_CACHE_READ_INPUT_TOKENS = 250_000
PROMPT_TOO_LONG_TEXT = "prompt is too long"


def _as_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def extract_cache_read_input_tokens(model_usage: object) -> int | None:
    if not isinstance(model_usage, dict):
        return None

    total = 0
    seen = False
    for bucket in model_usage.values():
        if not isinstance(bucket, dict):
            continue
        for key in ("cacheReadInputTokens", "cache_read_input_tokens"):
            value = _as_int(bucket.get(key))
            if value is None:
                continue
            total += value
            seen = True
            break

    return total if seen else None


def _prompt_too_long(item: dict) -> bool:
    error_message = item.get("error_message")
    if not isinstance(error_message, str):
        return False
    return PROMPT_TOO_LONG_TEXT in error_message.lower()


def initialize_session_health(item: dict) -> dict:
    total_num_turns = _as_int(item.get("num_turns")) or 0
    return {
        "_last_cache_read_input_tokens": extract_cache_read_input_tokens(item.get("model_usage")),
        "_last_duration_ms": _as_int(item.get("duration_ms")),
        "_last_num_turns": _as_int(item.get("num_turns")),
        "_prompt_too_long_count": 1 if _prompt_too_long(item) else 0,
        "_total_num_turns": total_num_turns,
    }


def accumulate_session_health(accumulator: dict, item: dict) -> None:
    num_turns = _as_int(item.get("num_turns"))
    if num_turns is not None:
        accumulator["_total_num_turns"] += num_turns
    if _prompt_too_long(item):
        accumulator["_prompt_too_long_count"] += 1


def finalize_session_health(accumulator: dict) -> dict:
    reasons: list[str] = []
    status = DEFAULT_SESSION_HEALTH_STATUS

    prompt_too_long_count = accumulator["_prompt_too_long_count"]
    if prompt_too_long_count > 0:
        status = "saturated"
        reasons.append("prompt_too_long")

    last_num_turns = accumulator["_last_num_turns"]
    if isinstance(last_num_turns, int) and last_num_turns >= SOFT_CAP_NUM_TURNS:
        reasons.append("last_num_turns_soft_cap")

    last_duration_ms = accumulator["_last_duration_ms"]
    if isinstance(last_duration_ms, int) and last_duration_ms >= SOFT_CAP_DURATION_MS:
        reasons.append("last_duration_soft_cap")

    last_cache_read_input_tokens = accumulator["_last_cache_read_input_tokens"]
    if (
        isinstance(last_cache_read_input_tokens, int)
        and last_cache_read_input_tokens >= SOFT_CAP_CACHE_READ_INPUT_TOKENS
    ):
        reasons.append("last_cache_read_input_tokens_soft_cap")

    if status != "saturated" and reasons:
        status = "soft_capped"

    return {
        "status": status,
        "reasons": reasons,
        "last_num_turns": last_num_turns,
        "last_duration_ms": last_duration_ms,
        "last_cache_read_input_tokens": last_cache_read_input_tokens,
        "prompt_too_long_count": prompt_too_long_count,
        "total_num_turns": accumulator["_total_num_turns"],
    }
