#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# pawl dashboard demo — live execution
# 12 tasks across 4 workflows, demonstrating:
#   success, auto-retry, manual intervention, dependency DAG,
#   live Claude stream-json, workflow tabs, parallel execution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set -euo pipefail

# ── Colors ────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

WORKDIR="/tmp/pawl-demo-$$"
SERVE_PID=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
UI="$PROJECT_ROOT/plugins/pawl-foreman/skills/pawl-foreman/ui/dist/index.html"
PORT=18932

cleanup() {
    [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null; wait "$SERVE_PID" 2>/dev/null || true
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

banner() {
    echo ""
    echo -e "${BOLD}${CYAN}═══ $1 ═══${NC}"
}

show_tasks() {
    pawl list 2>/dev/null | python3 -c "
import json, sys
tasks = json.load(sys.stdin)
colors = {'completed': '\033[0;32m', 'running': '\033[0;36m',
          'waiting': '\033[0;33m', 'failed': '\033[0;31m',
          'pending': '\033[2m', 'stopped': '\033[2m'}
nc = '\033[0m'
for t in tasks:
    s = t['status']
    c = colors.get(s, '')
    name = t['name']
    cs, ts, sn = t['current_step'], t['total_steps'], t['step_name']
    wf = t.get('workflow_name', '')
    extra = ''
    if t.get('retry_count', 0) > 0: extra += f' retry={t[\"retry_count\"]}'
    if t.get('blocked_by', []): extra += f' blocked=[{\",\".join(t[\"blocked_by\"])}]'
    print(f'  {c}{name:18s} {s:10s} [{cs}/{ts}] {sn:12s} {wf}{extra}{nc}')
" 2>/dev/null || true
}

show_streams() {
    local header=false
    for f in .pawl/streams/*.stream; do
        [ -f "$f" ] || continue
        local task
        task=$(basename "$f" .stream)
        local last_line
        last_line=$(tail -1 "$f" 2>/dev/null)
        if [ -n "$last_line" ]; then
            if ! $header; then
                echo -e "  ${DIM}── stream ──${NC}"
                header=true
            fi
            echo -e "    ${DIM}${task}>${NC} ${DIM}${last_line}${NC}"
        fi
    done
}

wait_pids() {
    local SNAP=0
    while true; do
        local alive=false
        for pid in "$@"; do
            kill -0 "$pid" 2>/dev/null && alive=true
        done
        $alive || break
        sleep 2
        SNAP=$((SNAP + 1))
        echo ""
        echo -e "  ${DIM}── snapshot ${SNAP} ──${NC}"
        show_tasks
        show_streams
    done
}

# ── Setup ─────────────────────────────────────────────
banner "Setup"
echo -e "  Creating project in ${CYAN}${WORKDIR}${NC}"
mkdir -p "$WORKDIR" && cd "$WORKDIR"
pawl init >/dev/null 2>&1

# ── Simulation script ────────────────────────────────
cat > .pawl/sim.sh <<'SIMEOF'
#!/usr/bin/env bash
KEY="${PAWL_TASK}/$1"
case "$KEY" in

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # DEFAULT WORKFLOW — core git features
    # Steps: setup → design → develop → test → review
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # ── init-repo ─────────────────────────────────────
    init-repo/setup)
        echo "Creating worktree at .pawl/worktrees/init-repo..."
        sleep 0.4
        echo "Ready." ;;
    init-repo/design)
        echo "Analyzing repository structure requirements..."
        sleep 0.3
        echo "  objects/ — blob, tree, commit storage"
        sleep 0.3
        echo "  refs/    — branch and tag references"
        sleep 0.3
        echo "  HEAD     — current branch pointer"
        sleep 0.3
        echo "Design approved." ;;
    init-repo/develop)
        echo "Compiling src/init.rs..."
        sleep 0.4
        echo "Compiling src/repo.rs..."
        sleep 0.4
        echo "Compiling src/config.rs..."
        sleep 0.4
        echo "Linking minigit..."
        sleep 0.3
        echo "Build complete: target/debug/minigit" ;;
    init-repo/test)
        echo "Running tests..."
        sleep 0.2
        echo "test init_empty_repo ... ok"
        sleep 0.2
        echo "test init_with_gitignore ... ok"
        sleep 0.2
        echo "test init_already_exists ... ok"
        sleep 0.2
        echo "3 passed, 0 failed" ;;
    init-repo/review)
        echo "Running clippy..."
        sleep 0.3
        echo "Running fmt check..."
        sleep 0.2
        echo "All checks passed." ;;

    # ── add-commit (verify-develop fails first → retry) ─
    add-commit/setup)
        echo "Checking out branch pawl/add-commit..."
        sleep 0.4
        echo "Ready." ;;
    add-commit/design)
        echo "Designing commit data model..."
        sleep 0.3
        echo "  CommitMessage { subject, body, trailers }"
        sleep 0.3
        echo "  Tree → Index snapshot"
        sleep 0.3
        echo "Design approved." ;;
    add-commit/develop)
        echo "Writing src/commit.rs..."
        sleep 0.4
        echo "  + fn parse_message(input: &str) -> Result<CommitMessage>"
        sleep 0.3
        echo "  + fn create_tree(index: &Index) -> Result<TreeHash>"
        sleep 0.3
        echo "  + fn write_commit(tree: TreeHash, msg: CommitMessage) -> Result<Oid>"
        sleep 0.3
        if [ "${PAWL_RETRY_COUNT:-0}" != "0" ]; then
            echo "  (retry: added empty message validation)"
            sleep 0.3
        fi
        echo "Build complete." ;;
    add-commit/verify-develop)
        if [ "${PAWL_RETRY_COUNT:-0}" = "0" ]; then
            echo "test commit_basic ... ok" >&2
            echo "test commit_with_author ... ok" >&2
            echo "test commit_amend ... ok" >&2
            echo "test commit_empty_message ... FAILED" >&2
            echo "  expected: error, got: success" >&2
            echo "failures: 1, passed: 3" >&2
            exit 1
        fi
        echo "4 passed, 0 failed" >&2
        exit 0 ;;
    add-commit/test)
        echo "Running integration tests..."
        sleep 0.3
        echo "test commit_roundtrip ... ok"
        sleep 0.2
        echo "test commit_preserves_tree ... ok"
        sleep 0.2
        echo "test commit_parent_chain ... ok"
        sleep 0.2
        echo "test commit_hook_pre ... ok"
        sleep 0.3
        echo "4 passed, 0 failed" ;;
    add-commit/review)
        echo "Running clippy + fmt..."
        sleep 0.3
        echo "All checks passed." ;;

    # ── add-branch (verify-test fails → waiting) ──────
    add-branch/setup)
        echo "Checking out branch pawl/add-branch..."
        sleep 0.4
        echo "Ready." ;;
    add-branch/design)
        echo "Designing branch reference system..."
        sleep 0.3
        echo "  refs/heads/{name} → commit oid"
        sleep 0.3
        echo "  symref HEAD → refs/heads/main"
        sleep 0.3
        echo "Design approved." ;;
    add-branch/develop)
        echo "Writing src/branch.rs..."
        sleep 0.4
        echo "  + fn create_branch(name: &str, target: Oid) -> Result<()>"
        sleep 0.3
        echo "  + fn delete_branch(name: &str) -> Result<()>"
        sleep 0.3
        echo "  + fn list_branches() -> Result<Vec<Branch>>"
        sleep 0.3
        echo "Compiling src/refs.rs..."
        sleep 0.3
        echo "Build complete." ;;
    add-branch/test)
        echo "Running integration tests..."
        sleep 0.3
        echo "test branch_create ... ok"
        sleep 0.2
        echo "test branch_delete ... ok"
        sleep 0.2
        echo "test branch_list ... ok"
        sleep 0.2
        echo "test branch_checkout ... ok"
        sleep 0.3
        echo "4 passed, 0 failed" ;;
    add-branch/verify-test)
        echo "error[clippy]: unused import \`std::collections::HashMap\`" >&2
        echo "  --> src/branch.rs:3:5" >&2
        echo "  |" >&2
        echo "3 | use std::collections::HashMap;" >&2
        echo "  |     ^^^^^^^^^^^^^^^^^^^^^^^^^^ help: remove it" >&2
        echo "  = note: \`-D unused-imports\` implied by \`-D warnings\`" >&2
        exit 1 ;;
    add-branch/review)
        echo "Checks passed (post-manual-fix)."
        sleep 0.2 ;;

    # ── add-log (Claude agent stream-json) ────────────
    add-log/setup)
        echo "Preparing workspace..."
        sleep 0.3
        echo "Ready." ;;
    add-log/design)
        echo '{"type":"system","subtype":"init","model":"claude-sonnet-4-6-20250514","tools":["Bash","Read","Edit","Glob","Grep"],"session_id":"design-log"}'
        sleep 0.3
        echo '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"I need to design the log walker. Key decisions: 1) Iterator-based traversal of parent chain, 2) Configurable formatting (oneline, short, full), 3) Support for --graph flag later. Let me sketch the API."}]}}'
        sleep 0.5
        echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Proposed design for git log:\n- LogWalker: iterator over commit chain\n- LogFormatter: oneline | short | full\n- Reverse chronological by default"}]}}'
        sleep 0.3
        echo '{"type":"result","subtype":"success","total_cost_usd":0.0021,"duration_ms":1800,"usage":{"input_tokens":600,"output_tokens":120}}' ;;
    add-log/develop)
        echo '{"type":"system","subtype":"init","model":"claude-sonnet-4-6-20250514","tools":["Bash","Read","Edit","Glob","Grep"],"session_id":"develop-log"}'
        sleep 0.3
        echo '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"I need to implement git log. Let me first read the existing repo module to understand the commit structure, then write a log walker that traverses the parent chain."}]}}'
        sleep 0.5
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"src/repo.rs"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"pub struct Commit {\n    pub oid: Oid,\n    pub parent_oid: Option<Oid>,\n    pub message: String,\n}","is_error":false}]},"tool_use_result":{"stdout":"pub struct Commit {...}","stderr":""}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"text","text":"I see the Commit struct with parent_oid. Writing walk_commits iterator and format_log."}]}}'
        sleep 0.5
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_02","name":"Write","input":{"file_path":"src/log.rs"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_02","content":"","is_error":false}]},"tool_use_result":{"stdout":"","stderr":""}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_03","name":"Bash","input":{"command":"cargo test -- log"}}]}}'
        sleep 0.4
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_03","content":"test log_linear_history ... ok\ntest log_with_merges ... ok\ntest log_format_oneline ... ok\n3 passed, 0 failed","is_error":false}]},"tool_use_result":{"stdout":"test log_linear_history ... ok\ntest log_with_merges ... ok\ntest log_format_oneline ... ok\n3 passed, 0 failed","stderr":""}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"text","text":"All 3 log tests pass. Implementation complete."}]}}'
        sleep 0.3
        echo '{"type":"result","subtype":"success","total_cost_usd":0.0082,"duration_ms":4200,"usage":{"input_tokens":1200,"output_tokens":340}}' ;;
    add-log/test)
        echo "test log_linear_history ... ok"
        sleep 0.2
        echo "test log_with_merges ... ok"
        sleep 0.2
        echo "test log_format_oneline ... ok"
        sleep 0.2
        echo "3 passed, 0 failed" ;;
    add-log/review)
        echo "Running clippy + fmt..."
        sleep 0.2
        echo "All checks passed." ;;

    # ── add-merge ─────────────────────────────────────
    add-merge/setup)
        echo "Fetching latest from add-branch and add-commit..."
        sleep 0.4
        echo "Ready." ;;
    add-merge/design)
        echo "Designing three-way merge algorithm..."
        sleep 0.3
        echo "  1. find_merge_base(a, b) → LCA in commit DAG"
        sleep 0.3
        echo "  2. three_way_diff(base, ours, theirs)"
        sleep 0.3
        echo "  3. apply_hunks() with conflict markers"
        sleep 0.3
        echo "Design approved." ;;
    add-merge/develop)
        echo "Writing src/merge.rs..."
        sleep 0.3
        echo "  + fn find_merge_base(a: Oid, b: Oid) -> Result<Oid>"
        sleep 0.3
        echo "  + fn three_way_merge(base: &Tree, ours: &Tree, theirs: &Tree) -> Result<Tree>"
        sleep 0.3
        echo "  + fn detect_conflicts(merged: &Tree) -> Vec<Conflict>"
        sleep 0.3
        echo "Build complete." ;;
    add-merge/test)
        echo "test merge_fast_forward ... ok"
        sleep 0.2
        echo "test merge_no_conflict ... ok"
        sleep 0.2
        echo "test merge_with_conflict ... ok"
        sleep 0.2
        echo "3 passed, 0 failed" ;;
    add-merge/review)
        echo "Running clippy + fmt..."
        sleep 0.2
        echo "All checks passed." ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # DEPLOY WORKFLOW
    # Steps: setup → build → scan → push → smoke-test
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # ── build-image ───────────────────────────────────
    build-image/setup)
        echo "Pulling base image rust:1.82-slim..."
        sleep 0.4
        echo "Ready." ;;
    build-image/build)
        echo "Writing Dockerfile..."
        sleep 0.3
        echo "  FROM rust:1.82-slim AS builder"
        sleep 0.2
        echo "  COPY . /app"
        sleep 0.2
        echo "  RUN cargo build --release"
        sleep 0.4
        echo "  FROM debian:bookworm-slim"
        sleep 0.2
        echo "  COPY --from=builder /app/target/release/minigit /usr/bin/"
        sleep 0.3
        echo "Building image minigit:latest..."
        sleep 0.5
        echo "Image built: minigit:latest (42MB)" ;;
    build-image/scan)
        echo "Running trivy scan on minigit:latest..."
        sleep 0.4
        echo "  LOW: 3  MEDIUM: 1  HIGH: 0  CRITICAL: 0"
        sleep 0.3
        echo "No critical vulnerabilities found." ;;
    build-image/push)
        echo "Tagging minigit:latest → ghcr.io/example/minigit:v0.1.0..."
        sleep 0.3
        echo "Pushing layer 1/4..."
        sleep 0.3
        echo "Pushing layer 2/4..."
        sleep 0.3
        echo "Pushing layer 3/4..."
        sleep 0.3
        echo "Pushing layer 4/4..."
        sleep 0.3
        echo "Push complete: ghcr.io/example/minigit:v0.1.0" ;;
    build-image/smoke-test)
        echo "Pulling ghcr.io/example/minigit:v0.1.0..."
        sleep 0.3
        echo "test container_starts ... ok"
        sleep 0.2
        echo "test cli_init ... ok"
        sleep 0.2
        echo "test cli_commit ... ok"
        sleep 0.2
        echo "3 passed, 0 failed" ;;

    # ── push-registry ─────────────────────────────────
    push-registry/setup)
        echo "Authenticating to registry mirror..."
        sleep 0.3
        echo "Ready." ;;
    push-registry/build)
        echo "Re-tagging for mirror: docker.io/example/minigit:v0.1.0..."
        sleep 0.3
        echo "Tag created." ;;
    push-registry/scan)
        echo "Running policy check..."
        sleep 0.3
        echo "Policy: PASS (signed, scanned, labeled)" ;;
    push-registry/push)
        echo "Pushing to docker.io mirror..."
        sleep 0.3
        echo "Pushing layer 1/2 (shared)..."
        sleep 0.3
        echo "Pushing layer 2/2..."
        sleep 0.3
        echo "Push complete: docker.io/example/minigit:v0.1.0" ;;
    push-registry/smoke-test)
        echo "Verifying remote image..."
        sleep 0.2
        echo "test pull_and_run ... ok"
        sleep 0.2
        echo "1 passed, 0 failed" ;;

    # ── deploy-k8s (verify-smoke-test fails first → retry) ─
    deploy-k8s/setup)
        echo "Connecting to cluster staging-west..."
        sleep 0.3
        echo "Context set: staging-west" ;;
    deploy-k8s/build)
        echo "Rendering Helm chart values..."
        sleep 0.3
        echo "  image: ghcr.io/example/minigit:v0.1.0"
        sleep 0.2
        echo "  replicas: 2"
        sleep 0.2
        echo "  resources: 256Mi / 0.5 CPU"
        sleep 0.2
        echo "Chart rendered." ;;
    deploy-k8s/scan)
        echo "Running kubesec scan on manifests..."
        sleep 0.3
        echo "  Score: 8/10 (runAsNonRoot, readOnlyFs)"
        sleep 0.2
        echo "Scan passed." ;;
    deploy-k8s/push)
        echo "helm upgrade --install minigit ./chart --namespace minigit..."
        sleep 0.4
        echo "Waiting for rollout..."
        sleep 0.5
        echo "deployment.apps/minigit successfully rolled out (2/2 ready)" ;;
    deploy-k8s/smoke-test)
        echo "Running smoke tests against staging..."
        sleep 0.3
        echo "test health_endpoint ... ok"
        sleep 0.2
        echo "test init_via_api ... ok"
        sleep 0.2
        echo "test commit_via_api ... ok"
        sleep 0.2
        echo "3 passed, 0 failed" ;;
    deploy-k8s/verify-smoke-test)
        if [ "${PAWL_RETRY_COUNT:-0}" = "0" ]; then
            echo "error: health endpoint returned 503 (pods still starting)" >&2
            echo "  GET /health → 503 Service Unavailable" >&2
            exit 1
        fi
        echo "health check passed" >&2
        exit 0 ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # DOCS WORKFLOW
    # Steps: setup → generate → lint → publish
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # ── api-docs (Claude agent) ───────────────────────
    api-docs/setup)
        echo "Installing rustdoc toolchain..."
        sleep 0.3
        echo "Ready." ;;
    api-docs/generate)
        echo '{"type":"system","subtype":"init","model":"claude-haiku-4-5-20251001","tools":["Bash","Read","Edit","Glob","Grep"],"session_id":"api-docs"}'
        sleep 0.3
        echo '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"I need to generate API documentation. Let me scan the public API surface, then write doc comments for each module and function."}]}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_10","name":"Glob","input":{"pattern":"src/**/*.rs"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_10","content":"src/init.rs\nsrc/repo.rs\nsrc/commit.rs\nsrc/branch.rs\nsrc/log.rs\nsrc/merge.rs","is_error":false}]},"tool_use_result":{"stdout":"src/init.rs\nsrc/repo.rs\nsrc/commit.rs\nsrc/branch.rs\nsrc/log.rs\nsrc/merge.rs","stderr":""}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_11","name":"Edit","input":{"file_path":"src/init.rs"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_11","content":"","is_error":false}]},"tool_use_result":{"stdout":"","stderr":""}}'
        sleep 0.3
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_12","name":"Edit","input":{"file_path":"src/commit.rs"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_12","content":"","is_error":false}]},"tool_use_result":{"stdout":"","stderr":""}}'
        sleep 0.3
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_13","name":"Bash","input":{"command":"cargo doc --no-deps 2>&1 | tail -5"}}]}}'
        sleep 0.3
        echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_13","content":"Documenting minigit v0.1.0\n   Finished `dev` profile target(s) in 2.1s\n   Generated target/doc/minigit/index.html","is_error":false}]},"tool_use_result":{"stdout":"Documenting minigit v0.1.0\nGenerated target/doc/minigit/index.html","stderr":""}}'
        sleep 0.4
        echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Added doc comments to all 6 modules and generated API docs at target/doc/."}]}}'
        sleep 0.2
        echo '{"type":"result","subtype":"success","total_cost_usd":0.0045,"duration_ms":3200,"usage":{"input_tokens":900,"output_tokens":280}}' ;;
    api-docs/lint)
        echo "Running doc lint..."
        sleep 0.3
        echo "  Checking for missing examples..."
        sleep 0.2
        echo "  Checking for broken links..."
        sleep 0.2
        echo "All doc lints passed." ;;
    api-docs/publish)
        echo "Deploying to GitHub Pages..."
        sleep 0.3
        echo "  Uploading 24 HTML files..."
        sleep 0.3
        echo "Published: https://example.github.io/minigit/docs/" ;;

    # ── changelog ─────────────────────────────────────
    changelog/setup)
        echo "Scanning git history..."
        sleep 0.3
        echo "Found 12 commits since v0.0.1." ;;
    changelog/generate)
        echo "Generating CHANGELOG.md..."
        sleep 0.3
        echo "  ## [0.1.0] - 2026-02-22"
        sleep 0.2
        echo "  ### Added"
        sleep 0.1
        echo "  - git init with .gitignore support"
        sleep 0.1
        echo "  - git commit with message validation"
        sleep 0.1
        echo "  - git branch create/delete/list"
        sleep 0.1
        echo "  - git log with format options"
        sleep 0.1
        echo "  - git merge with conflict detection"
        sleep 0.2
        echo "CHANGELOG.md written." ;;
    changelog/lint)
        echo "Validating changelog format..."
        sleep 0.2
        echo "Format: Keep a Changelog v1.1.0 ✓" ;;
    changelog/publish)
        echo "Creating GitHub release v0.1.0..."
        sleep 0.3
        echo "Release published: https://github.com/example/minigit/releases/tag/v0.1.0" ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # INFRA WORKFLOW
    # Steps: setup → provision → configure → validate → notify
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # ── setup-ci ──────────────────────────────────────
    setup-ci/setup)
        echo "Checking GitHub Actions quota..."
        sleep 0.3
        echo "Quota OK: 1842/2000 minutes remaining." ;;
    setup-ci/provision)
        echo "Writing .github/workflows/ci.yml..."
        sleep 0.3
        echo "  jobs: [lint, test, build, docker]"
        sleep 0.3
        echo "  matrix: [stable, nightly] x [ubuntu, macos]"
        sleep 0.3
        echo "Workflow created." ;;
    setup-ci/configure)
        echo "Setting repository secrets..."
        sleep 0.3
        echo "  GHCR_TOKEN ... set"
        sleep 0.2
        echo "  DOCKER_TOKEN ... set"
        sleep 0.2
        echo "  SIGNING_KEY ... set"
        sleep 0.2
        echo "Secrets configured." ;;
    setup-ci/validate)
        echo "Triggering dry-run workflow..."
        sleep 0.4
        echo "  lint ............ ✓ (12s)"
        sleep 0.3
        echo "  test-stable ..... ✓ (45s)"
        sleep 0.3
        echo "  test-nightly .... ✓ (48s)"
        sleep 0.3
        echo "  build ........... ✓ (62s)"
        sleep 0.3
        echo "  docker .......... ✓ (38s)"
        sleep 0.2
        echo "All CI jobs passed." ;;
    setup-ci/notify)
        echo "Sending Slack notification..."
        sleep 0.2
        echo "  #engineering: CI pipeline ready for minigit" ;;

    # ── setup-monitoring (verify-validate fails → waiting) ─
    setup-monitoring/setup)
        echo "Connecting to Grafana Cloud..."
        sleep 0.3
        echo "Connected." ;;
    setup-monitoring/provision)
        echo "Creating dashboard: minigit-overview..."
        sleep 0.3
        echo "  Panel: Request Rate (prometheus)"
        sleep 0.2
        echo "  Panel: Error Rate (prometheus)"
        sleep 0.2
        echo "  Panel: P99 Latency (prometheus)"
        sleep 0.2
        echo "  Panel: Memory Usage (prometheus)"
        sleep 0.2
        echo "Dashboard created: id=42" ;;
    setup-monitoring/configure)
        echo "Setting up alerts..."
        sleep 0.3
        echo "  Alert: error_rate > 5% for 5m → PagerDuty"
        sleep 0.2
        echo "  Alert: p99_latency > 500ms for 10m → Slack"
        sleep 0.2
        echo "  Alert: memory > 80% for 15m → Slack"
        sleep 0.2
        echo "3 alert rules configured." ;;
    setup-monitoring/validate)
        echo "Sending test metrics..."
        sleep 0.3
        echo "Verifying dashboard renders..."
        sleep 0.3
        echo "Panels loaded successfully."
        sleep 0.2 ;;
    setup-monitoring/verify-validate)
        echo "error: alert test failed — PagerDuty integration returned 401" >&2
        echo "  Check PAGERDUTY_API_KEY secret" >&2
        exit 1 ;;
    setup-monitoring/notify)
        echo "Sending Slack notification..."
        sleep 0.2
        echo "  #engineering: Monitoring configured for minigit" ;;

    *) exit 0 ;;
