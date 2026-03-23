<script>
  import { onMount } from "svelte";
  import { fetchJson, jobOutputUrl, jobUrl, overviewUrl } from "./lib/api.js";
  import { compactPath, compareSessionPriority, formatJson } from "./lib/format.js";
  import Sidebar from "./lib/Sidebar.svelte";
  import JobHeader from "./lib/JobHeader.svelte";
  import SessionHistory from "./lib/SessionHistory.svelte";
  import StreamPanel from "./lib/StreamPanel.svelte";
  import TranscriptPanel from "./lib/TranscriptPanel.svelte";

  let overview = { artifacts_root: "", sessions: [], recent_jobs: [], running_jobs: [] };
  let selectedJobPath = null;
  let jobView = null;
  let jobOutput = { events: [], stdout: [], stderr: [] };
  let cursors = { events: null, stdout: null, stderr: null };
  let loading = true;
  let error = "";
  let autoRefresh = true;
  let intervalHandle;

  const BUFFER_CAP = 500;
  $: sessions = overview.sessions || [];
  $: recentJobs = overview.recent_jobs || [];
  $: sessionCount = sessions.length;
  $: recentCount = overview.recent_jobs?.length ?? 0;
  $: runningCount = overview.running_jobs?.length ?? 0;
  $: attentionCount = sessions.filter((session) => session.last_state !== "running" && ["failed", "paused", "cancelled"].includes(session.last_state)).length;
  $: selectedSession = sessions.find((session) => session.last_job_path === selectedJobPath || session.session_id === jobView?.request?.session_id) || (jobView ? {
    session_id: jobView.request?.session_id,
    assistant_role: jobView.request?.assistant_role,
    provider: jobView.request?.provider || jobView.delegate?.provider,
    model: jobView.request?.model || jobView.delegate?.model,
    last_job_path: jobView.job?.job_path,
    last_state: jobView.job?.state,
    summary: jobView.delegate?.completion?.summary || jobView.delegate?.structured_output?.summary || jobView.delegate?.result,
    job_count: 1,
    last_event_at: jobView.job?.last_event_at,
    last_created_at: jobView.job?.created_at,
    session_health: { status: "unknown" },
  } : null);
  $: selectedSessionJobs = selectedSession ? recentJobs
    .filter((item) => item.session_id === selectedSession.session_id)
    .sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0)) : [];
  $: displaySessionJobs = selectedSessionJobs.length > 0 ? selectedSessionJobs : (jobView ? [{
    assistant_role: jobView.request?.assistant_role,
    created_at: jobView.job?.created_at,
    finished_at: jobView.job?.finished_at,
    job_id: jobView.job?.job_id,
    job_path: jobView.job?.job_path,
    last_event_at: jobView.job?.last_event_at,
    model: jobView.request?.model,
    provider: jobView.request?.provider,
    session_id: jobView.request?.session_id,
    state: jobView.job?.state,
    summary: jobView.delegate?.completion?.summary || jobView.delegate?.structured_output?.summary || jobView.delegate?.result,
    task_type: jobView.request?.task_type,
  }] : []);

  function appendStream(existing, page) {
    if (page.reset) return page.items.slice(-BUFFER_CAP);
    const merged = existing.concat(page.items);
    return merged.length > BUFFER_CAP ? merged.slice(-BUFFER_CAP) : merged;
  }

  function chooseDefaultJob(data) {
    const orderedSessions = [...(data.sessions || [])].sort(compareSessionPriority);
    return orderedSessions[0]?.last_job_path || data.running_jobs[0]?.job_path || data.recent_jobs[0]?.job_path || null;
  }

  async function loadOverview({ preserveSelection = true } = {}) {
    const next = await fetchJson(overviewUrl(80));
    overview = next;
    if (!preserveSelection || !selectedJobPath) {
      selectedJobPath = chooseDefaultJob(next);
    }
  }

  async function loadJob(jobPath) {
    if (!jobPath) return;
    const [view, output] = await Promise.all([
      fetchJson(jobUrl(jobPath)),
      fetchJson(jobOutputUrl(jobPath, 200, cursors)),
    ]);
    jobView = view;
    jobOutput = {
      events: appendStream(jobOutput.events, output.events),
      stdout: appendStream(jobOutput.stdout, output.stdout),
      stderr: appendStream(jobOutput.stderr, output.stderr),
    };
    cursors = {
      events: output.events.next_cursor,
      stdout: output.stdout.next_cursor,
      stderr: output.stderr.next_cursor,
    };
  }

  async function refresh({ preserveSelection = true } = {}) {
    try {
      error = "";
      loading = true;
      await loadOverview({ preserveSelection });
      if (selectedJobPath) {
        await loadJob(selectedJobPath);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function selectJob(jobPath) {
    selectedJobPath = jobPath;
    cursors = { events: null, stdout: null, stderr: null };
    jobOutput = { events: [], stdout: [], stderr: [] };
    refresh();
  }

  onMount(() => {
    refresh({ preserveSelection: false });
    intervalHandle = window.setInterval(() => {
      if (autoRefresh) {
        refresh();
      }
    }, 2000);
    return () => window.clearInterval(intervalHandle);
  });
</script>

<svelte:head>
  <title>Claude Delegate Progress</title>
</svelte:head>

<div class="shell">
  <Sidebar
    {sessions}
    {selectedJobPath}
    onSelectJob={selectJob}
  />

  <main class="main">
    <header class="topbar">
      <div class="topbar-main">
        <div class="eyebrow">claude delegate</div>
        <div class="topbar-title">operator console</div>
        <div class="topbar-context">monitor sessions, intervene, and review artifacts</div>
      </div>
      <div class="controls">
        <label class="toggle">
          <input bind:checked={autoRefresh} type="checkbox" />
          <span>auto refresh</span>
        </label>
        <button class="refresh" onclick={() => refresh()}>refresh</button>
      </div>
    </header>

    <section class="note-surface overview-context">
      <dl class="pair-list compact">
        <div>
          <dt>running</dt>
          <dd>{runningCount}</dd>
        </div>
        <div>
          <dt>attention</dt>
          <dd>{attentionCount}</dd>
        </div>
        <div>
          <dt>sessions</dt>
          <dd>{sessionCount}</dd>
        </div>
        <div>
          <dt>recent jobs</dt>
          <dd>{recentCount}</dd>
        </div>
        <div class="overview-path">
          <dt>artifacts root</dt>
          <dd title={overview.artifacts_root || "loading"}>{compactPath(overview.artifacts_root || "loading", 112)}</dd>
        </div>
      </dl>
    </section>

    {#if error}
      <section class="error">{error}</section>
    {/if}

    {#if loading && !jobView}
      <section class="loading">loading progress view…</section>
    {:else if jobView}
      <JobHeader view={jobView} session={selectedSession} sessionJobs={displaySessionJobs} events={jobOutput.events} />

      <section class="main-grid">
        <div class="main-column">
          <SessionHistory jobs={displaySessionJobs} {selectedJobPath} onSelectJob={selectJob} />

          <section class="panel raw-panel">
            <div class="panel-header">
              <h3>raw data</h3>
            </div>
            {#each [
              { summary: 'delegate result', data: jobView.delegate },
              { summary: 'job metadata', data: jobView.job },
              { summary: 'request view', data: jobView.request }
            ] as detail}
              <details class="raw-details">
                <summary>{detail.summary}</summary>
                <pre>{formatJson(detail.data)}</pre>
              </details>
            {/each}
            <details class="raw-details">
              <summary>stdout stream</summary>
              <div class="stream compact-stream">
                {#if jobOutput.stdout.length === 0}
                  <div class="empty">no stdout lines</div>
                {:else}
                  {#each jobOutput.stdout as item}
                    <article class="stream-line">
                      <pre>{formatJson(item.parsed || item.raw)}</pre>
                    </article>
                  {/each}
                {/if}
              </div>
            </details>
          </section>
        </div>

        <div class="main-column">
          <TranscriptPanel items={jobOutput.events} />
          <StreamPanel title="stderr" items={jobOutput.stderr} empty="no stderr lines" />
        </div>
      </section>
    {:else}
      <section class="loading">no jobs found</section>
    {/if}
  </main>
</div>
