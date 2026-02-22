export function elapsed(iso, now) {
  if (!iso) return '';
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
}

export function duration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const s = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
}

export function hms(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function topoSort(tasks) {
  const byName = {};
  tasks.forEach((t) => {
    byName[t.name] = t;
  });
  const depthCache = {};
  function depth(name) {
    if (depthCache[name] !== undefined) return depthCache[name];
    const t = byName[name];
    if (!t || !t.depends || !t.depends.length) return (depthCache[name] = 0);
    return (depthCache[name] = 1 + Math.max(...t.depends.map((d) => depth(d))));
  }
  tasks.forEach((t) => depth(t.name));
  const statusPri = { failed: 0, waiting: 1, running: 2, stopped: 3, pending: 4, completed: 5 };
  return [...tasks].sort((a, b) => {
    const da = depthCache[a.name] || 0,
      db = depthCache[b.name] || 0;
    if (da !== db) return da - db;
    const sa = statusPri[a.status] ?? 9,
      sb = statusPri[b.status] ?? 9;
    return sa - sb;
  });
}

export function parseStreamLine(raw) {
  try {
    const obj = JSON.parse(raw);

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
      return null;
    }

    if (obj.type === 'assistant' && obj.message) {
      const content = obj.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'thinking' && block.thinking) {
            return {
              cls: 'sl-think',
              text: '\uD83D\uDCAD thinking...',
              collapsible: true,
              detail: block.thinking.slice(0, 500),
            };
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

    if (obj.type === 'user' && obj.message) {
      const content = obj.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text = typeof block.content === 'string' ? block.content : '';
            if (block.is_error) {
              return {
                cls: 'sl-output sl-result-err',
                text: `  \u21B3 error: ${text.split('\n')[0].slice(0, 120)}`,
                collapsible: true,
                detail: text,
              };
            }
            const tur = obj.tool_use_result;
            const fullContent = (tur && typeof tur === 'object' && tur.stdout) || text;
            if (fullContent) {
              const lines = fullContent.split('\n').filter((l) => l.trim());
              return {
                cls: 'sl-output',
                text: `  \u21B3 ${lines[0]?.slice(0, 80) || '(empty)'}${lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''}`,
                collapsible: true,
                detail: fullContent,
              };
            }
            return { cls: 'sl-output', text: '  \u21B3 (ok)' };
          }
        }
      }
      return null;
    }

    if (obj.type === 'result') {
      if (obj.subtype && obj.subtype !== 'success') {
        const reason = obj.subtype.replace(/^error_?/, '').replace(/_/g, ' ') || 'error';
        const msg = obj.result || obj.error || reason;
        return {
          cls: 'sl-result-err',
          text: `\u2717 ${reason}: ${typeof msg === 'string' ? msg.slice(0, 120) : reason}`,
        };
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

export function eventLabel(e) {
  const s = e.step_name || '';
  switch (e.type) {
    case 'step_started':
      return [s + ' started', 'start'];
    case 'step_finished':
      return e.detail === 'ok' ? [s + ' done', 'ok'] : [s + ' failed', 'fail'];
    case 'step_yielded':
      return [s + ' waiting', 'wait'];
    case 'step_resumed':
      return [s + ' resumed', 'ok'];
    case 'step_skipped':
      return [s + ' skipped', ''];
    case 'step_reset':
      return e.detail === 'auto' ? [s + ' retry', 'retry'] : [s + ' reset', ''];
    case 'task_started':
      return ['started', 'start'];
    case 'task_stopped':
      return ['stopped', ''];
    case 'task_reset':
      return ['reset', ''];
    case 'viewport_lost':
      return [s + ' viewport lost', 'fail'];
    default:
      return [e.type, ''];
  }
}