esac
SIMEOF
chmod +x .pawl/sim.sh

# ── Workflow configs ──────────────────────────────────

cat > .pawl/workflows/default.json <<'EOF'
{
  "viewport": "none",
  "workflow": [
    { "name": "setup",   "run": ".pawl/sim.sh setup" },
    { "name": "design",  "run": ".pawl/sim.sh design" },
    { "name": "develop", "run": ".pawl/sim.sh develop",
      "verify": ".pawl/sim.sh verify-develop",
      "on_fail": "retry", "max_retries": 3 },
    { "name": "test",    "run": ".pawl/sim.sh test",
      "verify": ".pawl/sim.sh verify-test",
      "on_fail": "manual" },
    { "name": "review",  "run": ".pawl/sim.sh review" }
  ],
  "tasks": {
    "init-repo":  { "description": "Initialize git repository" },
    "add-commit": { "description": "Implement git commit",  "depends": ["init-repo"] },
    "add-branch": { "description": "Implement git branch",  "depends": ["init-repo"] },
    "add-log":    { "description": "Implement git log",     "depends": ["init-repo"] },
    "add-merge":  { "description": "Implement git merge",   "depends": ["add-branch", "add-commit"] }
  }
}
EOF

cat > .pawl/workflows/deploy.json <<'EOF'
{
  "viewport": "none",
  "workflow": [
    { "name": "setup",      "run": ".pawl/sim.sh setup" },
    { "name": "build",      "run": ".pawl/sim.sh build" },
    { "name": "scan",       "run": ".pawl/sim.sh scan" },
    { "name": "push",       "run": ".pawl/sim.sh push" },
    { "name": "smoke-test", "run": ".pawl/sim.sh smoke-test",
      "verify": ".pawl/sim.sh verify-smoke-test",
      "on_fail": "retry", "max_retries": 2 }
  ],
  "tasks": {
    "build-image":   { "description": "Build & push Docker image" },
    "push-registry": { "description": "Mirror to Docker Hub",     "depends": ["build-image"] },
    "deploy-k8s":    { "description": "Deploy to staging cluster", "depends": ["push-registry"] }
  }
}
EOF

