---
name: handoff
description: Execute a session handoff — prepare knowledge transfer for the next session
---

Write knowledge from this session that code doesn't encode into `.claude/HANDOFF.md`.

Code and git history persist automatically. CLAUDE.md captures structural knowledge. MEMORY.md captures lessons learned. Handoff saves only the increment that none of them cover:

1. **Intent trajectory** — what decisions were made, why, what alternatives were rejected
2. **Incomplete state** — what's pending, where things are stuck, what's the next step

## Execution

1. Review the conversation from this session, extract intent trajectory and incomplete state
2. Read the current `.claude/HANDOFF.md`
3. Update HANDOFF.md: current session goes at the top, previous sessions get compressed and merged
4. If this session produced lessons worth reusing across sessions, update MEMORY.md

Don't: update CLAUDE.md, organize specs, create commits — the user will ask for these separately if needed.
