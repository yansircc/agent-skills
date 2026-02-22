# Handoff

## Session: 2026-02-22 — Svelte 5 Dashboard Rewrite + Demo Expansion

### What was done
Rewrote the pawl-foreman dashboard from vanilla HTML/CSS/JS (~900 lines across 3 files) to Svelte 5 with Vite. User then consolidated from 7 components down to 2 (App.svelte + TaskCard.svelte) by inlining Header, WorkflowTabs, EventLog, ProgressGrid, StreamPanel. Also expanded run-demo.sh from 7 tasks / 2 workflows to 12 tasks / 4 workflows.

**Architecture:**
- `ui/src/lib/state.svelte.js` — single `$state({...})` object (`store`) for global state. Derived values exported as getter functions (not `$derived`) because Svelte 5 forbids `$derived` exports from `.svelte.js` modules. Components call `$derived(getFilteredTasks())` locally.
- `ui/src/lib/api.js` — fetchStatus/fetchEvents/fetchStreams mutate `store` directly
- `ui/src/lib/utils.js` — pure functions migrated from dashboard.js (elapsed, topoSort, parseStreamLine, eventLabel)
- `ui/src/App.svelte` — root component: header, workflow tabs, task list, event log sidebar, all CSS
- `ui/src/components/TaskCard.svelte` — card with inline progress grid, stream panel, all CSS
- `ui/dist/` — committed build output, `base: './'` for relative paths
- `ui/.gitignore` — excludes `node_modules/`

**Old files deleted:** dashboard.html, dashboard.css, dashboard.js

**References updated:**
- `SKILL.md` — `--ui` path changed to `ui/dist/index.html`
- `/tmp/pawl-mock/run-demo.sh` — UI path updated, expanded to 4 workflows

### Decisions made
1. **Svelte 5 runes, not stores**: Used `$state`/`$derived` (runes mode) instead of Svelte stores. Single `store` object avoids the ES module `let` export limitation for primitives.
2. **`$derived` cannot be exported from modules**: Svelte 5 compiler error `derived_invalid_export`. Workaround: export plain getter functions, wrap with `$derived()` at call site in `.svelte` files.
3. **Component consolidation**: User manually merged 7 components into 2 after initial creation. This removed Header, WorkflowTabs, EventLog, ProgressGrid, StreamPanel as separate files. All styles are scoped in the two remaining files.
4. **Tabs style evolution**: Started with negative-margin border collapse, user then redesigned to gap-based layout with `translateY(-1px)` hover effect, `box-shadow` lift, and pill-style `.wf-count` badges.
5. **dist/ committed to git**: Required by constraint — `pawl serve --ui <path>` needs static files, users clone and use without build step.
6. **tool_result collapsible**: User's edit made tool results collapsible (like thinking blocks) — clicking expands full stdout/stderr content.

### Demo expansion (run-demo.sh)
4 workflows, 12 tasks, demonstrating all dashboard features:
- **default** (5 steps: setup→design→develop→test→review, 5 tasks): retry, manual intervention, Claude stream-json, dependency DAG
- **deploy** (5 steps: setup→build→scan→push→smoke-test, 3 tasks): deploy chain, health check retry
- **docs** (4 steps: setup→generate→lint→publish, 2 tasks): Claude agent generating docs
- **infra** (5 steps: setup→provision→configure→validate→notify, 2 tasks): PagerDuty 401 manual intervention

### What's pending
- **run-demo.sh Phase 5 race condition with `< /dev/null`**: When run non-interactively, `read -r` gets EOF immediately, triggering cleanup before Phase 5's `pawl done setup-monitoring` takes effect. Not a problem in interactive use (the intended mode).
- **run-demo.sh outside git tree**: Still lives at `/tmp/pawl-mock/`. Not committed to the repo.

---

## Previous: 2026-02-22 — Dashboard Stream Panel: Claude Agent Integration

Implemented Claude `--output-format stream-json` rendering (commit `28232ec`). Covered 11 event types, collapsible thinking, tool_result with stdout/stderr. Verified real format: `tool_use_result` is `{stdout,stderr}` object on success, string on error. `compact_boundary` handler added but untested.