cat > .pawl/workflows/docs.json <<'EOF'
{
  "viewport": "none",
  "workflow": [
    { "name": "setup",    "run": ".pawl/sim.sh setup" },
    { "name": "generate", "run": ".pawl/sim.sh generate" },
    { "name": "lint",     "run": ".pawl/sim.sh lint" },
    { "name": "publish",  "run": ".pawl/sim.sh publish" }
  ],
  "tasks": {
    "api-docs":  { "description": "Generate API documentation" },
    "changelog": { "description": "Generate changelog & release" }
  }
}
EOF

cat > .pawl/workflows/infra.json <<'EOF'
{
  "viewport": "none",
  "workflow": [
    { "name": "setup",     "run": ".pawl/sim.sh setup" },
    { "name": "provision", "run": ".pawl/sim.sh provision" },
    { "name": "configure", "run": ".pawl/sim.sh configure" },
    { "name": "validate",  "run": ".pawl/sim.sh validate",
      "verify": ".pawl/sim.sh verify-validate",
      "on_fail": "manual" },
    { "name": "notify",    "run": ".pawl/sim.sh notify" }
  ],
  "tasks": {
    "setup-ci":         { "description": "Configure CI pipeline" },
    "setup-monitoring": { "description": "Configure monitoring & alerts", "depends": ["setup-ci"] }
  }
}
EOF

