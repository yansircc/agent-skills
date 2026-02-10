---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

## Core Principles

**Context window is a public good.** Claude is already very smart — only add what it doesn't already know. Challenge each paragraph: does it justify its token cost? Prefer concise examples over verbose explanations.

**Match freedom to fragility.** High freedom (prose instructions) when multiple approaches work. Medium (pseudocode/parameterized scripts) when a preferred pattern exists. Low (exact scripts) when operations are fragile or sequence-critical.

## Skill Structure

```
skill-name/
├── SKILL.md              # Required. YAML frontmatter + markdown body.
├── scripts/              # Deterministic/repeated code. Token-efficient, executable without loading.
├── references/           # Documentation loaded on-demand. Keeps SKILL.md lean.
└── assets/               # Output resources (templates, images, fonts). Never loaded into context.
```

### SKILL.md

- **Frontmatter** (YAML, required): `name` + `description` only. `description` is the trigger mechanism — include both what the skill does and when to use it. All "when to use" info goes here, not in the body (body loads after triggering).
- **Body** (Markdown): Procedural instructions for using the skill and its resources. Keep under 500 lines. Use imperative form.

### Resource Guidelines

| Type | When to Bundle | Example |
|------|---------------|---------|
| `scripts/` | Same code rewritten repeatedly, or deterministic reliability needed | `scripts/rotate_pdf.py` |
| `references/` | Domain knowledge Claude needs on-demand (schemas, APIs, policies) | `references/schema.md` |
| `assets/` | Files used in output, not loaded into context | `assets/template.pptx` |

- Information lives in SKILL.md **or** references, never both. Detailed material → references; core workflow → SKILL.md.
- Large references (>10k words): include grep patterns in SKILL.md.
- References >100 lines: include TOC at top.
- Keep references one level deep from SKILL.md — no nested chains.
- **Never create**: README.md, CHANGELOG.md, INSTALLATION_GUIDE.md, or any auxiliary documentation. Skills contain only what the agent needs to do the job.

## Progressive Disclosure

Three loading levels:

1. **Metadata** (name + description) — always in context (~100 words)
2. **SKILL.md body** — loaded when skill triggers (<5k words)
3. **Bundled resources** — loaded as needed (unlimited)

When a skill supports multiple variants/frameworks/domains, keep only the core workflow and selection logic in SKILL.md. Move variant-specific details into separate reference files:

```
cloud-deploy/
├── SKILL.md              # Workflow + provider selection
└── references/
    ├── aws.md            # Only loaded when user chooses AWS
    ├── gcp.md
    └── azure.md
```

## Creation Process

### 1. Understand with concrete examples

Clarify usage patterns through user examples or validated hypotheticals. Key questions: What triggers this skill? What are representative user requests? What functionality should it cover?

Don't ask too many questions at once. Conclude when the scope is clear.

### 2. Plan reusable contents

For each example, ask: what would I rewrite every time? That's a `script/`. What would I rediscover every time? That's a `reference/`. What boilerplate would I copy every time? That's an `asset/`.

### 3. Initialize

Create the skill directory with SKILL.md (frontmatter + body) and resource subdirectories as needed. Only create directories that will be used.

### 4. Implement

1. Build reusable resources first (may require user input for brand assets, schemas, etc.)
2. Test added scripts by running them. For many similar scripts, test a representative sample.
3. Delete any unused example files/directories.
4. Write SKILL.md body: procedural instructions referencing bundled resources. Describe clearly when to read each reference file.

**Bundled scripts are a power feature.** Scripts in `scripts/` can be executed directly without loading into context — this makes them far more token-efficient than inline code or instructions that ask Claude to write the same code each time. When a workflow has a deterministic, repeatable step (rotate a PDF, validate a schema, scaffold a project), write it as a bundled script and call it from SKILL.md:

```markdown
## Rotate PDF
Run `scripts/rotate_pdf.py <input> <degrees> <output>` to rotate pages.
```

Claude executes the script without reading it. Only read the script when patching or adapting to the environment is needed.

### 5. Validate and package

Verify: frontmatter has `name` + `description`, directory structure is clean, no extraneous files, description comprehensively covers triggers.

### 6. Iterate

Use on real tasks → notice struggles → update SKILL.md or resources → test again.
