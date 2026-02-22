<script>
  import { tick } from 'svelte';
  import { store } from '../lib/state.svelte.js';
  import { elapsed, duration } from '../lib/utils.js';
  import { toggleStream } from '../lib/api.js';

  let { task } = $props();

  function toggleFilter(stepName) {
    const ef = store.eventFilter;
    if (ef && ef.task === task.name && ef.step === stepName) {
      store.eventFilter = null;
    } else {
      store.eventFilter = { task: task.name, step: stepName };
    }
  }

  let panel = $state();
  const ss = $derived(store.streamState[task.name]);
  const hasStream = $derived(ss && ss.lines.length > 0);

  // Auto-scroll when lines change
  $effect(() => {
    if (hasStream && ss.visible && panel) {
      tick().then(() => {
        panel.scrollTop = panel.scrollHeight;
      });
    }
  });

  function toggleDetail(e) {
    e.currentTarget.classList.toggle('expanded');
  }

  const isRetrying = $derived(task.retry_count > 0 && ['running', 'waiting'].includes(task.status));
  const needsAttention = $derived(['failed', 'waiting', 'stopped'].includes(task.status));

  const currentStep = $derived(task.workflow.find((s) => s.status === 'current'));

  const meta = $derived.by(() => {
    const parts = [];
    if (currentStep) parts.push(currentStep.name);
    if (task.started_at && ['running', 'waiting'].includes(task.status)) {
      parts.push(elapsed(task.started_at, store.now));
    }
    if (task.started_at && task.updated_at && ['completed', 'failed', 'stopped'].includes(task.status)) {
      parts.push(duration(task.started_at, task.updated_at));
    }
    return parts;
  });
</script>

