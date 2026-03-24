function truncateText(
  value: string,
  limit = 160,
): [string, boolean] {
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.length <= limit) return [normalized, false];
  return [normalized.slice(0, limit - 3) + "...", true];
}

function summarizeInputField(
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (typeof value === "string") {
    const [preview, truncated] = truncateText(value);
    if (!truncated) return { [key]: preview };
    return {
      [`${key}_preview`]: preview,
      [`${key}_length`]: value.length,
      [`${key}_truncated`]: true,
    };
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return { [key]: value };
  }

  if (Array.isArray(value)) {
    const sample: unknown[] = [];
    for (const item of value.slice(0, 3)) {
      if (typeof item === "string") {
        sample.push(truncateText(item, 80)[0]);
      } else if (
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null ||
        item === undefined
      ) {
        sample.push(item);
      } else if (
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item)
      ) {
        sample.push({
          keys: Object.keys(item as Record<string, unknown>)
            .sort()
            .slice(0, 8),
        });
      } else {
        sample.push(typeof item);
      }
    }
    const summary: Record<string, unknown> = {
      [`${key}_count`]: value.length,
    };
    if (sample.length > 0) {
      summary[`${key}_sample`] = sample;
    }
    return summary;
  }

  if (typeof value === "object" && value !== null) {
    return {
      [`${key}_keys`]: Object.keys(value as Record<string, unknown>).sort(),
    };
  }

  return { [`${key}_type`]: typeof value };
}

export function summarizeToolUses(
  toolUses: Record<string, unknown>[],
): Record<string, unknown>[] {
  const summarized: Record<string, unknown>[] = [];
  for (const item of toolUses) {
    const toolInput = item.input;
    const summary: Record<string, unknown> = {
      id: item.id,
      name: item.name,
      input: {},
    };
    if (
      typeof toolInput === "object" &&
      toolInput !== null &&
      !Array.isArray(toolInput)
    ) {
      const summarizedInput: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        toolInput as Record<string, unknown>,
      )) {
        Object.assign(summarizedInput, summarizeInputField(key, value));
      }
      summary.input = summarizedInput;
    } else {
      summary.input = summarizeInputField("value", toolInput);
    }
    summarized.push(summary);
  }
  return summarized;
}
