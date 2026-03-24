import { summarizeText, compactPath } from "./text.js";

function extractAssistantText(parsed) {
  const content = parsed?.message?.content || [];
  return content
    .filter((item) => item?.type === "text" && item.text)
    .map((item) => item.text)
    .join(" ")
    .trim();
}

function firstToolUse(parsed) {
  const content = parsed?.message?.content || [];
  return content.find((item) => item?.type === "tool_use") || null;
}

function firstToolResult(parsed) {
  const content = parsed?.message?.content || [];
  return content.find((item) => item?.type === "tool_result") || null;
}

function summarizeToolUse(tool) {
  if (!tool) return { title: "tool", detail: "" };
  if (tool.name === "Bash") {
    const input = tool.input || {};
    return {
      title: "Bash",
      detail: summarizeText(input.description || input.command || "shell command", 120),
    };
  }
  if (tool.name === "Read") {
    return {
      title: "Read",
      detail: compactPath(tool.input?.file_path),
    };
  }
  if (tool.name === "Edit" || tool.name === "MultiEdit" || tool.name === "Write") {
    return {
      title: tool.name,
      detail: compactPath(tool.input?.file_path),
    };
  }
  if (tool.name === "StructuredOutput") {
    return {
      title: "StructuredOutput",
      detail: summarizeText(JSON.stringify(tool.input || {}), 120),
    };
  }
  return {
    title: tool.name || "tool",
    detail: summarizeText(JSON.stringify(tool.input || {}), 120),
  };
}

function summarizeToolResult(parsed) {
  const result = firstToolResult(parsed);
  if (!result) return null;
  const path =
    parsed?.tool_use_result?.file?.filePath ||
    parsed?.tool_use_result?.stdout ||
    result.content;
  return {
    title: "tool result",
    detail: summarizeText(path || "returned data", 120),
  };
}

export function eventTimestamp(item) {
  const parsed = item?.parsed || item;
  return (
    parsed?.timestamp ||
    parsed?.message?.created_at ||
    parsed?.message?.timestamp ||
    null
  );
}

export function summarizeEventLine(item) {
  const parsed = item?.parsed || item;
  if (!parsed) {
    return {
      lane: "raw",
      tone: "muted",
      title: "raw line",
      detail: summarizeText(item?.raw || "", 180),
      timestamp: null,
      key: "raw",
    };
  }

  const timestamp = eventTimestamp(parsed);

  if (parsed.type === "assistant") {
    const tool = firstToolUse(parsed);
    if (tool) {
      const summary = summarizeToolUse(tool);
      return {
        lane: "assistant",
        tone: "info",
        title: summary.title,
        detail: summary.detail,
        timestamp,
        key: tool.name || "tool",
      };
    }
    const text = extractAssistantText(parsed);
    return {
      lane: "assistant",
      tone: "normal",
      title: "assistant",
      detail: summarizeText(text || "thinking", 180),
      timestamp,
      key: "assistant",
    };
  }

  if (parsed.type === "user") {
    const summary = summarizeToolResult(parsed);
    if (summary) {
      return {
        lane: "result",
        tone: "muted",
        title: summary.title,
        detail: summary.detail,
        timestamp,
        key: "tool_result",
      };
    }
    return {
      lane: "user",
      tone: "muted",
      title: "user",
      detail: summarizeText(item?.raw || "", 180),
      timestamp,
      key: "user",
    };
  }

  if (parsed.type === "system") {
    const subtype = parsed.subtype || "system";
    let detail = "";
    if (subtype === "api_retry") {
      detail = `attempt ${parsed.attempt || "?"}/${parsed.max_retries || "?"}`;
    } else if (parsed.error) {
      detail = parsed.error;
    }
    return {
      lane: "system",
      tone: subtype === "api_retry" ? "warning" : "muted",
      title: subtype,
      detail,
      timestamp,
      key: subtype,
    };
  }

  if (parsed.type === "result") {
    return {
      lane: "result",
      tone: parsed.is_error ? "error" : "success",
      title: parsed.subtype || "result",
      detail: summarizeText(parsed.result || "", 180),
      timestamp,
      key: parsed.subtype || "result",
    };
  }

  return {
    lane: parsed.type || "event",
    tone: "muted",
    title: parsed.type || "event",
    detail: summarizeText(item?.raw || JSON.stringify(parsed), 180),
    timestamp,
    key: parsed.type || "event",
  };
}

export function latestEventSummary(items = []) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const summary = summarizeEventLine(items[index]);
    if (summary?.title || summary?.detail) return summary;
  }
  return null;
}
