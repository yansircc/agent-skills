const DEFAULT_SESSION_HEALTH_STATUS = "healthy";
const SOFT_CAP_NUM_TURNS = 24;
const SOFT_CAP_DURATION_MS = 180_000;
const SOFT_CAP_CACHE_READ_INPUT_TOKENS = 250_000;
const PROMPT_TOO_LONG_TEXT = "prompt is too long";

function asInt(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

export function extractCacheReadInputTokens(
  modelUsage: unknown,
): number | null {
  if (!modelUsage || typeof modelUsage !== "object" || Array.isArray(modelUsage))
    return null;

  let total = 0;
  let seen = false;
  for (const bucket of Object.values(modelUsage as Record<string, unknown>)) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    const b = bucket as Record<string, unknown>;
    for (const key of ["cacheReadInputTokens", "cache_read_input_tokens"]) {
      const value = asInt(b[key]);
      if (value === null) continue;
      total += value;
      seen = true;
      break;
    }
  }

  return seen ? total : null;
}

function promptTooLong(item: Record<string, unknown>): boolean {
  const errorMessage = item.error_message;
  if (typeof errorMessage !== "string") return false;
  return errorMessage.toLowerCase().includes(PROMPT_TOO_LONG_TEXT);
}

export interface SessionHealthAccumulator {
  _last_cache_read_input_tokens: number | null;
  _last_duration_ms: number | null;
  _last_num_turns: number | null;
  _prompt_too_long_count: number;
  _total_num_turns: number;
}

export function initializeSessionHealth(
  item: Record<string, unknown>,
): SessionHealthAccumulator {
  const totalNumTurns = asInt(item.num_turns) ?? 0;
  return {
    _last_cache_read_input_tokens: extractCacheReadInputTokens(
      item.model_usage,
    ),
    _last_duration_ms: asInt(item.duration_ms),
    _last_num_turns: asInt(item.num_turns),
    _prompt_too_long_count: promptTooLong(item) ? 1 : 0,
    _total_num_turns: totalNumTurns,
  };
}

export function accumulateSessionHealth(
  accumulator: SessionHealthAccumulator,
  item: Record<string, unknown>,
): void {
  const numTurns = asInt(item.num_turns);
  if (numTurns !== null) accumulator._total_num_turns += numTurns;
  if (promptTooLong(item)) accumulator._prompt_too_long_count += 1;
}

export interface SessionHealth {
  status: string;
  reasons: string[];
  last_num_turns: number | null;
  last_duration_ms: number | null;
  last_cache_read_input_tokens: number | null;
  prompt_too_long_count: number;
  total_num_turns: number;
}

export function finalizeSessionHealth(
  accumulator: SessionHealthAccumulator,
): SessionHealth {
  const reasons: string[] = [];
  let status = DEFAULT_SESSION_HEALTH_STATUS;

  if (accumulator._prompt_too_long_count > 0) {
    status = "saturated";
    reasons.push("prompt_too_long");
  }

  if (
    accumulator._last_num_turns !== null &&
    accumulator._last_num_turns >= SOFT_CAP_NUM_TURNS
  ) {
    reasons.push("last_num_turns_soft_cap");
  }

  if (
    accumulator._last_duration_ms !== null &&
    accumulator._last_duration_ms >= SOFT_CAP_DURATION_MS
  ) {
    reasons.push("last_duration_soft_cap");
  }

  if (
    accumulator._last_cache_read_input_tokens !== null &&
    accumulator._last_cache_read_input_tokens >=
      SOFT_CAP_CACHE_READ_INPUT_TOKENS
  ) {
    reasons.push("last_cache_read_input_tokens_soft_cap");
  }

  if (status !== "saturated" && reasons.length > 0) {
    status = "soft_capped";
  }

  return {
    status,
    reasons,
    last_num_turns: accumulator._last_num_turns,
    last_duration_ms: accumulator._last_duration_ms,
    last_cache_read_input_tokens: accumulator._last_cache_read_input_tokens,
    prompt_too_long_count: accumulator._prompt_too_long_count,
    total_num_turns: accumulator._total_num_turns,
  };
}