echo -e "  ${DIM}workflow default (5 steps): setup → design → develop → test → review${NC}"
echo -e "  ${DIM}  tasks: init-repo → {add-commit, add-branch, add-log} → add-merge${NC}"
echo -e "  ${DIM}workflow deploy (5 steps): setup → build → scan → push → smoke-test${NC}"
echo -e "  ${DIM}  tasks: build-image → push-registry → deploy-k8s${NC}"
echo -e "  ${DIM}workflow docs (4 steps): setup → generate → lint → publish${NC}"
echo -e "  ${DIM}  tasks: api-docs, changelog${NC}"
echo -e "  ${DIM}workflow infra (5 steps): setup → provision → configure → validate → notify${NC}"
echo -e "  ${DIM}  tasks: setup-ci → setup-monitoring${NC}"

# ── Launch dashboard ──────────────────────────────────
banner "Dashboard"
if [ -f "$UI" ]; then
    pawl serve --port "$PORT" --ui "$UI" >/dev/null 2>&1 &
else
    pawl serve --port "$PORT" >/dev/null 2>&1 &
fi
SERVE_PID=$!
sleep 0.5

if curl -s "http://localhost:${PORT}/api/status" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} http://localhost:${PORT}"
    open "http://localhost:${PORT}" 2>/dev/null || true
