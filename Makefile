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
	@printf "\n$(B)$(G)✓ Ready!$(N) Run $(C)make dev$(N) to start web + engine.\n\n"

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

.PHONY: dev dev/web dev/engine dev/check-engine-port dev/down
dev: ## Start web + engine API in parallel (auto-picks a free web port). Daemon: make daemon/start | make daemon/down.
	@printf "$(B)$(G)Starting dev servers...$(N)\n"
	@$(MAKE) dev/check-engine-port
	@$(MAKE) -j2 dev/web dev/engine

dev/check-engine-port:
	@if lsof -nP -iTCP:$(ENGINE_PORT) -sTCP:LISTEN >/tmp/agentik-engine-port.$$$$ 2>/dev/null; then \
		printf "$(R)✗ Engine port $(ENGINE_PORT) is already in use.$(N)\n"; \
		cat /tmp/agentik-engine-port.$$$$; \
		rm -f /tmp/agentik-engine-port.$$$$; \
		printf "$(Y)Stop the existing process, or run: make dev ENGINE_PORT=8788 API_URL=http://localhost:8788$(N)\n"; \
		exit 1; \
	fi; \
	rm -f /tmp/agentik-engine-port.$$$$

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

dev/engine: dev/check-engine-port ## Start workflow engine API (:8787)
	@printf "$(C)→ Engine API on http://localhost:$(ENGINE_PORT)$(N)\n"
	@cd $(ENGINE) && bun run dev

dev/down: ## Stop local web/engine dev processes for this checkout
	@pids="$$(lsof -tiTCP:$(ENGINE_PORT) -sTCP:LISTEN 2>/dev/null || true)"; \
	if [ -n "$$pids" ]; then kill $$pids 2>/dev/null || true; fi
	@pkill -f "cd apps/engine && [b]un run dev" 2>/dev/null || true
	@pkill -f "[b]un run --watch src/main.ts" 2>/dev/null || true
	@pkill -f "$(abspath $(WEB))/node_modules/.bin/[n]ext dev" 2>/dev/null || true
	@printf "$(G)✓ stopped local dev processes for this checkout$(N)\n"

# ── Agent daemon ─────────────────────────────────────────────────────────────
# Two entry points:
#   make daemon/start   rebuild + launch (personal daemon, all your orgs)
#   make daemon/down    stop + cleanup

DAEMON_BIN := bin/agentik
DAEMON_RUNTIMES ?= echo,claude,hermes
DAEMON_MAX_CONCURRENCY ?= 2

.PHONY: daemon/start daemon/personal daemon/down

daemon/start: daemon/personal ## Alias for daemon/personal

daemon/personal: build/daemon ## Rebuild and start the personal daemon (DAEMON_USER_TOKEN from Settings > Connections)
	@if [ -z "$(DAEMON_USER_TOKEN)" ]; then \
		printf "$(R)✗ DAEMON_USER_TOKEN=… required — copy from Settings > Connections$(N)\n"; exit 1; fi
	@./$(DAEMON_BIN) daemon stop >/dev/null 2>&1 || true
	@./$(DAEMON_BIN) daemon start --background --url $(API_URL) --token "$(DAEMON_USER_TOKEN)" --runtimes "$(DAEMON_RUNTIMES)"

daemon/down: ## Stop the daemon and remove its pid file
	@./$(DAEMON_BIN) daemon stop

# ── CLI install (symlink bin/agentik into your PATH) ─────────────────────────
# Override the target dir with: make cli/install INSTALL_DIR=/somewhere/in/PATH
INSTALL_DIR ?= $(HOME)/.local/bin
CLI_LINK := $(INSTALL_DIR)/agentik

.PHONY: cli/install cli/uninstall

cli/install: build/daemon ## Symlink the agentik CLI into ~/.local/bin (override INSTALL_DIR=…)
	@mkdir -p "$(INSTALL_DIR)"
	@ln -sf "$(abspath $(DAEMON_BIN))" "$(CLI_LINK)"
	@printf "$(G)✓ linked$(N) $(CLI_LINK) → $(abspath $(DAEMON_BIN))\n"
	@case ":$$PATH:" in \
		*":$(INSTALL_DIR):"*) printf "  Run $(C)hash -r$(N) (or open a new shell), then $(C)agentik doctor$(N)\n" ;; \
		*) printf "$(Y)• %s is not on your PATH$(N) — add it to your shell rc to use $(C)agentik$(N) directly\n" "$(INSTALL_DIR)" ;; \
	esac

cli/uninstall: ## Remove the agentik CLI symlink from ~/.local/bin (leaves real binaries untouched)
	@if [ -L "$(CLI_LINK)" ]; then \
		rm -f "$(CLI_LINK)"; printf "$(G)✓ removed$(N) $(CLI_LINK)\n"; \
	elif [ -e "$(CLI_LINK)" ]; then \
		printf "$(Y)• $(CLI_LINK) is a real file, not our symlink — left untouched$(N)\n"; \
	else \
		printf "$(Y)• nothing to remove at $(CLI_LINK)$(N)\n"; \
	fi

# ── Build ────────────────────────────────────────────────────────────────────

.PHONY: build build/web build/daemon
build: build/web build/daemon ## Build all apps

build/web: ## Build Next.js for production
	@printf "$(C)→ Building web...$(N)\n"
	@cd $(WEB) && bun run build
	@printf "$(G)✓ Web build complete$(N)\n"

build/daemon: ## Build the Go Agentik CLI/daemon static binary → bin/agentik
	@printf "$(C)→ Building daemon...$(N)\n"
	@cd $(DAEMON) && CGO_ENABLED=0 go build -o ../../bin/agentik .
	@printf "$(G)✓ Daemon build complete (bin/agentik)$(N)\n"

# ── Test ─────────────────────────────────────────────────────────────────────

.PHONY: test test/web test/engine
test: test/web test/engine ## Run all tests

test/web: ## Run frontend tests (vitest)
	@printf "$(C)→ Running web tests...$(N)\n"
	@cd $(WEB) && bun run test

test/engine: ## Run engine + package tests (bun test)
	@printf "$(C)→ Running engine tests...$(N)\n"
	@cd $(ENGINE) && bun test

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
