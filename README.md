# Agent Skills

A collection of reusable skills for [Claude Code](https://claude.com/claude-code). Each skill extends Claude's capabilities with specialized workflows, thinking modes, and tool integrations.

## Skills

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
| **pawl-foreman** | AI agent foreman — orchestrate multi-step tasks using [pawl](https://github.com/yansircc/pawl) |
| **pickup** | Quickly pick up a project and understand the current development state |
| **refactor** | Analyze and optimize code following software engineering best practices |
| **rethink** | Informed reset — redesign with known information to break anchoring bias |
| **skill-creator** | Guide for creating effective skills |

## Install

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/yansircc/agent-skills.git ~/.claude/skills
```

Or symlink if you want to keep it elsewhere:

```bash
git clone https://github.com/yansircc/agent-skills.git ~/code/agent-skills
ln -s ~/code/agent-skills ~/.claude/skills
```

## Usage

Skills are automatically available in Claude Code. Invoke them with slash commands:

```
/debate Should we use a monorepo or polyrepo?
/essence What is dependency injection?
/interview I want to build a CLI tool...
/rethink
```

## Skill Structure

Each skill follows this structure:

```
skill-name/
├── SKILL.md              # Required. YAML frontmatter + markdown body.
├── scripts/              # Executable scripts (token-efficient, run without loading).
└── references/           # On-demand documentation (loaded when needed).
```

See [skill-creator](skill-creator/SKILL.md) for the full guide on creating skills.

## License

MIT
