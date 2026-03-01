---
name: ci-review
description: >
  Configure CI-based AI PR review in GitHub Actions with Claude Code and/or OpenAI Codex.
  Includes agent setup, auth/config, review execution, output filtering, and PR comment posting.
  Triggers: ci review, code review CI, setup review workflow, ai review pipeline.
---

# CI Review - Automated PR Code Review

Goal: every PR gets an automated, structured review comment.

## Preflight

Ask before editing files:
1. Tool access: Claude Code, Codex, or both?
2. Reviewer topology: single reviewer or dual cross-validation?
3. Existing assets: `.github/workflows/`, `.claude/agents/`, `AGENTS.md` already present?
4. Endpoint type: official API vs relay/proxy? If Codex is used, read `~/.codex/config.toml` and `~/.codex/auth.json`.
5. Output language?
6. Review policy: focus (security/correctness/perf/style), severity scheme, comment-only vs merge-blocking, agent mode (full-context, slower) vs diff-only (faster).

Report scope and wait for confirmation.

## Architecture Options

### A) Claude only (simplest)
`PR event -> install @anthropic-ai/claude-code -> claude --agent code-reviewer -p ... -> gh pr comment`

Requires: `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL` if custom endpoint).

### B) Codex only (verified; default recommendation)
`PR event -> install @openai/codex -> codex review --base origin/$BASE -> filter output -> gh pr comment`

Requires: `OPENAI_API_KEY`, `~/.codex/config.toml`, `~/.codex/auth.json`, and `CODEX_RELAY_BASE_URL` when using relay.

Mandatory: use `codex review --base`, not `codex -a full-auto -p`.

### C) Claude + Codex in parallel
Use two independent jobs and one instruction source:

```text
.claude/agents/code-reviewer.md  # source of truth
AGENTS.md -> symlink             # Codex reads this
```

## Implementation

### 1) Agent definition

Create `.claude/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: PR code reviewer. Autonomously explores codebase and outputs structured review.
tools: Read, Grep, Glob, Bash
model: opus
permissionMode: bypassPermissions
---

[Review instructions: checks, severity, output format]
```

Guidelines:
- `model`: `opus` (quality), `sonnet` (cost), `haiku` only for trivial repos.
- `permissionMode: bypassPermissions` is required in CI.
- Keep tools read-only unless explicitly needed.
- `memory: project` is optional for cross-PR memory.

Codex compatibility:

```bash
ln -s .claude/agents/code-reviewer.md AGENTS.md
```

YAML frontmatter in `AGENTS.md` is safe; Codex treats it as plain text.

### 2) Workflow essentials

#### Claude job

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
    fetch-depth: 0

- run: npm install -g @anthropic-ai/claude-code

- name: Fetch base branch
  run: git fetch origin ${{ github.event.pull_request.base.ref }}

- name: Run Claude Review
  env:
    BASE_BRANCH: ${{ github.event.pull_request.base.ref }}
    ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    claude --agent code-reviewer \
      -p "Review changes on branch ${{ github.head_ref }} against origin/${BASE_BRANCH}" \
      > /tmp/review.txt 2>&1
```

#### Codex config (choose one)

Relay endpoint:

```yaml
- name: Configure Codex (relay)
  env:
    CODEX_BASE_URL: ${{ secrets.CODEX_RELAY_BASE_URL }}
    CODEX_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    mkdir -p ~/.codex
    cat > ~/.codex/config.toml << EOF
    model_provider = "relay"
    model = "gpt-5.3-codex-spark"
    model_reasoning_effort = "xhigh"
    disable_response_storage = true

    [model_providers.relay]
    name = "relay"
    base_url = "${CODEX_BASE_URL}"
    wire_api = "responses"
    requires_openai_auth = true
    EOF
    printf '{"OPENAI_API_KEY": "%s"}' "$CODEX_API_KEY" > ~/.codex/auth.json
```

Official OpenAI endpoint:

```yaml
- name: Configure Codex (official)
  env:
    CODEX_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    mkdir -p ~/.codex
    cat > ~/.codex/config.toml << EOF
    model = "codex-mini"
    disable_response_storage = true
    EOF
    printf '{"OPENAI_API_KEY": "%s"}' "$CODEX_API_KEY" > ~/.codex/auth.json
```

Run Codex review, extract final text, truncate if needed:

```yaml
- name: Run Codex Review
  env:
    BASE_BRANCH: ${{ github.event.pull_request.base.ref }}
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: |
    codex review \
      --base "origin/${BASE_BRANCH}" \
      --title "${PR_TITLE}" \
      > /tmp/raw.txt 2>&1 || true

    if grep -q "^codex$" /tmp/raw.txt; then
      tac /tmp/raw.txt | sed '/^codex$/q' | tac | sed '1d' > /tmp/review.txt
    else
      cp /tmp/raw.txt /tmp/review.txt
    fi

    if [ "$(wc -c < /tmp/review.txt)" -gt 60000 ]; then
      head -c 60000 /tmp/review.txt > /tmp/review_truncated.txt
      printf '\n\n---\n*Review truncated due to length.*\n' >> /tmp/review_truncated.txt
      mv /tmp/review_truncated.txt /tmp/review.txt
    fi
