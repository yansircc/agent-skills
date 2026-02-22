let lastEventTsMs = 0;
let allEvents = [];
let eventFilter = null; // { task, step } or null
let configuredHooks = {}; // event_type -> command

function elapsed(iso) {
    if (!iso) return '';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm' + (s % 60) + 's';
    return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
}

function duration(startIso, endIso) {
    if (!startIso || !endIso) return '';
    const s = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm' + (s % 60) + 's';
    return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
}

function hms(iso) {
    return new Date(iso).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderSummary(tasks) {
    const c = {};
    tasks.forEach(t => { c[t.status] = (c[t.status]||0) + 1; });
    const order = [
        ['completed','var(--success)','white'],
        ['running','var(--primary)','var(--ink)'],
        ['waiting','var(--secondary)','var(--ink)'],
        ['failed','var(--red)','white'],
        ['pending','#eee','#999'],
        ['stopped','#ddd','#888'],
    ];
    document.getElementById('summary-tags').innerHTML = order
        .filter(([s]) => c[s])
        .map(([s,bg,fg]) => `<span class="tag" style="background:${bg};color:${fg}">${c[s]} ${s.toUpperCase()}</span>`)
        .join('');
}

function topoSort(tasks) {
    // Compute DAG depth: leaf=0, depth=max(dep depths)+1
    const byName = {};
    tasks.forEach(t => { byName[t.name] = t; });
    const depthCache = {};
    function depth(name) {
        if (depthCache[name] !== undefined) return depthCache[name];
        const t = byName[name];
        if (!t || !t.depends || !t.depends.length) return (depthCache[name] = 0);
        return (depthCache[name] = 1 + Math.max(...t.depends.map(d => depth(d))));
    }
    tasks.forEach(t => depth(t.name));
    // Status priority: attention-needing first within same depth
    const statusPri = { failed:0, waiting:1, running:2, stopped:3, pending:4, completed:5 };
    return [...tasks].sort((a, b) => {
        const da = depthCache[a.name] || 0, db = depthCache[b.name] || 0;
        if (da !== db) return da - db;
        const sa = statusPri[a.status] ?? 9, sb = statusPri[b.status] ?? 9;
        return sa - sb;
    });
}

function buildCardHtml(t) {
    const isRetrying = t.retry_count > 0 && ['running','waiting'].includes(t.status);
    const needsAttention = ['failed','waiting','stopped'].includes(t.status);

    // Progress grid
    const grid = t.workflow.map(s => {
        let cls = s.status;
        if (cls === 'current' && isRetrying) cls = 'retrying';
        const sel = (eventFilter && eventFilter.task === t.name && eventFilter.step === s.name) ? ' selected' : '';
        return `<div class="p-step ${cls}${sel}" data-task="${t.name}" data-step="${s.name}" onclick="toggleStepFilter(this)"></div>`;
    }).join('');

    // Meta parts
    const meta = [];
    const cur = t.workflow.find(s => s.status === 'current');
    if (cur) meta.push(cur.name);
    if (t.started_at && ['running','waiting'].includes(t.status)) meta.push(`<span class="elapsed" data-started="${t.started_at}">${elapsed(t.started_at)}</span>`);
    if (t.started_at && t.updated_at && ['completed','failed','stopped'].includes(t.status)) meta.push(duration(t.started_at, t.updated_at));
    const depsHtml = (t.depends && t.depends.length) ? `<span class="task-deps">\u2190 ${t.depends.join(', ')}</span>` : '';

    // Retry badge
    let retryHtml = '';
    if (isRetrying) {
        retryHtml = `<span class="retry-tag">RETRY ${t.retry_count}/${t.max_retries}</span>`;
    }

    // Extra row: error + actions (only when task needs attention)
    let extraHtml = '';
    if (needsAttention) {
        const parts = [];
        if (t.last_feedback) {
            parts.push(`<div class="error-log">${esc(t.last_feedback)}</div>`);
        }
        const actions = [];
        if (t.blocked_by && t.blocked_by.length) {
            actions.push(`<span class="blocked-label">blocked by ${t.blocked_by.join(', ')}</span>`);
        }
        [...(t.suggest||[])].forEach(a => actions.push(`<span class="next-action">${esc(a)}</span>`));
        if (t.prompt) actions.push(`<span class="next-action">${esc(t.prompt)}</span>`);
        if (actions.length) {
            parts.push(`<div class="card-actions">${actions.join(' ')}</div>`);
        }
        if (parts.length) {
            extraHtml = `<div class="card-extra">${parts.join('')}</div>`;
        }
    }

    // Stream toggle (only when stream data exists)
    const ss = streamState[t.name];
    const hasStream = ss && ss.lines.length > 0;
    const streamBtn = hasStream
        ? `<button class="stream-toggle${ss.visible ? ' active' : ''}" onclick="toggleStream('${t.name}')">${ss.visible ? '\u25BC OUTPUT' : '\u25B6 OUTPUT'}</button>`
        : '';

    // Stream panel (only when visible and has content)
    const streamHtml = (hasStream && ss.visible)
        ? `<div class="stream-panel" id="stream-${t.name}">${ss.lines.slice(-100).map(renderStreamLine).join('')}</div>`
        : '';

    // State key for diff detection (excludes elapsed time which changes every render)
    const streamVis = streamState[t.name]?.visible ? '1' : '0';
    const streamLen = streamState[t.name]?.lines.length || 0;
    const stateKey = `${t.status}|${t.current_step}|${t.retry_count}|${t.last_feedback || ''}|${streamVis}|${streamLen}`;

    return `<div class="card st-${t.status}" id="task-${t.name}" data-state="${esc(stateKey)}">
            <div class="card-main">
                <span class="status-tag ${t.status}">${t.status}</span>
                <div class="card-info">
                    <span class="task-name">${t.name}</span>
                    <span class="task-desc">${t.description || ''}</span>
                    ${depsHtml}
                </div>
                ${meta.length ? `<div class="card-meta">${meta.join(' \u00B7 ')}</div>` : ''}
                <div class="progress-grid">${grid}</div>
                <span class="card-meta">${t.current_step}/${t.total_steps}</span>
                ${retryHtml}
                ${streamBtn}
            </div>
            ${extraHtml}
            ${streamHtml}
        </div>`;
}

function renderTasks(data) {
    document.getElementById('project-path').textContent = data.project_root;
    const wfs = data.workflows || {};
    const wfNames = Object.keys(wfs);
    document.getElementById('workflow-bar').textContent = wfNames.map(n => {
        const w = wfs[n];
        return (wfNames.length > 1 ? n + ': ' : '') + w.steps.join(' \u2192 ');
    }).join('  |  ');
    configuredHooks = {};
    for (const w of Object.values(wfs)) Object.assign(configuredHooks, w.hooks || {});
    renderSummary(data.tasks);

    const el = document.getElementById('tasks');
    if (!data.tasks.length) { el.innerHTML = '<div class="empty-state">no tasks</div>'; return; }

    const sorted = topoSort(data.tasks);
    const newNames = new Set(sorted.map(t => t.name));

    // Remove non-card elements (loading state) and stale cards
    el.querySelectorAll(':scope > :not(.card)').forEach(e => e.remove());
    el.querySelectorAll('.card').forEach(card => {
        if (!newNames.has(card.id.replace('task-', ''))) card.remove();
    });

    // Update or insert each card
    sorted.forEach((t, i) => {
        const html = buildCardHtml(t);
        const existing = document.getElementById('task-' + t.name);
        if (existing) {
            const newKey = `${t.status}|${t.current_step}|${t.retry_count}|${t.last_feedback || ''}`;
            if (existing.dataset.state !== newKey) {
                existing.outerHTML = html;
            }
            // If state unchanged, don't touch DOM — animation continues
        } else {
            // New card: insert at correct position
            const cards = el.querySelectorAll('.card');
            if (i < cards.length) {
                cards[i].insertAdjacentHTML('beforebegin', html);
            } else {
                el.insertAdjacentHTML('beforeend', html);
            }
        }
    });
}

function eventLabel(e) {
    const s = e.step_name || '';
    switch (e.type) {
        case 'step_started':    return [s + ' started', 'start'];
        case 'step_finished':   return e.detail === 'ok' ? [s + ' done', 'ok'] : [s + ' failed', 'fail'];
        case 'step_yielded':    return [s + ' waiting', 'wait'];
        case 'step_resumed':    return [s + ' resumed', 'ok'];
        case 'step_skipped':    return [s + ' skipped', ''];
        case 'step_reset':      return e.detail === 'auto' ? [s + ' retry', 'retry'] : [s + ' reset', ''];
        case 'task_started':    return ['started', 'start'];
        case 'task_stopped':    return ['stopped', ''];
        case 'task_reset':      return ['reset', ''];
        case 'viewport_lost':   return [s + ' viewport lost', 'fail'];
        default: return [e.type, ''];
    }
}

function renderEvents() {
    const el = document.getElementById('events');
    const filtered = eventFilter
        ? allEvents.filter(e => e.task === eventFilter.task && e.step_name === eventFilter.step)
        : allEvents;
    const title = eventFilter
        ? `<span>${esc(eventFilter.task)} / ${esc(eventFilter.step)}</span><span class="filter-clear" onclick="clearFilter()">\u2715 clear</span>`
        : 'EVENT LOG';
    if (!filtered.length) { el.innerHTML = `<h2>${title}</h2><div class="empty-state">${eventFilter ? 'no events for this step' : 'no events yet'}</div>`; return; }
    el.innerHTML = `<h2>${title}</h2>` + filtered.slice(0, 80).map(e => {
        const [label, cls] = eventLabel(e);
        const hook = configuredHooks[e.type] ? `<span class="ev-hook" title="hook: ${esc(configuredHooks[e.type])}">\u26A1</span>` : '';
        return `<div class="ev"><span class="ev-time">${hms(e.ts)}</span><span class="ev-task">${e.task}</span><span class="ev-label ${cls}">${label}</span>${hook}</div>`;
    }).join('');
}

function toggleStepFilter(el) {
    const task = el.dataset.task, step = el.dataset.step;
    if (eventFilter && eventFilter.task === task && eventFilter.step === step) {
        eventFilter = null;
    } else {
        eventFilter = { task, step };
    }
    // Update selected state on all step blocks
    document.querySelectorAll('.p-step.selected').forEach(e => e.classList.remove('selected'));
    if (eventFilter) el.classList.add('selected');
    renderEvents();
}

function clearFilter() {
    eventFilter = null;
    document.querySelectorAll('.p-step.selected').forEach(e => e.classList.remove('selected'));
    renderEvents();
}

// --- Stream state ---
const streamState = {}; // { taskName: { offset, lines, active, visible } }

function toggleStream(taskName) {
    const ss = streamState[taskName];
    if (ss) ss.visible = !ss.visible;
    // Force re-render of this card
    const card = document.getElementById('task-' + taskName);
    if (card) card.dataset.state = '';
    fetchStatus();
}

function parseStreamLine(raw) {
    try {
        const obj = JSON.parse(raw);

        // system messages
        if (obj.type === 'system') {
            if (obj.subtype === 'init') {
                const model = (obj.model || 'unknown').replace(/^claude-/, '').replace(/-\d{8,}$/, '');
                const toolCount = Array.isArray(obj.tools) ? obj.tools.length : 0;
                return { cls: 'sl-system', text: `\u2699 ${model} \u00B7 ${toolCount} tools` };
            }
            if (obj.subtype === 'compact_boundary') {
                const trigger = obj.compact_metadata?.trigger || 'auto';
                return { cls: 'sl-system', text: `\u27F3 context compacted (${trigger})` };
            }
            return null; // skip hook events etc
        }

        // assistant messages
        if (obj.type === 'assistant' && obj.message) {
            const content = obj.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'thinking' && block.thinking) {
                        return { cls: 'sl-think', text: '\uD83D\uDCAD thinking...', collapsible: true, detail: block.thinking.slice(0, 500) };
                    }
                    if (block.type === 'text' && block.text) {
                        return { cls: 'sl-text', text: block.text.slice(0, 200) };
                    }
                    if (block.type === 'tool_use') {
                        const name = block.name || 'unknown';
                        let arg = '';
                        if (block.input) {
                            if (block.input.command) arg = block.input.command.split('\n')[0].slice(0, 60);
                            else if (block.input.file_path) arg = block.input.file_path;
                            else if (block.input.pattern) arg = block.input.pattern;
                            else if (block.input.query) arg = block.input.query.slice(0, 60);
                        }
                        return { cls: 'sl-tool', text: `\uD83D\uDD27 ${name}${arg ? ': ' + arg : ''}` };
                    }
                }
            }
            return null;
        }

        // user messages (tool results)
        if (obj.type === 'user' && obj.message) {
            const content = obj.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'tool_result') {
                        const text = typeof block.content === 'string' ? block.content : '';
                        if (block.is_error) {
                            return { cls: 'sl-output sl-result-err', text: `  \u21B3 error: ${text.slice(0, 120)}` };
                        }
                        // Successful result: show stdout summary from top-level tool_use_result
                        const tur = obj.tool_use_result;
                        if (tur && typeof tur === 'object' && tur.stdout) {
                            const lines = tur.stdout.split('\n').filter(l => l.trim());
                            return { cls: 'sl-output', text: `  \u21B3 ${lines[0]?.slice(0, 80) || '(empty)'}${lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''}` };
                        }
                        if (text) {
                            const lines = text.split('\n').filter(l => l.trim());
                            return { cls: 'sl-output', text: `  \u21B3 ${lines[0]?.slice(0, 80) || '(empty)'}${lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''}` };
                        }
                        return { cls: 'sl-output', text: '  \u21B3 (ok)' };
                    }
                }
            }
            return null;
        }

        // result
        if (obj.type === 'result') {
            if (obj.subtype && obj.subtype !== 'success') {
                const reason = obj.subtype.replace(/^error_?/, '').replace(/_/g, ' ') || 'error';
                const msg = obj.result || obj.error || reason;
                return { cls: 'sl-result-err', text: `\u2717 ${reason}: ${typeof msg === 'string' ? msg.slice(0, 120) : reason}` };
            }
            const parts = ['\u2713 done'];
            if (obj.total_cost_usd != null) parts.push('$' + obj.total_cost_usd.toFixed(4));
            if (obj.duration_ms != null) parts.push((obj.duration_ms / 1000).toFixed(1) + 's');
            if (obj.usage && obj.usage.output_tokens != null) parts.push(obj.usage.output_tokens + ' tokens out');
            return { cls: 'sl-result-ok', text: parts.join(' \u00B7 ') };
        }

        return { cls: 'sl-raw', text: `[${obj.type || 'json'}]` };
    } catch {
        if (!raw.trim()) return null;
        return { cls: 'sl-raw', text: raw.slice(0, 200) };
    }
}

