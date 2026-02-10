# Agent Skills

Reusable skills for [Claude Code](https://claude.com/claude-code) — thinking modes, workflows, and agent orchestration. Distributed as a Claude Code plugin marketplace.

## Install

```bash
# Register the marketplace
/plugin marketplace add yansircc/agent-skills

# Install plugins
/plugin install agent-skills@yansircc-skills
/plugin install pawl-foreman@yansircc-skills    # optional, for pawl orchestration
```

## Plugins

### agent-skills

Thinking, workflow, and tool reference skills.

| Skill | Description |
|-------|-------------|
| **claude-cli** | Claude CLI command reference for building executable commands |
| **codex-cli** | OpenAI Codex CLI command reference for building executable commands |
| **debate** | Adversarial debate — spawn opposing agents to converge on truth through falsification |
| **essence** | Compression mode — output the shortest generative program of the problem |
| **handoff** | Session handoff — prepare knowledge transfer for the next session |
| **interview** | Co-creation mode — structured questioning to sharpen vague ideas |
| **less-is-more** | Addition by Subtraction — resist over-engineering, enforce simplicity |
| **negate** | Negation mode — test whether a conclusion survives counter-argumentation |
| **pickup** | Quickly pick up a project and understand the current development state |
| **publish-skill** | Guide for packaging and publishing skills to a marketplace |
| **refactor** | Analyze and optimize code following software engineering best practices |
| **rethink** | Informed reset — redesign with known information to break anchoring bias |
| **skill-creator** | Guide for creating effective skills |

Usage:
```
/agent-skills:debate Should we use a monorepo or polyrepo?
/agent-skills:essence What is dependency injection?
/agent-skills:rethink
```

### pawl-foreman

AI agent foreman — orchestrate multi-step tasks using [pawl](https://github.com/yansircc/pawl).

Usage:
```
/pawl-foreman:pawl-foreman
```

## Creating Skills

Use `/agent-skills:skill-creator` to write a new skill, then `/agent-skills:publish-skill` to package and publish it.

## Skill Structure

```
skill-name/
├── SKILL.md              # Required. YAML frontmatter + markdown body.
├── scripts/              # Executable scripts (token-efficient, run without loading).
└── references/           # On-demand documentation (loaded when needed).
```

## License

MIT
