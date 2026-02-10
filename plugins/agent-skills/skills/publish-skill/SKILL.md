---
name: publish-skill
description: >-
  Guide for packaging and publishing skills to a Claude Code plugin marketplace.
  Use when users say "publish skill", "publish to marketplace", "add skill to marketplace",
  "package skill as plugin", or "distribute skill".
version: 1.0.0
---

# Publish Skill

Package a skill into a Claude Code plugin and publish it to a marketplace.

**Prerequisite**: The skill's `SKILL.md` is already created (see `/agent-skills:skill-creator` for writing skills).

## Step 1: Package as Plugin

Wrap your skill in the standard plugin structure:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── my-skill/
        ├── SKILL.md
        ├── scripts/       # optional
        └── references/    # optional
```

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Brief description of what the plugin provides",
  "author": { "name": "your-name" },
  "repository": "https://github.com/user/repo",
  "license": "MIT",
  "keywords": ["relevant", "tags"]
}
```

**Name rules**: kebab-case, lowercase, no spaces. Must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`.

## Step 2: Choose Distribution Path

### Option A: Standalone Marketplace

Host your own marketplace repo on GitHub. Best for: collections of related skills you maintain.

Create `.claude-plugin/marketplace.json` at repo root:

```json
{
  "name": "your-marketplace-name",
  "owner": { "name": "your-github-username" },
  "metadata": {
    "description": "What this marketplace provides",
    "version": "1.0.0",
    "pluginRoot": "."
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "./plugins/my-plugin",
      "description": "Plugin description",
      "version": "1.0.0",
      "author": { "name": "your-name" }
    }
  ]
}
```

Users install with:
```bash
/plugin marketplace add your-github-username/your-repo
/plugin install my-plugin@your-marketplace-name
```

### Option B: Contribute to an Existing Marketplace

Best for: single skills that fit an existing collection.

To contribute to `yansircc/agent-skills`:

1. Fork the repo
2. Add your skill to `plugins/agent-skills/skills/your-skill/SKILL.md`
3. Submit a PR

## Step 3: Validate

Test locally before publishing:

```bash
# Register local marketplace
/plugin marketplace add ./path/to/your-repo

# Install the plugin
/plugin install my-plugin@your-marketplace-name

# Test skill invocation
/my-plugin:my-skill
```

Verify:
- Skill appears in `/skills` listing
- Skill triggers on expected phrases
- Scripts execute correctly (if any)
- References load when needed (if any)

## Step 4: Publish

Push to GitHub. Users can then:

```bash
/plugin marketplace add your-github-username/your-repo
/plugin install my-plugin@your-marketplace-name
```

## Checklist

- [ ] `plugin.json` has valid kebab-case `name`
- [ ] `marketplace.json` `source` paths point to correct plugin directories
- [ ] `SKILL.md` has YAML frontmatter with `name`, `description`, `version`
- [ ] All script paths use `${CLAUDE_PLUGIN_ROOT}` (not hardcoded paths)
- [ ] README documents installation steps
