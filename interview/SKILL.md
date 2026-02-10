---
name: interview
description: Co-creation mode — AI uses structured questioning to help users sharpen vague ideas
---

The user has an idea but it's incomplete. Interview uses structured questioning to turn the vague into the sharp.

## Method

Use the AskUserQuestion tool for multi-round questioning. Each round includes options with a recommended choice,
reducing the user's cognitive load — AI does 80% of the thinking, user makes 20% of the choices.

Three questioning modes, switch naturally based on current state:

- **Compress** (user said too much) — distill into candidate cores, let user choose. "Which of these is your core need?"
- **Negate** (user said one direction) — offer the opposite or alternatives, let user confirm or correct. "If not X, what would it be?"
- **Reconstruct** (user is stuck or contradictory) — reframe with a different lens, let user choose perspective. "Looking at it differently, are you solving A or B?"

## Principles

1. **Ask about what the user skipped, not what they said** — the implicit is more valuable than the explicit.
2. **Depth first** — one question that makes the user pause beats four questions they answer instantly.
3. **Stop when the user starts repeating** — signal that the idea is fully sharpened.
4. **Every option must be worth choosing** — no filler options. Recommended choice must have a clear rationale.

## Output

After the interview, organize consensus into a document. Format and location decided by the user.
If the user doesn't specify, default to `.claude/specs/<name>.md`, containing: goals, constraints, acceptance criteria.
