---
name: spike
description: >
  Minimum viable loop validation — before committing to a complex task, identify the core
  assumption and build the smallest possible falsifiable experiment. Throwaway, isolated,
  single-point penetration. Triggers: spike, minimum loop, preflight, tracer, verify first,
  feasibility check. Should also be proactively suggested when facing complex tasks with
  unverified core assumptions.
---

# Spike — Minimum Viable Loop

Before building, falsify or confirm the core assumption at minimum cost. Scientific method applied to engineering: falsify first, invest later.

## Principles

- **One assumption, one experiment** — never validate multiple things at once
- **Minimal** — 10-30 lines of code, one file, one execution
- **Isolated** — runs in /tmp/spike-xxx, never modifies the workspace
- **Throwaway** — spike code never enters the main project
- **Failure = most valuable output** — the break point is the critical finding

## Workflow

### 1. Identify the Core Assumption

Use these meta-questions to converge on the target:

1. **"If this can't be done, does the rest of the work still matter?"** — Find the load-bearing assumption. If the answer is "no", that's your spike target.
2. **"Which part am I _assuming_ works vs. _confirmed_ works?"** — Separate assumptions from known facts.
3. **"Worst case, what would force me to scrap the entire approach?"** — Find the single point of fatal risk.
4. **"Can I verify this in 5 lines of code? If not, can the assumption be decomposed further?"** — Force minimality.
5. **"Will the result of this experiment give me a clear go/no-go decision?"** — Ensure the spike is decisive, not exploratory.

Report to the user:

> The core assumption of this task is ... I'll run a minimal experiment to verify it first.

Wait for user confirmation (or assumption adjustment) before proceeding.

### 2. Design the Experiment

Build the **smallest runnable code** to confirm or falsify the assumption. Any form works:

- A curl command
- A 10-line script
- A minimal code snippet
- A database query
- A single API call

**Not needed**: error handling, abstractions, comments, types, tests, clean code.
**Only needed**: it runs, you see a result.

The spike code can be completely unrelated in form to the main task. Do not reuse any code structure from the main project. Only focus on: does the kernel work?

### 3. Execute

```bash
# Create isolated directory
SPIKE_DIR="/tmp/spike-$(date +%s)"
mkdir -p "$SPIKE_DIR"
# Write and execute experiment code in this directory
```

Write code in the isolated directory and execute it. Observe the output.

### 4. Verdict

Output a report in this exact format (no free-form prose, follow the template strictly):

```
## Spike Report
- Assumption: [one sentence describing the core assumption tested]
- Experiment: [what was done, one sentence]
- Result: PASS / FAIL
- Evidence: [paste key output, 10 lines max]
- Decision: proceed with main task / abort (reason) / alternative: ___
```

On FAIL, additionally report:
1. Where it broke (pinpoint which step failed)
2. What was observed (error messages / unexpected behavior / unexpected output)
3. Recommended next step (alternative approach / decision needed from user)

Never hide a failure. Failure is the most valuable output of a spike.

### 5. Cleanup

```bash
rm -rf "$SPIKE_DIR"
```

The spike's mission is complete. Success or failure, clean up and return to the main task flow.