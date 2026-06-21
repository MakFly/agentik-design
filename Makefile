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

.PHONY: install
install: ## Install all workspace dependencies (bun)
	@printf "$(C)→ Installing workspace dependencies...$(N)\n"
	@bun install
	@printf "$(G)✓ All dependencies installed$(N)\n"

# ── Development ──────────────────────────────────────────────────────────────

.PHONY: dev dev/web dev/engine dev/worker
dev: ## Start web + engine API + run worker in parallel (auto-picks a free web port)
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
	cd $(WEB) && PORT=$$PORT API_URL=$(API_URL) bun run dev

dev/engine: ## Start workflow engine API (:8787)
	@printf "$(C)→ Engine API on http://localhost:$(ENGINE_PORT)$(N)\n"
	@cd $(ENGINE) && bun run dev

dev/worker: ## Start the BullMQ run worker
	@printf "$(C)→ Run worker$(N)\n"
	@cd $(ENGINE) && bun run worker:dev

# ── Build ────────────────────────────────────────────────────────────────────

.PHONY: build build/web
build: build/web ## Build all apps

build/web: ## Build Next.js for production
	@printf "$(C)→ Building web...$(N)\n"
	@cd $(WEB) && bun run build
	@printf "$(G)✓ Web build complete$(N)\n"

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

setup: install db/create db/migrate ## First-time project setup
	@printf "\n$(B)$(G)✓ Project ready!$(N)\n"
	@printf "  Run $(C)make dev$(N) to start web + engine + worker.\n\n"
