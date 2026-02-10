---
name: refactor
description: Analyze and optimize code following software engineering best practices
---

Meta-level refactoring guidance — not telling you what specifically to change, but helping you think clearly about whether to change, what to change, and how to verify.

## 1. First Ask: Is It Worth Refactoring?

Before analyzing code, establish a judgment framework:

**Benefits of refactoring** (at least one must apply to be worthwhile):
- Reduce comprehension cost: how long does it take a newcomer to read this code?
- Reduce modification cost: how many places need to change next time?
- Reduce error probability: does the current structure easily introduce bugs?

**Costs of refactoring** (must be honestly assessed):
- Time cost: how long will this refactoring take?
- Risk cost: what problems might it introduce? Is test coverage sufficient?
- Cognitive cost: will the team need to re-learn the new structure?

**Signals it's not worth refactoring**:
- "Doesn't look elegant enough" — but no concrete pain point
- "Violates some principle" — but causes no issues in practice
- "Might need extension later" — but the extension need is hypothetical

## 2. Identify Problems: Symptoms vs Causes

When a user says "this module needs refactoring," first distinguish:

| Symptom (Surface) | Possible Cause | Different causes → different solutions |
|-------------------|---------------|---------------------------------------|
| File too large | Mixed responsibilities → split | Too much duplicate code → extract functions |
| Changing one place requires changing many | Missing abstraction → extract | Tight coupling → decouple |
| Code hard to understand | Poor naming → rename | Complex logic → simplify/comment |
| Frequent bugs | Messy state management → restructure state | Poor boundary handling → add validation |

**Follow-up checklist**:
- What specific trouble has this problem caused in actual development?
- When was the last time you got burned by this problem?
- If left unchanged, what's the worst case?

## 3. Weigh Trade-offs: No Perfect Solution

Every refactoring has trade-offs that must be stated clearly:

**Common trade-offs**:
- Cohesion vs file count: keeping together aids understanding, splitting aids reuse
- Abstraction vs directness: abstraction reduces duplication but adds indirection
- Flexibility vs simplicity: high configurability means high complexity
- Performance vs readability: optimized code is faster but harder to understand

**Decision principles**:
- Prioritize solving current actual pain points, not hypothetical future ones
- Choose solutions the team can understand and maintain, not the "most elegant" ones
- Small incremental improvements beat large-scale rewrites

## 4. How to Think When Analyzing Code

Don't mechanically apply principles — follow up with questions:

**When seeing "duplicate code"**:
- Is the similarity coincidental or essential?
- If extracted, will they change together in the future?
- Can the extracted piece be named clearly to express intent?

**When seeing "large file/function"**:
- From a domain perspective, is this one concept or many?
- Does the reader need to understand all of it, or can they understand it in chunks?
- After splitting, how many jumps are needed to understand one feature?

**When seeing "principle violation"**:
- Has this "violation" caused problems in actual use?
- What's the cost of following this principle?
- Is this possibly a legitimate exception?

## 5. Execute Refactoring: Safety First

**Before starting**:
- Ensure sufficient test coverage (or add tests first)
- Define rollback plan

**During execution**:
- Small commits, each verifiable
- Run tests immediately after changes
- Keep behavior unchanged, only change structure

**Post-completion verification**:
- Tests passing doesn't mean refactoring succeeded
- Ask: is the code easier to understand now?
- Ask: will the next modification be simpler?
- If the answer is no, consider rolling back

## 6. Boundary Constraints

- Don't auto-execute large-scale refactoring without user confirmation
- When refactoring benefit is unclear, recommend "don't refactor yet"
- Preserve the user's option to "mark as intentional design" — not all imperfect-looking code needs changing

## 7. Important

1. Must enable plan mode to complete exploration and thinking
