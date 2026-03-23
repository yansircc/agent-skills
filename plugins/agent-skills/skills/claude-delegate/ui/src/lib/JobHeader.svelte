<script>
  import {
    compactPath,
    deriveJobDiagnosis,
    formatCount,
    formatProviderModel,
    formatRelativeTime,
    formatTimestamp,
    shortId,
    streamActivity,
    summarizeText,
  } from "./format.js";

  export let view = null;
  export let session = null;
  export let sessionJobs = [];
  export let events = [];

  $: job = view?.job;
  $: request = view?.request;
  $: delegate = view?.delegate;
  $: completion = delegate?.completion || delegate?.structured_output || {};
  $: routing = request?.routing || job?.routing;
  $: activity = streamActivity(job);
  $: summary = completion?.summary || delegate?.result || "no summary";
  $: diagnosis = deriveJobDiagnosis(view, events);
  $: health = session?.session_health?.status || "unknown";
  $: artifacts = delegate?.artifacts || {};
  $: displayProvider = request?.provider || delegate?.provider || null;
  $: displayModel = request?.model || delegate?.model || null;
  $: displayTools =
    request?.tools === undefined || request?.tools === null ? "provider default" : request.tools || "none";
  $: showHealthBadge = health !== "healthy" && health !== "unknown" && health !== job?.state;
  $: showActivityBadge = job?.state === "running" && activity !== "idle" && activity !== job?.state;
  $: changedFileCount = delegate?.changed_files?.length || 0;
  $: riskCount = delegate?.open_risks?.length || 0;
  $: testCount = delegate?.test_commands?.length || 0;
  $: toolCount = delegate?.tool_use_count ?? 0;

  $: nowStats = [
    { label: "state", value: job?.state || "none" },
    { label: "health", value: health },
    { label: "last event", value: job?.last_event_at ? `${formatRelativeTime(job?.last_event_at)} ago` : "none" },
    { label: "current role", value: job?.current_role || request?.assistant_role || "none" },
    { label: "events", value: job?.event_count ?? 0 },
    { label: "tool uses", value: toolCount },
    { label: "started", value: formatTimestamp(job?.started_at) },
    { label: "finished", value: formatTimestamp(job?.finished_at) },
  ];

  $: contractStats = [
    { label: "routing", value: routing?.decision || "none" },
    { label: "lineage", value: request?.lineage?.action || "none" },
    { label: "provider", value: displayProvider || "default" },
    { label: "model", value: displayModel || "provider default" },
    { label: "tools", value: displayTools },
    { label: "cwd", value: compactPath(request?.cwd, 60) },
    { label: "session", value: request?.session_id || "none" },
    { label: "job", value: job?.job_id || "none" },
  ];

  $: outcomeStats = [
    { label: "verification", value: delegate?.verification?.status || "pending" },
    { label: "boundary", value: delegate?.boundary?.status || "pending" },
    { label: "changed files", value: changedFileCount },
    { label: "open risks", value: riskCount },
    { label: "tests", value: testCount },
    { label: "error", value: delegate?.error_message || job?.last_error || "none" },
  ];

  $: artifactStats = [
    { label: "request", value: compactPath(artifacts?.request_path, 60) },
    { label: "result", value: compactPath(artifacts?.normalized_path, 60) },
    { label: "patch", value: compactPath(artifacts?.patch_path, 60) },
    { label: "handoff", value: compactPath(artifacts?.handoff_path, 60) },
    { label: "job path", value: compactPath(job?.job_path, 60) },
    { label: "ledger", value: compactPath(artifacts?.ledger_path, 60) },
  ];
</script>

{#if view}
  <section class="context-card">
    <div class="eyebrow">selected session</div>
    <h1>{shortId(session?.session_id || request?.session_id, 12, 6)}</h1>
    <div class="context-meta">
      <span>{request?.assistant_role || "unknown"}</span>
      <span>{formatProviderModel(displayProvider, displayModel)}</span>
      <span>{request?.task_type || "general"}</span>
      <span>{formatCount(session?.job_count || sessionJobs.length || 1, "job")}</span>
    </div>
    <div class="context-meta">
      <span class={`badge ${job?.state}`}>{job?.state}</span>
      {#if showHealthBadge}
        <span class={`badge ${health}`}>{health}</span>
      {/if}
      {#if showActivityBadge}
        <span class={`pulse ${activity}`}>{activity}</span>
      {/if}
    </div>

    <section class="note-surface">
      <p>{summarizeText(diagnosis, 420)}</p>
    </section>

    <section class="summary-grid">
      <section class="panel summary-card">
        <div class="panel-header">
          <h3>now</h3>
        </div>
        <dl class="pair-list compact">
          {#each nowStats as stat}
            <div>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section class="panel summary-card">
        <div class="panel-header">
          <h3>contract</h3>
        </div>
        <dl class="pair-list compact">
          {#each contractStats as stat}
            <div>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section class="panel summary-card">
        <div class="panel-header">
          <h3>outcome</h3>
        </div>
        <section class="note-surface compact">
          <p>{summarizeText(summary, 240)}</p>
        </section>
        <dl class="pair-list compact">
          {#each outcomeStats as stat}
            <div>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section class="panel summary-card">
        <div class="panel-header">
          <h3>artifacts</h3>
        </div>
        <dl class="pair-list compact">
          {#each artifactStats as stat}
            <div>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          {/each}
        </dl>
      </section>
    </section>
  </section>
{/if}