else
    echo "  Failed to start server"
    exit 1
fi

echo -e "  ${DIM}Watch the dashboard as 12 tasks flow through 4 workflows${NC}"
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 1: Foundation — init-repo (blocking)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Phase 1 — Foundation"
echo -e "  ${DIM}pawl start init-repo${NC}"
pawl start init-repo >/dev/null 2>&1
echo -e "  ${GREEN}✓${NC} init-repo completed (5 steps)"
show_tasks
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 2: Parallel burst — 3 default + 2 docs + 1 infra
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Phase 2 — Parallel Burst (6 tasks)"
echo -e "  ${DIM}Launching across 3 workflows simultaneously...${NC}"
echo -e "  ${DIM}  default: add-commit(retry), add-branch(waiting), add-log(claude)${NC}"
echo -e "  ${DIM}  docs:    api-docs(claude), changelog(fast)${NC}"
echo -e "  ${DIM}  infra:   setup-ci${NC}"

pawl start add-commit >/dev/null 2>&1 &
P1=$!
pawl start add-branch >/dev/null 2>&1 &
P2=$!
pawl start add-log >/dev/null 2>&1 &
P3=$!
pawl start api-docs >/dev/null 2>&1 &
P4=$!
pawl start changelog >/dev/null 2>&1 &
P5=$!
pawl start setup-ci >/dev/null 2>&1 &
P6=$!

