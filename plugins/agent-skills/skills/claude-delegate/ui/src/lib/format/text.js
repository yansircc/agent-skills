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

export function formatCount(value, noun) {
  const count = Number(value) || 0;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
