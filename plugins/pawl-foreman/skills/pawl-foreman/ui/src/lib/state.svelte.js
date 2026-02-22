import { topoSort } from './utils.js';

// Core state — single reactive object for easy mutation from anywhere
export const store = $state({
  projectRoot: '',
  tasks: [],
  workflows: {},
  events: [],
  selectedWorkflow: null,
  eventFilter: null,
  streamState: {},
  now: Date.now(),
  lastEventTsMs: 0,
});

// Derived state as getter functions (Svelte 5 cannot export $derived from modules)
export function getSortedWorkflowNames() {
  return Object.keys(store.workflows).sort();
}

export function getFilteredTasks() {
  let t = store.tasks;
  if (store.selectedWorkflow) t = t.filter((t) => t.workflow_name === store.selectedWorkflow);
  return topoSort(t);
}

export function getFilteredEvents() {
  if (!store.eventFilter) return store.events;
  return store.events.filter(
    (e) => e.task === store.eventFilter.task && e.step_name === store.eventFilter.step
  );
}

export function getConfiguredHooks() {
  const hooks = {};
  for (const w of Object.values(store.workflows)) {
    Object.assign(hooks, w.hooks || {});
  }
  return hooks;
}
