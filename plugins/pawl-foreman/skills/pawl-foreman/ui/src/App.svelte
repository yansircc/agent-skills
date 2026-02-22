<script>
  import { onMount } from 'svelte';
  import { store, getFilteredTasks, getFilteredEvents, getSortedWorkflowNames, getConfiguredHooks } from './lib/state.svelte.js';
  import { hms, eventLabel } from './lib/utils.js';

  const filteredTasks = $derived(getFilteredTasks());
  const filteredEvents = $derived(getFilteredEvents());
  const sortedWorkflowNames = $derived(getSortedWorkflowNames());
  const configuredHooks = $derived(getConfiguredHooks());

  import { fetchStatus, fetchEvents, fetchStreams } from './lib/api.js';
  import TaskCard from './components/TaskCard.svelte';

  const statusOrder = [
    ['completed', 'var(--success)', 'white'],
    ['running', 'var(--primary)', 'var(--ink)'],
    ['waiting', 'var(--secondary)', 'var(--ink)'],
    ['failed', 'var(--red)', 'white'],
    ['pending', '#eee', '#999'],
    ['stopped', '#ddd', '#888'],
  ];

  const statusCounts = $derived.by(() => {
    const c = {};
    store.tasks.forEach((t) => {
      c[t.status] = (c[t.status] || 0) + 1;
    });
    return c;
  });

  function clearEventFilter() {
    store.eventFilter = null;
  }

  onMount(() => {
    fetchStatus();
    fetchEvents();

    const statusInterval = setInterval(() => {
      fetchStatus();
      fetchEvents();
    }, 2000);

    const streamInterval = setInterval(() => {
      if (store.tasks.length) fetchStreams(store.tasks);
    }, 1000);

    const nowInterval = setInterval(() => {
      store.now = Date.now();
    }, 1000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(streamInterval);
      clearInterval(nowInterval);
    };
  });
</script>

