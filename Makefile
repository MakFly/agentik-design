# ── Agentik Monorepo ─────────────────────────────────────────────────────────
.DEFAULT_GOAL := help

# Colors
C := \033[36m
G := \033[32m
Y := \033[33m
R := \033[31m
B := \033[1m
N := \033[0m

WEB := apps/web
ENGINE := apps/engine
DAEMON := apps/daemon

# Web dev port: override with `make dev WEB_PORT=4000`. If unset, the first free
# port among the list below is picked at runtime (the machine often has :3000
# busy with another project).
WEB_PORT ?=
WEB_PORT_CANDIDATES := 3333 3344 3355 3399 4000 4123
ENGINE_PORT ?= 8787
API_URL ?= http://localhost:$(ENGINE_PORT)

# ── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show available commands
	@printf "\n$(B)$(C)  Agentik Monorepo$(N)\n\n"
	@grep -E '^[a-zA-Z_/-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(C)%-20s$(N) %s\n", $$1, $$2}'
	@printf "\n"

# ── Install ──────────────────────────────────────────────────────────────────

.PHONY: install env
install: ## One-shot dev setup: deps + env files + database + migrations
	@printf "$(C)→ Installing workspace dependencies...$(N)\n"
	@bun install
	@$(MAKE) env
	@$(MAKE) db/create
	@$(MAKE) db/migrate
	@printf "\n$(B)$(G)✓ Ready!$(N) Run $(C)make dev$(N) to start web + engine + worker.\n\n"

env: ## Seed local env files from examples (never overwrites an existing one)
	@if [ ! -f $(ENGINE)/.env ]; then \
		cp $(ENGINE)/.env.example $(ENGINE)/.env; \
		printf "$(G)✓ created $(ENGINE)/.env$(N) (from .env.example)\n"; \
	else printf "$(Y)• $(ENGINE)/.env exists, skipped$(N)\n"; fi
	@if [ ! -f $(WEB)/.env.local ]; then \
		cp $(WEB)/.env.example $(WEB)/.env.local; \
		printf "$(G)✓ created $(WEB)/.env.local$(N) (from .env.example)\n"; \
	else printf "$(Y)• $(WEB)/.env.local exists, skipped$(N)\n"; fi

# ── Development ──────────────────────────────────────────────────────────────

.PHONY: dev dev/web dev/engine dev/worker
dev: ## Start web + engine API + worker in parallel (auto-picks a free web port). The agent daemon is NOT started here — manage it with `make daemon/start`.
	@printf "$(B)$(G)Starting dev servers...$(N)\n"
	@$(MAKE) -j3 dev/web dev/engine dev/worker

dev/web: ## Start Next.js dev server (free port, override: make dev/web WEB_PORT=4000)
	@PORT="$(WEB_PORT)"; \
	if [ -z "$$PORT" ]; then \
		for p in $(WEB_PORT_CANDIDATES); do \
			if ! (ss -ltn 2>/dev/null | grep -q ":$$p "); then PORT=$$p; break; fi; \
		done; \
	fi; \
	if [ -z "$$PORT" ]; then printf "$(R)No free web port found in: $(WEB_PORT_CANDIDATES)$(N)\n"; exit 1; fi; \
	printf "$(C)→ Next.js on http://localhost:$$PORT  (API → $(API_URL))$(N)\n"; \
	cd $(WEB) && PORT=$$PORT API_URL=$(API_URL) NEXT_PUBLIC_ENGINE_URL=$(API_URL) bun run dev

dev/engine: ## Start workflow engine API (:8787)
	@printf "$(C)→ Engine API on http://localhost:$(ENGINE_PORT)$(N)\n"
	@cd $(ENGINE) && bun run dev

dev/worker: ## Start the BullMQ run worker
	@printf "$(C)→ Run worker$(N)\n"
	@cd $(ENGINE) && bun run worker:dev

# ── Agent daemon (manual lifecycle — NOT auto-started, NOT restarted on reboot) ─
# The daemon spawns agent CLIs, so it is opt-in: start it when you want agents to
# run, stop it otherwise. After a reboot, start it again with `make daemon/start`.

DAEMON_PID := /tmp/agentik-daemon.pid
DAEMON_LOG := /tmp/agentik-daemon.log
DAEMON_BIN := bin/agentik-daemon
DAEMON_TEAM ?= acme
DAEMON_RUNTIMES ?= echo

.PHONY: daemon daemon/start daemon/stop daemon/restart daemon/status daemon/logs daemon/foreground

daemon: daemon/status ## Alias for daemon/status

daemon/start: build/daemon ## Start the agent daemon detached (re-run manually after a reboot)
	@if [ -f $(DAEMON_PID) ] && kill -0 $$(cat $(DAEMON_PID)) 2>/dev/null; then \
		printf "$(Y)daemon already running (pid $$(cat $(DAEMON_PID)))$(N)\n"; exit 0; fi
	@TOKEN=$$(grep -E '^DAEMON_AUTH_TOKEN=' $(ENGINE)/.env 2>/dev/null | cut -d= -f2-); \
	if [ -z "$$TOKEN" ]; then \
		printf "$(R)✗ Set DAEMON_AUTH_TOKEN + DAEMON_ENABLED=true in $(ENGINE)/.env first$(N)\n"; exit 1; fi; \
	ENGINE_URL=$(API_URL) TEAM=$(DAEMON_TEAM) RUNTIME_KINDS=$(DAEMON_RUNTIMES) DAEMON_AUTH_TOKEN=$$TOKEN \
		nohup ./$(DAEMON_BIN) > $(DAEMON_LOG) 2>&1 & echo $$! > $(DAEMON_PID); \
	sleep 1; \
	if kill -0 $$(cat $(DAEMON_PID)) 2>/dev/null; then \
		printf "$(G)✓ daemon started (pid $$(cat $(DAEMON_PID)), runtimes=$(DAEMON_RUNTIMES)) → make daemon/logs$(N)\n"; \
	else printf "$(R)✗ daemon failed to start — see $(DAEMON_LOG)$(N)\n"; tail -3 $(DAEMON_LOG); rm -f $(DAEMON_PID); exit 1; fi

daemon/stop: ## Stop the agent daemon
	@if [ -f $(DAEMON_PID) ] && kill -0 $$(cat $(DAEMON_PID)) 2>/dev/null; then \
		kill $$(cat $(DAEMON_PID)) 2>/dev/null; rm -f $(DAEMON_PID); printf "$(G)✓ daemon stopped$(N)\n"; \
	elif pkill -f $(DAEMON_BIN) 2>/dev/null; then rm -f $(DAEMON_PID); printf "$(G)✓ daemon stopped (by name)$(N)\n"; \
	else rm -f $(DAEMON_PID); printf "$(Y)daemon not running$(N)\n"; fi

daemon/restart: ## Restart the agent daemon
	@$(MAKE) daemon/stop; sleep 1; $(MAKE) daemon/start

daemon/status: ## Show whether the daemon is running
	@if [ -f $(DAEMON_PID) ] && kill -0 $$(cat $(DAEMON_PID)) 2>/dev/null; then \
		printf "$(G)● daemon running$(N) (pid $$(cat $(DAEMON_PID)), engine $(API_URL))\n"; \
	else printf "$(R)○ daemon stopped$(N) — start with: make daemon/start\n"; fi

daemon/logs: ## Tail the daemon log
	@tail -f $(DAEMON_LOG)

daemon/foreground: build/daemon ## Run the daemon in the foreground (Ctrl-C to stop)
	@TOKEN=$$(grep -E '^DAEMON_AUTH_TOKEN=' $(ENGINE)/.env 2>/dev/null | cut -d= -f2-); \
	if [ -z "$$TOKEN" ]; then printf "$(R)✗ Set DAEMON_AUTH_TOKEN + DAEMON_ENABLED=true in $(ENGINE)/.env first$(N)\n"; exit 1; fi; \
	ENGINE_URL=$(API_URL) TEAM=$(DAEMON_TEAM) RUNTIME_KINDS=$(DAEMON_RUNTIMES) DAEMON_AUTH_TOKEN=$$TOKEN ./$(DAEMON_BIN)

# ── Build ────────────────────────────────────────────────────────────────────

.PHONY: build build/web build/daemon
build: build/web build/daemon ## Build all apps

build/web: ## Build Next.js for production
	@printf "$(C)→ Building web...$(N)\n"
	@cd $(WEB) && bun run build
	@printf "$(G)✓ Web build complete$(N)\n"

build/daemon: ## Build the Go agent daemon static binary → bin/agentik-daemon
	@printf "$(C)→ Building daemon...$(N)\n"
	@cd $(DAEMON) && CGO_ENABLED=0 go build -o ../../bin/agentik-daemon .
	@printf "$(G)✓ Daemon build complete (bin/agentik-daemon)$(N)\n"

# ── Test ─────────────────────────────────────────────────────────────────────

.PHONY: test test/web test/engine test/e2e
test: test/web test/engine ## Run all tests

test/web: ## Run frontend tests (vitest)
	@printf "$(C)→ Running web tests...$(N)\n"
	@cd $(WEB) && bun run test

test/engine: ## Run engine + package tests (bun test)
	@printf "$(C)→ Running engine tests...$(N)\n"
	@cd packages/workflow-engine && bun test

test/e2e: ## Run e2e tests (Playwright)
	@printf "$(C)→ Running e2e tests...$(N)\n"
	@cd $(WEB) && bun run test:e2e

# ── Lint & Type-check ─────────────────────────────────────────────────────────

.PHONY: lint typecheck format
lint: ## Lint frontend (eslint)
	@printf "$(C)→ Linting web...$(N)\n"
	@cd $(WEB) && bun run lint

typecheck: ## TypeScript type-check (web + engine)
	@printf "$(C)→ Type-checking...$(N)\n"
	@cd $(WEB) && bun run typecheck
	@cd $(ENGINE) && bun run typecheck

format: ## Format code (prettier)
	@printf "$(C)→ Formatting...$(N)\n"
	@cd $(WEB) && bun run format

# ── Database (Drizzle, apps/engine) ──────────────────────────────────────────

.PHONY: db/create db/generate db/migrate db/push
db/create: ## Create the PostgreSQL database on shared infra
	@printf "$(C)→ Creating database...$(N)\n"
	@docker exec infra-postgres psql -U test -d devhub -c "CREATE DATABASE agentik;" 2>/dev/null || true
	@printf "$(G)✓ Database ready$(N)\n"

db/generate: ## Generate a new SQL migration from the schema
	@cd $(ENGINE) && bun run db:generate

db/migrate: ## Apply pending migrations
	@printf "$(C)→ Running migrations...$(N)\n"
	@cd $(ENGINE) && bun run db:migrate
	@printf "$(G)✓ Migrations complete$(N)\n"

db/push: ## Push schema directly (dev only)
	@cd $(ENGINE) && bun run db:push

# ── Utilities ────────────────────────────────────────────────────────────────

.PHONY: clean setup
clean: ## Remove build artifacts and dependencies
	@printf "$(Y)→ Cleaning...$(N)\n"
	@rm -rf $(WEB)/node_modules $(WEB)/.next node_modules
	@printf "$(G)✓ Clean$(N)\n"

setup: install ## Alias for `make install` (first-time project setup)