function renderStreamLine(l) {
    if (l.collapsible && l.detail) {
        return `<div class="sl ${l.cls}" onclick="this.classList.toggle('expanded')">${esc(l.text)}<div class="think-detail">${esc(l.detail)}</div></div>`;
    }
    return `<div class="sl ${l.cls}">${esc(l.text)}</div>`;
}

async function fetchStreams(tasks) {
    for (const t of tasks) {
        if (t.status !== 'running') {
            // Task no longer running — final fetch then stop tracking
            const ss = streamState[t.name];
            if (ss && ss.active) {
                ss.active = false;
                try {
                    const data = await (await fetch(`/api/stream/${t.name}?offset=${ss.offset}`)).json();
                    if (data.content) appendStreamContent(t.name, data.content, data.offset);
                } catch {}
            }
            continue;
        }
        // Auto-probe all running tasks
        const ss = streamState[t.name] || { offset: 0, lines: [], active: false, visible: false };
        try {
            const data = await (await fetch(`/api/stream/${t.name}?offset=${ss.offset}`)).json();
            if (data.active || data.content) {
                // File recreated (new step) → reset
                if (data.offset < ss.offset) {
                    ss.offset = 0;
                    ss.lines = [];
                    const refetch = await (await fetch(`/api/stream/${t.name}?offset=0`)).json();
                    Object.assign(data, refetch);
                }
                ss.active = data.active;
                if (!streamState[t.name]) streamState[t.name] = ss;
                if (data.content) appendStreamContent(t.name, data.content, data.offset);
            }
        } catch {}
    }
}

