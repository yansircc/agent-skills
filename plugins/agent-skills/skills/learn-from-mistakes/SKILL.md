---
name: learn-from-mistakes
description: >
  Record mistakes from bug fixes so agents never repeat them. Auto-validates on write.
  Triggers: learn from mistake, record mistake, remember this bug, don't repeat.
---

# Learn from Mistakes

## Setup

First time? Run `scripts/setup.sh`.

It does three things:
1. Creates `.claude/skills/learn-from-mistakes/{scripts,references}/` in the project
2. Generates `guardrails.sh` (PreToolUse hook) into the project's `scripts/`
3. Registers hooks in `.claude/settings.json`

Guardrails take effect immediately after setup.

## Recording a Mistake

Before recording, answer these meta-questions:

**1. One-off typo or recurring trap?**
Typos aren't worth recording. Structural traps are — framework limitations, unintuitive API semantics, environment differences.

**2. What keyword will appear in code next time this trap is hit?**
That keyword is your `match`. If you can't name it, you haven't understood the trap yet.

**3. What does a future agent need to know to avoid this?**
Write for an agent that has never seen this bug. Include: symptom, root cause, correct approach.

**4. Warn or hard block?**
Default to `inject` (warning). Use `block` only for irreversible operations.

### Mistake File Format

Write to `.claude/skills/learn-from-mistakes/references/<name>.md`:

```markdown
---
match: db\.insert.*\.values
action: inject
---
# D1 batch insert must limit batch size

D1/SQLite variable limit is ~999. Use BATCH_SIZE <= 10 for batch inserts.
```

Fields:
- `match` — regex, matched against edit content / command text (NOT file paths)
- `action` — `inject` (warn) or `block` (hard block)
- `message` — required when action=block, the rejection message shown to agent

### Match Guidelines

**Match WHAT (code content), not WHERE (file path):**

```
BAD:  match: src/**/*.ts          → triggers on ANY .ts file edit
GOOD: match: db\.insert.*\.values → triggers only when batch insert code appears
```

Path matching only when location IS the semantics:

```
OK:   match: drizzle/.*\.sql      → touching migration files deserves a reminder
```

## Lifecycle

- Expired mistake → delete the file
- Match too broad → narrow the regex
- Match too narrow → widen the regex
- Unsure about severity → start with `inject`, upgrade to `block` after observing
