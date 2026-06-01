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
API := apps/api

# ── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show available commands
	@printf "\n$(B)$(C)  Agentik Monorepo$(N)\n\n"
	@grep -E '^[a-zA-Z_/-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(C)%-20s$(N) %s\n", $$1, $$2}'
	@printf "\n"

# ── Install ──────────────────────────────────────────────────────────────────

.PHONY: install install/web install/api
install: install/web install/api ## Install all dependencies
	@printf "$(G)✓ All dependencies installed$(N)\n"

install/web: ## Install frontend dependencies (bun)
	@printf "$(C)→ Installing web dependencies...$(N)\n"
	@cd $(WEB) && bun install

install/api: ## Install API dependencies (composer)
	@printf "$(C)→ Installing API dependencies...$(N)\n"
	@cd $(API) && composer install --no-interaction --quiet

# ── Development ──────────────────────────────────────────────────────────────

.PHONY: dev dev/web dev/api
dev: ## Start both apps in parallel
	@printf "$(B)$(G)Starting dev servers...$(N)\n"
	@$(MAKE) -j2 dev/web dev/api

dev/web: ## Start Next.js dev server (:3000)
	@printf "$(C)→ Next.js on http://localhost:3000$(N)\n"
	@cd $(WEB) && bun run dev

dev/api: ## Start Laravel dev server (:8000)
	@printf "$(C)→ Laravel on http://localhost:8000$(N)\n"
	@cd $(API) && php artisan serve

# ── Build ────────────────────────────────────────────────────────────────────

.PHONY: build build/web
build: build/web ## Build all apps

build/web: ## Build Next.js for production
	@printf "$(C)→ Building web...$(N)\n"
	@cd $(WEB) && bun run build
	@printf "$(G)✓ Web build complete$(N)\n"

# ── Test ─────────────────────────────────────────────────────────────────────

.PHONY: test test/web test/api test/e2e
test: test/web test/api ## Run all tests

test/web: ## Run frontend tests (vitest)
	@printf "$(C)→ Running web tests...$(N)\n"
	@cd $(WEB) && bun run test

test/api: ## Run API tests (phpunit)
	@printf "$(C)→ Running API tests...$(N)\n"
	@cd $(API) && php artisan test

test/e2e: ## Run e2e tests (Playwright)
	@printf "$(C)→ Running e2e tests...$(N)\n"
	@cd $(WEB) && bun run test:e2e

# ── Lint & Format ───────────────────────────────────────────────────────────

.PHONY: lint lint/web typecheck format
lint: lint/web ## Lint all apps

lint/web: ## Lint frontend (eslint)
	@printf "$(C)→ Linting web...$(N)\n"
	@cd $(WEB) && bun run lint

typecheck: ## TypeScript type-check
	@printf "$(C)→ Type-checking web...$(N)\n"
	@cd $(WEB) && bun run typecheck

format: ## Format code (prettier)
	@printf "$(C)→ Formatting...$(N)\n"
	@cd $(WEB) && bun run format

# ── Database ─────────────────────────────────────────────────────────────────

.PHONY: db/create db/migrate db/fresh db/seed db/reset
db/create: ## Create PostgreSQL database
	@printf "$(C)→ Creating database...$(N)\n"
	@docker exec infra-postgres psql -U test -d devhub -c "CREATE DATABASE agentik;" 2>/dev/null || true
	@printf "$(G)✓ Database ready$(N)\n"

db/migrate: ## Run migrations
	@printf "$(C)→ Running migrations...$(N)\n"
	@cd $(API) && php artisan migrate
	@printf "$(G)✓ Migrations complete$(N)\n"

db/fresh: ## Drop all tables + re-run migrations
	@printf "$(Y)⚠ Dropping all tables...$(N)\n"
	@cd $(API) && php artisan migrate:fresh
	@printf "$(G)✓ Fresh migration complete$(N)\n"

db/seed: ## Seed the database
	@printf "$(C)→ Seeding database...$(N)\n"
	@cd $(API) && php artisan db:seed
	@printf "$(G)✓ Seed complete$(N)\n"

db/reset: db/fresh db/seed ## Fresh migrate + seed

# ── Utilities ────────────────────────────────────────────────────────────────

.PHONY: clean setup
clean: ## Remove build artifacts and dependencies
	@printf "$(Y)→ Cleaning...$(N)\n"
	@rm -rf $(WEB)/node_modules $(WEB)/.next $(API)/vendor node_modules
	@printf "$(G)✓ Clean$(N)\n"

setup: install db/create db/migrate ## First-time project setup
	@printf "\n$(B)$(G)✓ Project ready!$(N)\n"
	@printf "  Run $(C)make dev$(N) to start both servers.\n\n"
