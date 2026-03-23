export async function fetchJson(path) {
  const response = await fetch(path);
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    const preview = raw.replace(/\s+/g, " ").trim().slice(0, 120) || "<empty>";
    const contentType = response.headers.get("content-type") || "unknown";
    throw new Error(`Expected JSON from ${path}, got ${contentType}: ${preview}`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error_message || `Request failed: ${response.status}`);
  }
  return payload;
}

export function overviewUrl(limit = 30) {
  return `/api/overview?limit=${limit}`;
}

export function jobUrl(jobPath) {
  return `/api/job?job_path=${encodeURIComponent(jobPath)}`;
}

export function jobOutputUrl(jobPath, limit = 200, cursors = {}) {
  let url = `/api/job-output?job_path=${encodeURIComponent(jobPath)}&limit=${limit}`;
  if (cursors.events != null) url += `&events_cursor=${cursors.events}`;
  if (cursors.stdout != null) url += `&stdout_cursor=${cursors.stdout}`;
  if (cursors.stderr != null) url += `&stderr_cursor=${cursors.stderr}`;
  return url;
}
