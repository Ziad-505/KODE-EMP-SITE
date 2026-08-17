# Convenience wrapper. Everything here is a plain docker compose or pnpm call;
# nothing is hidden behind the Makefile that you cannot run by hand.
SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE_DEV := docker compose -f docker-compose.dev.yml

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

.PHONY: setup
setup: ## One-time local prep: .env, shared contracts, Prisma client
	@test -f apps/api/.env || (cp apps/api/.env.example apps/api/.env && echo "created apps/api/.env from the example")
	pnpm --filter @kode/contracts build
	pnpm --filter @kode/api exec prisma generate

.PHONY: up
up: ## Start Postgres, Mailpit and the API in Docker
	$(COMPOSE_DEV) up -d --build

.PHONY: down
down: ## Stop the development stack
	$(COMPOSE_DEV) down

.PHONY: dev
dev: setup ## Start the dev stack, then both frontends on the host
	$(COMPOSE_DEV) up -d --build
	@echo "Waiting for the API to become healthy..."
	@for i in $$(seq 1 40); do \
		curl -fsS http://localhost:4000/api/v1/health/ready >/dev/null 2>&1 && break; \
		sleep 2; \
	done
	@curl -fsS http://localhost:4000/api/v1/health/ready >/dev/null 2>&1 \
		&& echo "API is ready on http://localhost:4000" \
		|| echo "API did not become ready. Check: docker compose -f docker-compose.dev.yml logs api"
	pnpm --parallel --filter @kode/portal --filter @kode/admin dev

.PHONY: migrate
migrate: setup ## Apply database migrations
	pnpm --filter @kode/api db:deploy

.PHONY: seed
seed: ## Load demo departments, people and content (runs inside the API container)
	$(COMPOSE_DEV) exec -T api ./node_modules/.bin/tsx prisma/seed.ts

.PHONY: seed-local
seed-local: setup ## Seed from the host. Needs host access to the database.
	pnpm --filter @kode/api db:seed

.PHONY: reset
reset: ## Drop, recreate, migrate and seed the development database
	pnpm --filter @kode/api db:reset

.PHONY: build
build: ## Build every package
	pnpm -r build

.PHONY: typecheck
typecheck: ## Typecheck every package
	pnpm -r typecheck

.PHONY: lint
lint: ## Lint the workspace
	pnpm lint

.PHONY: test
test: ## Run unit tests
	pnpm -r test

.PHONY: check
check: typecheck lint test ## Everything CI runs

.PHONY: logs
logs: ## Tail the development API logs
	$(COMPOSE_DEV) logs -f api

.PHONY: psql
psql: ## Open a psql shell against the development database
	$(COMPOSE_DEV) exec postgres psql -U kode -d kode_portal

.PHONY: prod-up
prod-up: ## Build and start the production stack
	docker compose up -d --build

.PHONY: prod-migrate
prod-migrate: ## Apply migrations inside the running production API container
	docker compose exec api ./node_modules/.bin/prisma migrate deploy

.PHONY: prod-logs
prod-logs: ## Tail production logs
	docker compose logs -f --tail=200
