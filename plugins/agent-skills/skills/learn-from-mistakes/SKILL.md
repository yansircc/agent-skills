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

**2. What is the general class of this bug?**
Think beyond the specific instance. Name the *structural pattern*, not the variable name.
- BAD: "the `_db` variable was cached globally" (instance-specific)
- GOOD: "module-level connection singleton in serverless runtime" (class-level)

This shapes your `match` — it should catch the class, not just today's instance.

**3. What regex will catch this class of bug?**
Write a `match` that fires when code *structurally resembles* the trap, then validate:
- **Variants**: Would it catch `export const x = db.select()`? (not just `const`)
- **Renamed**: Would it catch `let conn = null`? (not just `_db`)
- **Safe patterns**: Does it false-positive on `import type { db }`? (type imports are safe)
- **Engine compatible**: Check your project's `guardrails.sh` to see what regex engine it uses, and ensure your pattern is compatible.

When in doubt, wider is better — an occasional false-positive warning is cheap; a missed trap is expensive.

**4. What does a future agent need to know to avoid this?**
Write for an agent that has never seen this bug. Include: symptom, root cause, correct approach.

**5. Warn or hard block?**
Default to `inject` (warning). Use `block` only for irreversible operations.

### Mistake File Format

Write to `.claude/skills/learn-from-mistakes/references/<name>.md`:

```markdown
---
match: db\.insert.*\.values
action: inject
---
# D1 batch insert must limit batch size

## Symptom
Batch insert silently fails or throws "too many SQL variables" at runtime.

## Root Cause
D1/SQLite variable limit is ~999. A batch of 100 rows × 10 columns = 1000 variables → exceeds limit.

## Correct Approach
Use BATCH_SIZE <= 10 for batch inserts. Loop in chunks.
```

#### Frontmatter fields
- `match` — regex, matched against edit content / command text (NOT file paths). Engine depends on project's `guardrails.sh`
- `action` — `inject` (warn) or `block` (hard block)
- `message` — required when action=block, the rejection message shown to agent

#### Body sections (recommended)
- **Symptom** — what the agent will see (error message, behavior)
- **Root Cause** — why it happens (1-2 sentences)
- **Correct Approach** — what to do instead (code example if helpful)

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

**Prefer class-level matches over instance-level:**

```
NARROW: let _db.*=.*null                          → only catches this exact variable name
WIDER:  let (_db|dbInstance|dbCache|globalDb).*=   → catches the pattern regardless of naming
```

**Regex engine constraints**: Each project's `guardrails.sh` determines what regex features are available. Check the script header for engine-specific notes before writing patterns.

## Lifecycle

- Expired mistake → delete the file
- Match too broad → narrow the regex
- Match too narrow → widen the regex
- Unsure about severity → start with `inject`, upgrade to `block` after observing