wait_pids $P1 $P2 $P3 $P4 $P5 $P6

echo ""
echo -e "  ${DIM}── settled ──${NC}"
show_tasks
echo ""
echo -e "  ${GREEN}✓${NC} add-commit: verify failed → auto-retry → passed"
echo -e "  ${YELLOW}⚠${NC} add-branch: clippy error → waiting for manual intervention"
echo -e "  ${GREEN}✓${NC} add-log: Claude agent completed"
echo -e "  ${GREEN}✓${NC} api-docs: Claude agent completed"
echo -e "  ${GREEN}✓${NC} changelog: completed"
echo -e "  ${GREEN}✓${NC} setup-ci: completed"
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 3: Manual intervention + infra continuation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Phase 3 — Manual Intervention + Infra"
echo -e "  ${DIM}add-branch is waiting: clippy found unused import${NC}"
echo -e "  ${DIM}Meanwhile, starting setup-monitoring (depends on setup-ci ✓)${NC}"
sleep 1

pawl start setup-monitoring >/dev/null 2>&1 &
P_MON=$!

sleep 2
echo -e "  ${DIM}Operator reviews add-branch and accepts...${NC}"
echo -e "  ${DIM}pawl done add-branch${NC}"
pawl done add-branch >/dev/null 2>&1
echo -e "  ${GREEN}✓${NC} add-branch accepted → completed"

