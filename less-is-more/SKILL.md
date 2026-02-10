---
name: less-is-more
description: Addition by Subtraction — resist over-engineering, enforce simplicity, trust the substrate. Triggers: architecture decisions, code review for complexity, agent/tool design.
---

# Less Is More: Addition by Subtraction

## The Vercel Lesson

Vercel built a text-to-SQL agent with 15+ specialized tools, heavy prompt engineering, and careful context management. It was fragile, slow, and required constant maintenance. They deleted 80% of it, kept one tool (bash), and got: **3.5x faster, 37% fewer tokens, 100% success rate**.

The best agent architecture is almost no architecture at all.

## Rules

### 1. Start with the simplest possible architecture

Model + file system + goal. Add complexity only when you've **proven** it's necessary — not when you've imagined it might be.

### 2. Every abstraction is a decision you're making for the caller

Every tool, wrapper, helper, and layer is you deciding for the model/user. Sometimes they make better choices. Three similar lines of code is better than a premature abstraction.

### 3. Don't solve problems the substrate already handles

> grep is 50 years old and still does exactly what we need. We were building custom tools for what Unix already solves.

File systems, exit codes, JSONL, stdin/stdout, environment variables — trust the substrate. Build only what it can't do.

### 4. Don't constrain reasoning you don't trust

> We were constraining reasoning because we didn't trust the model to reason. That constraint became a liability.

Don't pre-filter context, don't limit options, don't wrap interactions in validation logic. Give raw materials, not pre-chewed summaries.

### 5. Invest in foundations, not scaffolding

Clear naming, well-structured data, good documentation — these matter more than clever tooling. If the raw material is legible, the model can read it directly. If it's a mess, no amount of tooling will save you.

### 6. Build for the model you'll have in 6 months

Models improve faster than your tooling can keep up. The less scaffolding you build, the less you'll have to tear down.

## Anti-patterns

- Building custom tools for what stdlib/Unix already solves
- Adding guardrails, validation, or error handling "just in case"
- Pre-filtering information the model could evaluate itself
- Creating helpers/utilities for one-time operations
- Designing for hypothetical future requirements
- Feature flags or backwards-compatibility shims when you can just change the code
- Multiple specialized tools when one general tool suffices

## Decision Test

Before adding any abstraction, ask:

1. **Have I proven this is necessary?** Not imagined — proven, with a failure.
2. **Am I doing the model's/user's thinking for them?**
3. **Does the substrate already handle this?**
4. **Will this need to be torn down when the model improves?**

If any answer is yes, delete instead of add.

## The One-Liner

> The right abstraction is discovered by deletion, not designed by addition.
