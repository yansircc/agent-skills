PREFIX ?= $(HOME)/.local
BIN ?= $(PREFIX)/bin/effect-skill-scan
CODEX_SKILLS_DIR ?= $(HOME)/.codex/skills
SKILL_NAME ?= effect-ecosystem
BUILD_DIR ?= dist

.PHONY: build install skill verify

build:
	rm -rf "$(BUILD_DIR)"
	./node_modules/.bin/tsc -p tsconfig.json
	mkdir -p "$(BUILD_DIR)/validator/fixtures" "$(BUILD_DIR)/references"
	cp validator/rules.jsonl validator/manifest.schema.json "$(BUILD_DIR)/validator/"
	cp validator/fixtures/fixtures.config.json "$(BUILD_DIR)/validator/fixtures/"
	cp references/scanner-manifest.md "$(BUILD_DIR)/references/"
	chmod +x "$(BUILD_DIR)/validator/scan.js"

install: build
	mkdir -p "$(dir $(BIN))"
	ln -sfn "$(CURDIR)/$(BUILD_DIR)/validator/scan.js" "$(BIN)"

skill:
	mkdir -p "$(CODEX_SKILLS_DIR)"
	ln -sfn "$(CURDIR)" "$(CODEX_SKILLS_DIR)/$(SKILL_NAME)"

verify: build
	node "$(BUILD_DIR)/scripts/check-registry.js"
	node "$(BUILD_DIR)/scripts/generate-derived-docs.js" --check
	node "$(BUILD_DIR)/scripts/check-skill-thin.js"
	node "$(BUILD_DIR)/scripts/check-profile-routing.js"
	node "$(BUILD_DIR)/scripts/typecheck-snippets.js"
	node "$(BUILD_DIR)/validator/scan.js" --self-test --exact
	node "$(BUILD_DIR)/validator/scan.js" --self-test --contract
	node "$(BUILD_DIR)/validator/scan.js" . --strict --json --profile >/tmp/effect-skill-verify-profile.json
