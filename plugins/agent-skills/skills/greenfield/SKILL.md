---
name: greenfield
description: Activate code hygiene mode — eliminate dead code and keep the codebase lean with every change
---

Greenfield mode. This is a personal project with no external consumers and no backward-compatibility burden. Every change is an opportunity to refine the codebase — code should get smaller and clearer with each edit, not larger.

## Step 0: Discover & Run Dead-Code Tools

Before manual review, let tools do the heavy lifting. Execute this sequence:

1. **Detect stack** — Read project root for `go.mod`, `package.json`, `Cargo.toml`, `pyproject.toml`, etc. to identify languages in use.

2. **Search for best tools** — For each detected language, web-search:
   > "best dead code / unused export / unreachable function detection CLI tool for {language} {year}"

   Look for tools that do **whole-program reachability analysis**, not just single-file linting. Examples of what you might find (do NOT hardcode — always search for current best):
   - Go → `deadcode`, `staticcheck`
   - JS/TS → `knip`, `ts-prune`
   - Rust → `cargo-udeps`, compiler warnings
   - Python → `vulture`, `ruff`

3. **Install & run** — Install any missing tools, run them, capture output.

4. **Act on findings** — Delete every confirmed-dead item. If a tool reports a false positive (e.g. reflection-based usage), skip it silently — do not suppress the warning.

This step replaces manual `grep` for unused symbols. Only fall back to grep if no suitable tool exists for the stack.

## Rules

1. **Delete over keep** — Dead code gets deleted outright. No commenting out, no `_unused` prefix, no re-export, no deprecation marker. Git remembers everything so you don't have to.

2. **Replace over accommodate** — When changing an interface, update all call sites directly. No wrappers / adapters / shims / legacy aliases. Only one version of the code exists.

3. **Inline over abstract** — If a function/type/interface is used exactly once, inline it at the call site. Don't pre-abstract for "future reuse." Extract only after three repetitions.

4. **Ripple cleanup** — When changing one spot, proactively check: did this make anything redundant (unused imports, orphaned helpers, empty modules)? If so, clean them up in the same change.

5. **Direct over configurable** — No feature flags, no toggle parameters, no "strategy pattern" unless there are already two or more variants that need to coexist right now.

## Forbidden Patterns

The following patterns are **strictly prohibited** in this project:

- `// TODO: remove later` / `// deprecated` — There is no "later." Delete now.
- Suppressing dead code warnings via annotations or config — Delete the dead code instead of silencing the compiler/linter.
- Renaming old functions to `_old_xxx`, `xxx_v1`, `xxx_legacy` — Delete them.
- Switching between old and new logic via flag/config — Use the new logic, delete the old.
- Empty compatibility re-exports — Update the call sites.
- Commenting out old code "just in case" — Delete it. It's in git history.
- Adding comments/docs/type annotations to code you didn't change — Only touch what you're changing.

## Decision Rule

When in doubt about whether to keep something, ask:

> **Is any code calling it right now?**
> - Yes → Keep
> - No → Delete
>
> There is no third option. "Might need it later" does not exist.
