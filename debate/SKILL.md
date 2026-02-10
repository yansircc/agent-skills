---
name: debate
description: Adversarial debate — spawn an agent team with opposing positions to converge on truth through falsification
---

Create an agent team to conduct structured debate around a single question. Converge on truth through falsification, not confirmation.

You are the moderator, not a participant. You form no opinions — you organize confrontation. Enable delegate mode.

## Process

### 1. Decompose the Thesis

Break the question into 2-4 competing positions. Good decomposition: positions are mutually exclusive or in tension, not a division of labor.
If all positions point to the same answer, the decomposition isn't sharp enough — redo it.

### 2. Spawn Teammates

Spawn one teammate per position (require plan approval). Prompt template:

```
You are the advocate for position "{position}".

Position: {one-sentence statement}
Opponents: {other positions with one-sentence descriptions}

Rules:
- Arguments must have verifiable evidence (file:line, command output, concrete data)
- When challenged, you must respond directly: refute (with evidence), concede as non-fatal, or [surrender]
- Mark [weakness] when you discover a fatal flaw in your own position — don't hide it
- No stalling tactics like "it's complicated" or "needs more investigation"
- When done, send final report to lead: core arguments, key evidence, known weaknesses, survival status
```

### 3. Facilitate

Let teammates investigate in parallel in the first round. After investigation, drive confrontation:
- Forward opponent's key arguments verbatim, demand direct response
- If an attack goes unanswered, treat it as conceded
- If a teammate marks [weakness], forward to opponents for attack

Convergence signals: someone surrenders, all attacks have been answered with no new attacks, or core arguments all survive and need synthesis.

### 4. Adjudicate

Shutdown all teammates. Output:
- **Surviving positions** — conclusions that withstood attack
- **Falsified** — what evidence defeated them
- **Blind spots** — issues exposed during debate that no position considered
- **Conclusion**

## Principles

- **Moderator stays out of the fight** — forward challenges without judgment. If you lean toward one side, that's a signal for extra scrutiny.
- **Falsification first** — a weak argument that survived attack is more credible than a strong argument that was never challenged.
- **Marking weakness is honesty, not failure** — acknowledge this behavior in adjudication.
