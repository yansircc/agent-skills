---
name: rtk
description: Use when you need to run, inspect, or participate in roundtable-kernel sessions through the bundled `rtk` runtime. Covers autonomous runs, live chair/critic handoff, durable session truth, and common commands such as `help`, `show`, `wait`, `next`, and `apply`.
version: 1.0.0
---

# RTK

Use this skill when the task is about operating Roundtable Kernel rather than editing its internals.

Prefer the bundled launcher at `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk`. In the source repo the fallback resolves to `.codex/skills/rtk`; in a marketplace install `CLAUDE_PLUGIN_ROOT` resolves to the plugin root.

Start with `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk -h` or `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk help <command>` if the exact subcommand is unclear.

## Mental Model

- `sessions/<id>.json` is source of truth.
- `telemetry/<id>.jsonl` is observability only.
- `run` is autonomous mode.
- `init` / `next` / `apply` / `wait` is live mode.
- `next` is the only command that claims a step.
- `apply` should echo the `started_at` token returned by `next`.

Do not infer semantic state from stream logs when `show`, `wait`, or the session file can answer the question directly.

## Common Workflows

Autonomous:

```bash
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk run my-session /absolute/path/to/spec.json --force
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk show my-session
```

Live chair / critic:

```bash
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk init my-session /absolute/path/to/spec.json --force
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk next my-session --actor chair
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk apply my-session result.json
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait my-session --until turn --actor critic
```

Useful waits:

```bash
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait my-session --until turn --actor critic
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait my-session --until turn --actor chair
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait my-session --until terminal
${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait my-session --until change --since 2026-03-17T04:07:07.708Z
```

## Operating Rules

- Use `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk show <session>` when you need the durable session state.
- Use `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk wait` instead of ad hoc polling loops.
- Use `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk list` to discover existing sessions.
- Use `${CLAUDE_PLUGIN_ROOT:-.codex}/skills/rtk/scripts/rtk serve --port 3133` when a human needs the web UI.
- The bundled launcher auto-points `serve` at the skill-local `ui/dist`.
- To export the same self-contained skill into a plugin-style directory, run `./scripts/package-rtk-skill.sh /path/to/plugin/skills/rtk` from the repo root.

## When Not To Use

- Do not use this skill just to modify roundtable-kernel source code.
- Do not read telemetry as if it were authoritative state.
