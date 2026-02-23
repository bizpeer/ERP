.PHONY: help build up down logs clean restart health ps

# Default target
help:
	@echo "╔════════════════════════════════════════════════════════╗"
	@echo "║         ERP SaaS Docker Development Commands           ║"
	@echo "╚════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Build & Startup:"
	@echo "  make build        - Build all Docker images"
	@echo "  make up           - Start all services (detached)"
	@echo "  make up-logs      - Start all services with logs"
	@echo ""
	@echo "Management:"
	@echo "  make down         - Stop and remove containers"
	@echo "  make restart      - Restart all services"
	@echo "  make ps           - Show running containers"
	@echo "  make clean        - Remove containers, volumes, and images"
	@echo ""
	@echo "Debugging:"
	@echo "  make logs         - Show logs from all services"
	@echo "  make logs-gateway - Show API Gateway logs"
	@echo "  make logs-auth    - Show Auth Service logs"
	@echo "  make health       - Check service health"
	@echo ""
	@echo "Database:"
	@echo "  make db-init      - Initialize database"
	@echo "  make db-shell     - Connect to PostgreSQL shell"
	@echo "  make redis-cli    - Connect to Redis CLI"
	@echo ""

# Build
build:
	docker-compose build --no-cache

build-fast:
	docker-compose build

# Startup
up:
	docker-compose up -d

up-logs:
	docker-compose up

# Stop & Remove
down:
	docker-compose down

restart:
	docker-compose restart

# Status
ps:
	docker-compose ps

health:
	@echo "Checking service health..."
	@docker-compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"

# Logs
logs:
	docker-compose logs -f

logs-gateway:
	docker-compose logs -f api-gateway

logs-auth:
	docker-compose logs -f auth-service

logs-sales:
	docker-compose logs -f sales-service

logs-inventory:
	docker-compose logs -f inventory-service

# Cleanup
clean:
	docker-compose down -v
	docker system prune -f

prune:
	docker system prune -a -f

# Database operations
db-init:
	docker-compose exec postgres psql -U erp_user -d erp_main -f /docker-entrypoint-initdb.d/init.sql

db-shell:
	docker-compose exec postgres psql -U erp_user -d erp_main

redis-cli:
	docker-compose exec redis redis-cli -a erp_secret

mongo-shell:
	docker-compose exec mongodb mongosh -u erp_user -p erp_secret

# Development
dev:
	npm run dev

test:
	npm run test

format:
	npx prettier --write .

lint:
	npx eslint . --ext .ts

# Info
info:
	@echo "╔════════════════════════════════════════════════════════╗"
	@echo "║           Service URLs & Credentials                  ║"
	@echo "╚════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "API Gateway:      http://localhost:3000"
	@echo "API Docs:         http://localhost:3000/docs"
	@echo "Health Check:     http://localhost:3000/health"
	@echo ""
	@echo "RabbitMQ:         http://localhost:15672"
	@echo "  User: erp_user / Pass: erp_secret"
	@echo ""
	@echo "MinIO:            http://localhost:9001"
	@echo "  User: erp_admin / Pass: erp_secret"
	@echo "  S3 API:         http://localhost:9000"
	@echo ""
	@echo "PostgreSQL:       localhost:5432"
	@echo "  User: erp_user / Pass: erp_secret / DB: erp_main"
	@echo ""
	@echo "MongoDB:          localhost:27017"
	@echo "  User: erp_user / Pass: erp_secret / DB: erp_logs"
	@echo ""
	@echo "Redis:            localhost:6379"
	@echo "  Password: erp_secret"
	@echo ""
