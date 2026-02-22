import { store } from './state.svelte.js';
import { parseStreamLine } from './utils.js';

export async function fetchStatus() {
  try {
    const data = await (await fetch('/api/status')).json();
    store.projectRoot = data.project_root;
    store.tasks = data.tasks || [];
    store.workflows = data.workflows || {};
  } catch {}
}

export async function fetchEvents() {
  try {
    const since = store.lastEventTsMs ? `?since=${store.lastEventTsMs + 1}` : '';
    const data = await (await fetch(`/api/events${since}`)).json();
    if (data.events && data.events.length) {
      if (!store.lastEventTsMs) {
        store.events = data.events;
      } else {
        store.events = [...data.events, ...store.events];
      }
      store.lastEventTsMs = Math.max(...data.events.map((e) => e.ts_ms));
    }
  } catch {}
}

export async function fetchStreams(taskList) {
  for (const t of taskList) {
    if (t.status !== 'running') {
      const ss = store.streamState[t.name];
      if (ss && ss.active) {
        ss.active = false;
        try {
          const data = await (await fetch(`/api/stream/${t.name}?offset=${ss.offset}`)).json();
          if (data.content) appendStreamContent(t.name, data.content, data.offset);
        } catch {}
      }
      continue;
    }
    let ss = store.streamState[t.name];
    if (!ss) {
      ss = { offset: 0, lines: [], active: false, visible: false };
    }
    try {
      const data = await (await fetch(`/api/stream/${t.name}?offset=${ss.offset}`)).json();
      if (data.active || data.content) {
        if (data.offset < ss.offset) {
          ss.offset = 0;
          ss.lines = [];
          const refetch = await (await fetch(`/api/stream/${t.name}?offset=0`)).json();
          Object.assign(data, refetch);
        }
        ss.active = data.active;
        if (!store.streamState[t.name]) {
          store.streamState[t.name] = ss;
        }
        if (data.content) appendStreamContent(t.name, data.content, data.offset);
      }
    } catch {}
  }
}

function appendStreamContent(taskName, content, newOffset) {
  const ss = store.streamState[taskName];
  if (!ss) return;
  ss.offset = newOffset;
  const rawLines = content.split('\n');
  for (const raw of rawLines) {
    const parsed = parseStreamLine(raw);
    if (parsed) ss.lines.push(parsed);
  }
  if (ss.lines.length > 200) ss.lines = ss.lines.slice(-200);
}

export function toggleStream(taskName) {
  const ss = store.streamState[taskName];
  if (ss) {
    ss.visible = !ss.visible;
  }
}
