<script>
  import {
    compareSessionPriority,
    formatCount,
    formatProviderModel,
    formatRelativeTime,
    sessionBucket,
    shortId,
    summarizeText,
  } from "./format.js";

  export let sessions = [];
  export let selectedJobPath = null;
  export let onSelectJob;

  function pick(jobPath) {
    onSelectJob?.(jobPath);
  }

  function sessionTitle(session) {
    return `${session.assistant_role || "unknown"} ${shortId(session.session_id)}`;
  }

  function summaryHealth(session) {
    const health = session?.session_health?.status;
    if (!health || health === "healthy" || health === "unknown") return null;
    return health;
  }

  function sorted(list) {
    return [...list].sort(compareSessionPriority);
  }

  $: runningSessions = sorted(sessions.filter((session) => sessionBucket(session) === "running"));
  $: attentionSessions = sorted(sessions.filter((session) => sessionBucket(session) === "attention"));
  $: recentSessions = sorted(sessions.filter((session) => sessionBucket(session) === "recent")).slice(0, 24);

  $: panels = [
    { title: "running", count: runningSessions.length, items: runningSessions, emptyMsg: "no running sessions" },
    { title: "attention", count: attentionSessions.length, items: attentionSessions, emptyMsg: "no attention needed" },
    { title: "recent", count: sessions.length, items: recentSessions, emptyMsg: "no recent sessions" },
  ];
</script>

<aside class="sidebar">
  {#each panels as panel}
    <section class="panel">
      <div class="panel-header">
        <h2>{panel.title}</h2>
        <span>{panel.count}</span>
      </div>
      <div class="list">
        {#each panel.items as session}
          <button class:selected={selectedJobPath === session.last_job_path} class="item" onclick={() => pick(session.last_job_path)}>
            <div class="item-kicker">
              <strong class="item-title">{sessionTitle(session)}</strong>
              <span class={`badge ${session.last_state}`}>{session.last_state}</span>
            </div>
            <div class="item-summary">{summarizeText(session.summary || session.session_id, 136)}</div>
            <div class="item-meta">
              <span>{formatProviderModel(session.provider, session.model)}</span>
              {#if summaryHealth(session)}
                <span>{summaryHealth(session)}</span>
              {/if}
              <span>{formatCount(session.job_count, "job")}</span>
              <span>{formatRelativeTime(session.last_event_at || session.finished_at || session.last_created_at)} ago</span>
            </div>
          </button>
        {:else}
          <div class="empty">{panel.emptyMsg}</div>
        {/each}
      </div>
    </section>
  {/each}
</aside>