wait $P_MON 2>/dev/null || true
show_tasks
echo ""
echo -e "  ${YELLOW}⚠${NC} setup-monitoring: PagerDuty 401 → waiting for manual fix"
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 4: Dependency unlock — add-merge + deploy chain
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Phase 4 — Dependency Unlock + Deploy"
echo -e "  ${DIM}add-merge unblocked: add-branch ✓ + add-commit ✓${NC}"
echo -e "  ${DIM}Starting deploy workflow in parallel...${NC}"

pawl start add-merge >/dev/null 2>&1 &
P_MERGE=$!
pawl start build-image >/dev/null 2>&1 &
P_BUILD=$!

wait_pids $P_MERGE $P_BUILD

echo -e "  ${GREEN}✓${NC} add-merge completed"
echo -e "  ${GREEN}✓${NC} build-image completed"

echo -e "  ${DIM}Continuing deploy chain...${NC}"
pawl start push-registry >/dev/null 2>&1
echo -e "  ${GREEN}✓${NC} push-registry completed"

pawl start deploy-k8s >/dev/null 2>&1 &
P_K8S=$!

wait_pids $P_K8S
echo -e "  ${GREEN}✓${NC} deploy-k8s: health check failed → auto-retry → passed"
show_tasks
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 5: Final cleanup — accept monitoring
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Phase 5 — Final Resolution"
echo -e "  ${DIM}Operator fixes PagerDuty API key and accepts...${NC}"
sleep 1
echo -e "  ${DIM}pawl done setup-monitoring${NC}"
pawl done setup-monitoring >/dev/null 2>&1
echo -e "  ${GREEN}✓${NC} setup-monitoring accepted → completed"
show_tasks
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Complete"
show_tasks
echo ""
echo -e "  ${GREEN}${BOLD}All 12 tasks completed across 4 workflows!${NC}"
echo ""
echo -e "  ${DIM}default (5):  init-repo, add-commit(retry), add-branch(manual), add-log(claude), add-merge(deps)${NC}"
echo -e "  ${DIM}deploy  (3):  build-image, push-registry, deploy-k8s(retry)${NC}"
echo -e "  ${DIM}docs    (2):  api-docs(claude), changelog${NC}"
echo -e "  ${DIM}infra   (2):  setup-ci, setup-monitoring(manual)${NC}"
echo ""
echo -e "  ${DIM}Demonstrated: 4 workflow tabs, 4-5 step progress grids, auto-retry,${NC}"
echo -e "  ${DIM}  manual intervention, dependency DAG, Claude stream-json, parallel execution${NC}"
echo -e "  ${DIM}Dashboard: http://localhost:${PORT}${NC}"
echo ""
echo -e "  ${DIM}Press Enter to stop...${NC}"
read -r
echo "Done."
