<script>
  import { formatProviderModel, formatRelativeTime, shortId, summarizeText } from "./format.js";

  export let jobs = [];
  export let selectedJobPath = null;
  export let onSelectJob;

  function pick(jobPath) {
    onSelectJob?.(jobPath);
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h3>session jobs</h3>
    <span class="panel-count">{jobs.length}</span>
  </div>

  {#if jobs.length === 0}
    <div class="empty">no session jobs</div>
  {:else}
    <div class="history-list">
      {#each jobs as job}
        <button class:selected={selectedJobPath === job.job_path} class="item" onclick={() => pick(job.job_path)}>
          <div class="item-kicker">
            <strong class="item-title">{job.assistant_role || "unknown"} {shortId(job.job_id)}</strong>
            <span class={`badge ${job.state}`}>{job.state}</span>
          </div>
          <div class="item-summary">{summarizeText(job.summary || job.job_id, 180)}</div>
          <div class="item-meta">
            <span>{formatProviderModel(job.provider, job.model)}</span>
            <span>{job.task_type || "general"}</span>
            <span>{formatRelativeTime(job.last_event_at || job.finished_at || job.created_at)} ago</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</section>
