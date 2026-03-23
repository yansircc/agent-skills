export function formatRelativeTime(value) {
  if (!value) return "none";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const deltaSeconds = Math.round((Date.now() - timestamp) / 1000);
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return `${deltaSeconds}s`;
  if (abs < 3600) return `${Math.round(deltaSeconds / 60)}m`;
  if (abs < 86400) return `${Math.round(deltaSeconds / 3600)}h`;
  return `${Math.round(deltaSeconds / 86400)}d`;
}

export function formatTimestamp(value) {
  if (!value) return "none";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export function summarizeText(value, max = 160) {
  if (!value) return "none";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

export function shortId(value, head = 8, tail = 4) {
  if (!value) return "none";
  const text = String(value);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

export function formatProviderModel(provider, model) {
  if (provider && model) return `${provider}/${model}`;
  if (provider) return `${provider}/default`;
  if (model) return model;
  return "default";
}

export function compactPath(value, max = 56) {
  if (!value) return "none";
  const text = String(value);
  if (text.length <= max) return text;
  const parts = text.split("/").filter(Boolean);
  if (parts.length >= 3) return `.../${parts.slice(-3).join("/")}`;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

export function secondsSince(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

export function formatCount(value, noun) {
  const count = Number(value) || 0;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function sessionBucket(session) {
  if (!session) return "recent";
  if (session.last_state === "running") return "running";
  if (session.last_state === "failed" || session.last_state === "paused" || session.last_state === "cancelled") {
    return "attention";
  }
  return "recent";
}

export function compareSessionPriority(left, right) {
  const rank = {
    running: 0,
    attention: 1,
    recent: 2,
  };
  const leftRank = rank[sessionBucket(left)] ?? 9;
  const rightRank = rank[sessionBucket(right)] ?? 9;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftTime = Date.parse(left?.last_event_at || left?.finished_at || left?.last_created_at || 0);
  const rightTime = Date.parse(right?.last_event_at || right?.finished_at || right?.last_created_at || 0);
  return rightTime - leftTime;
}

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

export function deriveJobDiagnosis(view, items = []) {
  const job = view?.job;
  const delegate = view?.delegate || {};
  const completion = delegate.completion || delegate.structured_output || {};
  const latest = latestEventSummary(items);
  const ageSeconds = secondsSince(job?.last_event_at);
  const ageLabel = job?.last_event_at ? `${formatRelativeTime(job.last_event_at)} ago` : "not yet";

  if (!job) return "No job selected.";

  if (job.state === "running") {
    if (latest?.key === "api_retry") {
      return `Provider retry in flight. Last visible event ${ageLabel}.`;
    }
    if (ageSeconds !== null && ageSeconds > 90 && latest) {
      return `Possibly stalled. Last visible step ${ageLabel}: ${latest.title}${latest.detail ? ` - ${latest.detail}` : ""}.`;
    }
    if (latest) {
      return `Live. Last visible step ${ageLabel}: ${latest.title}${latest.detail ? ` - ${latest.detail}` : ""}.`;
    }
    return "Worker started. Waiting for first visible event.";
  }

  if (job.state === "finished") {
    if (completion.summary) return summarizeText(completion.summary, 220);
    return "Finished without a completion summary.";
  }

  if (job.state === "failed") {
    return delegate.error_message || job.last_error || completion.summary || "Failed without a summarized error.";
  }

  if (job.state === "paused") {
    return "Paused. This session can be resumed from the same assistant identity.";
  }

  if (job.state === "cancelled") {
    return "Cancelled before reaching a terminal delegate result.";
  }

  return `State: ${job.state || "unknown"}.`;
}

export function stateTone(state) {
  switch (state) {
    case "running":
      return "running";
    case "finished":
      return "finished";
    case "failed":
    case "cancelled":
      return "failed";
    case "paused":
      return "paused";
    default:
      return "idle";
  }
}

export function streamActivity(job) {
  if (!job) return "idle";
  if (job.state !== "running") return job.state || "idle";
  return job.last_event_at ? "streaming" : "starting";
}