function appendStreamContent(taskName, content, newOffset) {
    const ss = streamState[taskName];
    if (!ss) return;
    ss.offset = newOffset;
    const rawLines = content.split('\n');
    for (const raw of rawLines) {
        const parsed = parseStreamLine(raw);
        if (parsed) ss.lines.push(parsed);
    }
    // Keep last 200 lines in memory
    if (ss.lines.length > 200) ss.lines = ss.lines.slice(-200);
    // Update panel if visible
    if (ss.visible) {
        const panel = document.getElementById('stream-' + taskName);
        if (panel) {
            panel.innerHTML = ss.lines.slice(-100).map(renderStreamLine).join('');
            panel.scrollTop = panel.scrollHeight;
        }
    }
}

let lastTasks = [];

async function fetchStatus() {
    try {
        const data = await (await fetch('/api/status')).json();
        lastTasks = data.tasks || [];
        renderTasks(data);
    } catch(e) {}
}

async function fetchEvents() {
    try {
        const since = lastEventTsMs ? `?since=${lastEventTsMs + 1}` : '';
        const data = await (await fetch(`/api/events${since}`)).json();
        if (data.events && data.events.length) {
            if (!lastEventTsMs) { allEvents = data.events; }
            else { allEvents = [...data.events, ...allEvents]; }
            lastEventTsMs = Math.max(...data.events.map(e => e.ts_ms));
            renderEvents();
        } else if (!lastEventTsMs) { renderEvents(); }
    } catch(e) {}
}

function updateElapsed() {
    document.querySelectorAll('.elapsed[data-started]').forEach(el => {
        el.textContent = elapsed(el.dataset.started);
    });
}

fetchStatus(); fetchEvents();
setInterval(() => { fetchStatus(); fetchEvents(); }, 2000);
setInterval(() => { if (lastTasks.length) fetchStreams(lastTasks); }, 1000);
setInterval(updateElapsed, 1000);