```

Post comment:

```yaml
- name: Post Review Comment
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
  run: |
    if [ ! -s /tmp/review.txt ]; then
      echo "Review output is empty, skipping comment."
      exit 0
    fi

    gh pr comment "$PR_NUMBER" --body "$(cat <<EOF
    ## Codex CR: PR #${PR_NUMBER}

    $(cat /tmp/review.txt)

    ---
    *Automated review by [Codex](https://openai.com/codex) using [CR Agent](.claude/agents/code-reviewer.md)*
    EOF
    )"
```

Non-negotiable rules:
- `ref: head.sha` and `fetch-depth: 0` for reliable diff context.
- Redirect order is `> file 2>&1`.
- `codex review --base` and prompt arg cannot be combined; use `AGENTS.md` for custom instructions.
- Pass PR title with `--title`; Codex does not read PR body/comments/issues.
- Codex requires both `config.toml` and `auth.json`.
- Use `printf` for `auth.json`, not `echo`.
- Use unquoted heredoc `<< EOF` when shell var expansion is needed.
- Keep `|| true` so review step non-zero does not suppress comment posting.

### 3) Secrets

Read local Codex config first (`~/.codex/config.toml`, `~/.codex/auth.json`), then set repo secrets:

| Secret | Claude | Codex official | Codex relay |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | no | no |
| `ANTHROPIC_BASE_URL` | custom only | no | no |
| `OPENAI_API_KEY` | no | yes | yes |
| `CODEX_RELAY_BASE_URL` | no | no | yes |

Set with `gh secret set <NAME> --body "<VALUE>"`.

### 4) Testing and quality calibration

Local spike before pushing CI:

```bash
SPIKE_DIR="/tmp/spike-$(date +%s)"
mkdir -p "$SPIKE_DIR" && cd "$SPIKE_DIR"
git init && git checkout -b main
echo "console.log('hello')" > index.js
git add . && git commit -m "init"

git checkout -b test-pr
echo "const x = 1/0;" >> index.js
git add . && git commit -m "add bug"

echo "# Review Instructions\nFind bugs in the code." > AGENTS.md
codex review --base main
```

Then:
1. Push workflow to base branch first (`main`/`staging`). `pull_request` uses workflow from base branch.
2. Open a PR with intentional defects.
3. Verify: trigger -> reviewer run -> comment.
4. If failed: `gh run view <RUN_ID> --log-failed`.

Calibrate expected detection:

| Bug type | Seed example | Expected |
|---|---|---|
| Security | missing auth/scope check | High (P1) |
| SQL safety | `inArray` without empty-array guard | High (P2) |
| SSOT convention | `throw new Error()` instead of factory | Low |
| ID convention | `crypto.randomUUID()` instead of project helper | Low |

Observed baseline: Codex is strong on runtime/security issues; convention-only checks should stay in lint/guardrails.

## Codex Data Boundaries

| Source | Read? | Note |
|---|---|---|
| `git diff` | yes | primary input |
| `AGENTS.md` | yes | auto-read from repo root |
| repository files | yes | context lookup |
| PR title (`--title`) | yes | explicit input |
| PR body/comments/issues | no | not fetched in `codex review` |

## Output Parsing

Raw output includes exec logs; final review starts after the last line exactly equal to `codex`.

Example:

```text
OpenAI Codex ...
...
exec ... git diff ...
exec ... sed ...
codex
- [P1] ...
- [P2] ...
```

Filter:
- Ubuntu/CI: `tac /tmp/raw.txt | sed '/^codex$/q' | tac | sed '1d' > /tmp/review.txt`
- macOS/local: `tail -r /tmp/raw.txt | sed '/^codex$/q' | tail -r | sed '1d' > /tmp/review.txt`

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Using `codex -a full-auto -p` for review | weaker context/output | use `codex review --base` |
| `--max-tokens` with Claude CLI | unknown option | remove it |
| Wrong redirect order | empty/partial file | use `> file 2>&1` |
| Missing `auth.json` | `401 Unauthorized` | create `~/.codex/auth.json` |
| `--base` plus prompt arg | argument conflict | use `AGENTS.md` for instructions |
| YAML frontmatter in `AGENTS.md` | parse concern | safe; treated as text |
| Workflow only on PR branch | CI does not trigger | workflow must exist on base branch |
| Nested Claude session | launch error | run `env -u CLAUDECODE` or tmux |
| `echo` for auth JSON | broken JSON with special chars | use `printf` |
| Quoted heredoc for TOML | vars do not expand | use unquoted `<< EOF` |
| `tac` on macOS | command not found | use `tail -r` locally |
| Oversized comment body | rejected/truncated comment | cap around 60000 chars |
