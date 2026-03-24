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
