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

export function secondsSince(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}