<header>
  <div>
    <h1 style="font-size: 32px;">PAWL</h1>
    <div class="project-path">{store.projectRoot || 'loading...'}</div>
  </div>
  <div class="header-right">
    <div class="summary-tags">
      {#each statusOrder.filter(([s]) => statusCounts[s]) as [status, bg, fg]}
        <span class="tag" style="background:{bg};color:{fg}">{statusCounts[status]} {status.toUpperCase()}</span>
      {/each}
    </div>
    <div class="refresh-label">AUTO-REFRESH 2S</div>
  </div>
</header>

{#if sortedWorkflowNames.length <= 1}
  <div class="workflow-bar">
    {#each sortedWorkflowNames as name}
      {store.workflows[name].steps.join(' \u2192 ')}
    {/each}
  </div>
{:else}
  <div class="workflow-bar workflow-tabs">
    <button
      class="wf-tab"
      class:active={store.selectedWorkflow === null}
      onclick={() => (store.selectedWorkflow = null)}
    >
      All <span class="wf-count">{store.tasks.length}</span>
    </button>
    {#each sortedWorkflowNames as name}
      {@const wfTasks = store.tasks.filter((t) => t.workflow_name === name)}
      {@const done = wfTasks.filter((t) => t.status === 'completed').length}
      {@const total = wfTasks.length}
      {@const check = done === total && total > 0 ? ' \u2713' : ''}
      <button
        class="wf-tab"
        class:active={store.selectedWorkflow === name}
        onclick={() => (store.selectedWorkflow = name)}
      >
        {name} <span class="wf-count">{done}/{total}{check}</span>
      </button>
    {/each}
  </div>
{/if}

<div class="container">
  <main class="task-list">
    {#if filteredTasks.length === 0}
      <div class="empty-state">no tasks</div>
    {:else}
      {#each filteredTasks as task (task.name)}
        <TaskCard {task} />
      {/each}
    {/if}
  </main>
  <aside>
    <div class="sidebar-box">
      <h2>
        {#if store.eventFilter}
          <span>{store.eventFilter.task} / {store.eventFilter.step}</span>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="filter-clear" onclick={clearEventFilter}>&times; clear</span>
        {:else}
          EVENT LOG
        {/if}
      </h2>
      {#if filteredEvents.length === 0}
        <div class="empty-state">
          {store.eventFilter ? 'no events for this step' : 'no events yet'}
        </div>
      {:else}
        {#each filteredEvents.slice(0, 80) as event}
          {@const [label, cls] = eventLabel(event)}
          <div class="ev">
            <span class="ev-time">{hms(event.ts)}</span>
            <span class="ev-task">{event.task}</span>
            <span class="ev-label {cls}">{label}</span>
            {#if configuredHooks[event.type]}
              <span class="ev-hook" title="hook: {configuredHooks[event.type]}">&zwnj;&#9889;</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </aside>
</div>

<style>
  :root {
    --primary: #6fc2ff;
    --secondary: #ffde00;
    --red: #ff7169;
    --ink: #383838;
    --base: #f4efea;
    --success: #068475;
    --error: #e23f35;
    --white: #ffffff;
  }

  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: 'Inter', system-ui, sans-serif;
    background: var(--base);
    color: var(--ink);
    padding: 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100vh;
  }

  :global(h1),
  :global(h2) {
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: -0.02em;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 16px;
    border-bottom: 2px solid var(--ink);
  }
  .project-path {
    font-family: 'JetBrains Mono', monospace;
    background: rgba(0, 0, 0, 0.05);
    padding: 3px 8px;
    font-size: 12px;
    margin-top: 4px;
  }
  .header-right {
    text-align: right;
  }
  .summary-tags {
    display: flex;
    gap: 5px;
    justify-content: flex-end;
    margin-bottom: 4px;
  }
  .tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border: 2px solid var(--ink);
    text-transform: uppercase;
  }
  .refresh-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #999;
  }

  /* Workflow Bar */
  .workflow-bar {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #999;
    margin-top: 16px;
    margin-bottom: 4px;
  }
  .workflow-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
  }
  .wf-tab {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 800;
    padding: 6px 14px;
    cursor: pointer;
    background: #fff;
    border: 2px solid var(--ink);
    color: var(--ink);
    text-transform: uppercase;
    transition: all 0.1s ease;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wf-tab:hover {
    background: #f8f8f8;
    transform: translateY(-1px);
    box-shadow: 0 2px 0 var(--ink);
  }
  .wf-tab.active {
    background: var(--ink);
    color: #fff;
    transform: none;
    box-shadow: none;
  }
  .wf-tab .wf-count {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.8;
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .wf-tab.active .wf-count {
    background: rgba(255, 255, 255, 0.2);
  }

  .container {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 24px;
    flex: 1;
    min-height: 0;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
    min-height: 0;
  }

  /* Event Log */
  .sidebar-box {
    background: var(--white);
    border: 2px solid var(--ink);
    padding: 8px 10px;
    overflow-y: auto;
    min-height: 0;
    max-height: 100%;
  }
  .sidebar-box h2 {
    font-size: 14px;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .filter-clear {
    font-size: 10px;
    font-weight: 400;
    cursor: pointer;
    color: #999;
    text-transform: none;
    letter-spacing: 0;
  }
  .filter-clear:hover {
    color: var(--ink);
  }
  .ev {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    padding: 3px 0;
    border-bottom: 1px solid #f0f0f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ev:last-child {
    border-bottom: none;
  }
  .ev-time {
    color: #bbb;
  }
  .ev-task {
    font-weight: 700;
    margin: 0 4px;
  }
  .ev-label {
    color: #888;
  }
  .ev-label.ok { color: var(--success); }
  .ev-label.fail { color: var(--error); }
  .ev-label.retry { color: #e65100; }
  .ev-label.wait { color: #b60; }
  .ev-label.start { color: var(--primary); }
  .ev-hook {
    color: #e65100;
    margin-left: 2px;
    font-size: 9px;
  }

  .empty-state {
    color: #bbb;
    font-style: italic;
    padding: 16px;
    text-align: center;
    font-size: 13px;
  }
</style>
