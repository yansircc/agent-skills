---
name: pickup
description: Quickly pick up a project and understand the current development state
---

Rebuild work context from persistent state: determine "where we are now."

What the project is (CLAUDE.md) is already auto-loaded in the system prompt. What to do next is for the user to decide. Pickup only handles the middle piece: current position.

## Execution

1. Read `.claude/HANDOFF.md` — intent trajectory and incomplete state from the last session
2. Run `git status` + `git log --oneline -5` — current physical state
3. Output summary: where things left off, what's still pending, whether the working tree is clean

Don't: decide the session goal for the user, proactively read CLAUDE.md (already auto-loaded), check specs directory.