<div class="card st-{task.status}">
  <div class="card-main">
    <span class="status-tag {task.status}">{task.status}</span>
    <div class="card-info">
      <span class="task-name">{task.name}</span>
      <span class="task-desc">{task.description || ''}</span>
      {#if task.depends && task.depends.length}
        <span class="task-deps">&larr; {task.depends.join(', ')}</span>
      {/if}
    </div>
    {#if meta.length}
      <div class="card-meta">{meta.join(' \u00B7 ')}</div>
    {/if}
    <div class="progress-grid">
      {#each task.workflow as step}
        {@const cls = step.status === 'current' && isRetrying ? 'retrying' : step.status}
        {@const selected =
          store.eventFilter &&
          store.eventFilter.task === task.name &&
          store.eventFilter.step === step.name}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="p-step {cls}"
          class:selected
          onclick={() => toggleFilter(step.name)}
          title={step.name}
        ></div>
      {/each}
    </div>
    <span class="card-meta">{task.current_step}/{task.total_steps}</span>
    {#if isRetrying}
      <span class="retry-tag">RETRY {task.retry_count}/{task.max_retries}</span>
    {/if}
    {#if hasStream}
      <button
        class="stream-toggle"
        class:active={ss.visible}
        onclick={() => toggleStream(task.name)}
      >
        {ss.visible ? '\u25BC OUTPUT' : '\u25B6 OUTPUT'}
      </button>
    {/if}
  </div>
  {#if needsAttention}
    <div class="card-extra">
      {#if task.last_feedback}
        <div class="error-log">{task.last_feedback}</div>
      {/if}
      {#if (task.blocked_by && task.blocked_by.length) || (task.suggest && task.suggest.length) || task.prompt}
        <div class="card-actions">
          {#if task.blocked_by && task.blocked_by.length}
            <span class="blocked-label">blocked by {task.blocked_by.join(', ')}</span>
          {/if}
          {#each task.suggest || [] as action}
            <span class="next-action">{action}</span>
          {/each}
          {#if task.prompt}
            <span class="next-action">{task.prompt}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  {#if hasStream && ss.visible}
    <div class="stream-panel" bind:this={panel}>
      {#each ss.lines.slice(-100) as line}
        {#if line.collapsible && line.detail}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="sl {line.cls}" class:collapsible={line.collapsible} onclick={toggleDetail}>
            {line.text}
            <div class="sl-detail">{line.detail}</div>
          </div>
        {:else}
          <div class="sl {line.cls}">{line.text}</div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--white);
    border: 2px solid var(--ink);
    padding: 0;
  }
  .card.st-running {
    border-left: 6px solid var(--primary);
  }
  .card.st-waiting {
    border-left: 6px solid var(--secondary);
  }
  .card.st-failed {
    border: 2px solid var(--error);
    border-left: 6px solid var(--error);
  }
  .card.st-pending {
    background: #fafafa;
    opacity: 0.65;
  }
  .card.st-stopped {
    background: #fafafa;
    opacity: 0.55;
  }
  .card-main {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    min-height: 38px;
  }
  .status-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 0;
    width: 72px;
    text-align: center;
    text-transform: uppercase;
    flex-shrink: 0;
    border: 2px solid var(--ink);
  }
  .status-tag.running {
    background: var(--primary);
  }
  .status-tag.failed {
    background: var(--red);
    color: white;
  }
  .status-tag.waiting {
    background: var(--secondary);
  }
  .status-tag.completed {
    background: var(--success);
    color: white;
  }
  .status-tag.pending {
    background: #eee;
    color: #999;
    border-color: #ccc;
  }
  .status-tag.stopped {
    background: #ddd;
    color: #888;
    border-color: #bbb;
  }
  .card-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .task-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 800;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .task-desc {
    font-size: 12px;
    color: #999;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .task-deps {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #bbb;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .card-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #999;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .retry-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    background: #fff3e0;
    border: 2px solid #e65100;
    color: #e65100;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .card-extra {
    padding: 0 14px 8px 94px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .error-log {
    background: #fff5f5;
    border: 1px dashed var(--red);
    padding: 6px 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--error);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 60px;
    overflow-y: auto;
  }
  .card-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .next-action {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--ink);
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 6px;
  }
  .blocked-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--error);
  }
  .stream-toggle {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    color: var(--primary);
    background: none;
    border: 1px solid var(--primary);
    padding: 1px 6px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .stream-toggle:hover {
    background: var(--primary);
    color: white;
  }
  .stream-toggle.active {
    background: var(--primary);
    color: white;
  }

  /* Progress Grid Styles */
  .progress-grid {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .p-step {
    width: 18px;
    height: 8px;
    border: 1px solid #bbb;
    background: #eee;
    cursor: pointer;
  }
  .p-step:hover { opacity: 0.7; }
  .p-step.selected {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .p-step.success { background: var(--success); border-color: var(--success); }
  .p-step.current {
    background: var(--primary);
    border-color: #3a9ae0;
    animation: pulse 1.5s ease-in-out infinite;
  }
  .p-step.retrying {
    background: #ff9800;
    border-color: #e65100;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .p-step.failed { background: var(--red); border-color: var(--error); }
  .p-step.skipped { background: #ccc; border-color: #aaa; }

  /* Stream Panel Styles */
  .stream-panel {
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    padding: 8px 10px;
    max-height: 200px;
    overflow-y: auto;
    border-top: 1px solid #333;
    line-height: 1.5;
  }
  .sl {
    white-space: pre-wrap;
    word-break: break-all;
  }
  .sl.collapsible { cursor: pointer; }
  .sl.collapsible:hover { filter: brightness(1.2); }
  .sl-system { color: #6c7086; font-size: 10px; }
  .sl-think { color: #9399b2; font-style: italic; }
  .sl-detail {
    display: none;
    font-style: normal;
    padding: 2px 0 2px 16px;
    color: #7f849c;
    font-size: 10px;
  }
  .sl.expanded .sl-detail { display: block; }
  :global(.sl-text) { color: #89b4fa; }
  :global(.sl-tool) { color: #f9e2af; }
  :global(.sl-result-ok) { color: #a6e3a1; }
  :global(.sl-result-err) { color: #f38ba8; }
  :global(.sl-output) { color: #7f849c; padding-left: 16px; }
  :global(.sl-raw) { color: #6c7086; }
</style>
