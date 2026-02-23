# Docker Containerization Guide - ERP SaaS System

## Overview

This project has been containerized with Docker best practices including:
- **Multi-stage builds** for optimized production images
- **Health checks** on all services for orchestration support
- **Resource limits** to prevent runaway resource consumption
- **Non-root users** for enhanced security
- **Structured logging** with JSON output
- **Development & production** environment separation
- **Hot reload** capabilities for development

## Files Generated

### Core Files
- **Dockerfile** - Multi-stage build for Node.js/TypeScript application
- **docker-compose.yml** - Production-ready orchestration with infrastructure services
- **docker-compose.dev.yml** - Development overrides with hot-reload
- **.dockerignore** - Optimized build context

### Configuration
- **.env.example** - Example environment variables
- **.env.development** - Development environment
- **.env.production** - Production environment template

### Tools
- **Makefile** - Common docker-compose commands
- **tsconfig.json** - TypeScript configuration

## Quick Start

### Prerequisites
- Docker Desktop 4.10+ (includes docker-compose v2)
- Node.js 20+ (for local development)
- Make (optional, for Makefile commands)

### 1. Setup Environment

Copy the example environment file:
```bash
cp .env.example .env
```

For development, use the development environment:
```bash
cp .env.development .env
```

### 2. Build Images

```bash
# Build all images
docker-compose build

# Or using make
make build
```

### 3. Start Services

Development with hot-reload:
```bash
# Start with logs
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Or in background
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Production setup:
```bash
docker-compose up -d
```

Using make:
```bash
make up           # Start detached
make up-logs      # Start with logs
```

### 4. Verify Services

Check health status:
```bash
docker-compose ps

# Or
make health
```

Access the application:
- **API Gateway**: http://localhost:3000
- **API Documentation**: http://localhost:3000/docs
- **Health Check**: http://localhost:3000/health

### 5. Database Initialization

The database initializes automatically via `/scripts/init-db.sql`. To reinitialize:

```bash
docker-compose exec postgres psql -U erp_user -d erp_main -f /docker-entrypoint-initdb.d/init.sql

# Or using make
make db-init
```

## Service URLs & Credentials

| Service | URL | User | Password | Notes |
|---------|-----|------|----------|-------|
| API Gateway | http://localhost:3000 | - | - | REST API |
| API Docs | http://localhost:3000/docs | - | - | Swagger UI |
| RabbitMQ | http://localhost:15672 | erp_user | erp_secret | Message broker |
| MinIO | http://localhost:9001 | erp_admin | erp_secret | S3-compatible storage |
| MinIO S3 API | http://localhost:9000 | erp_admin | erp_secret | S3 API endpoint |
| PostgreSQL | localhost:5432 | erp_user | erp_secret | Main database |
| MongoDB | localhost:27017 | erp_user | erp_secret | Audit logs |
| Redis | localhost:6379 | - | erp_secret | Cache/session store |

## Common Commands

### Using Make
```bash
make help           # Show all commands
make up             # Start services
make down           # Stop services
make restart        # Restart services
make logs           # Show logs
make logs-gateway   # Show specific service logs
make clean          # Remove containers and volumes
make db-shell       # Connect to PostgreSQL
make redis-cli      # Connect to Redis
make info           # Show service URLs
```

### Using Docker Compose Directly
```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f
docker-compose logs -f api-gateway

# Stop services
docker-compose down

# Show running containers
docker-compose ps

# Execute commands
docker-compose exec api-gateway npm run test
docker-compose exec postgres psql -U erp_user -d erp_main
```

## Development Workflow

### Hot Reload (File Watching)

For development with automatic reloading:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Changes to files in your editor will automatically sync into containers and trigger reloads (via tsx watch).

### Debugging

Enable Node.js debugger by attaching to exposed ports:

- API Gateway debugger: `127.0.0.1:9229`
- Auth Service debugger: `127.0.0.1:9230`
- Sales Service debugger: `127.0.0.1:9231`
- (Additional services on 9232-9237)

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Single service
docker-compose logs -f sales-service

# Last 100 lines
docker-compose logs --tail=100 api-gateway

# Specific timeframe
docker-compose logs --since 10m api-gateway
```

## Production Deployment

### Environment Setup

Create `.env` with production values:

```bash
cp .env.production .env
```

**IMPORTANT**: Update all secrets with strong, unique values:

```bash
# Generate strong secrets
openssl rand -base64 32

# Update in .env
JWT_SECRET=<generated_secret>
JWT_REFRESH_SECRET=<generated_secret>
POSTGRES_PASSWORD=<strong_password>
REDIS_PASSWORD=<strong_password>
RABBITMQ_PASSWORD=<strong_password>
MONGO_PASSWORD=<strong_password>
MINIO_PASSWORD=<strong_password>
```

### Build for Production

```bash
docker-compose build --no-cache
```

### Health Checks

All services include health checks. Monitor them:

```bash
docker-compose ps

# Check specific service
docker inspect erp-api-gateway | grep -A 5 "Health"
```

### Scaling Services

For multiple instances (requires a proper orchestration platform like Docker Swarm or Kubernetes):

```bash
# Docker Swarm
docker stack deploy -c docker-compose.yml erp

# Kubernetes
kubectl apply -f kubernetes/
```

## Docker Compose Structure

### Infrastructure Services
- **PostgreSQL** (16-alpine): Main relational database
- **MongoDB** (7): Audit logs and unstructured data
- **Redis** (7-alpine): Cache and session store
- **RabbitMQ** (3-management): Message broker
- **MinIO** (latest): S3-compatible object storage

### Application Services
- **API Gateway** (3000): Request routing and rate limiting
- **Auth Service** (3001): Authentication & authorization
- **Sales Service** (3002): Sales orders, invoices, shipments
- **Purchase Service** (3003): Purchase orders & receipts
- **Inventory Service** (3004): Stock management
- **Production Service** (3005): Manufacturing & BOM
- **Accounting Service** (3006): General ledger & reports
- **Tenant Service** (3007): Multi-tenancy & billing
- **Excel Engine** (3008): Import/export operations

### Resource Limits

Each service has defined resource limits to prevent runaway consumption:

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

Adjust based on your hardware and workload.

## Troubleshooting

### Container Won't Start

Check logs:
```bash
docker-compose logs api-gateway
```

Common issues:
- Port already in use: `docker ps -a` to find conflicting containers
- Service dependencies not ready: Check health of dependencies
- Environment variables missing: Verify `.env` file

### Database Connection Errors

Verify PostgreSQL is healthy:
```bash
docker-compose exec postgres pg_isready -U erp_user
```

### High Memory Usage

Check resource usage:
```bash
docker stats

# Check specific container
docker inspect erp-api-gateway | grep -A 10 Memory
```

Increase limits in docker-compose.yml if needed.

### Services Crashing

View recent logs:
```bash
docker-compose logs --tail=50 service-name

# Or follow in real-time
docker-compose logs -f --tail=20 service-name
```

### Network Issues

Verify services can communicate:
```bash
# Check network
docker network inspect erp_erp-network

# Test connectivity from container
docker-compose exec api-gateway curl http://auth-service:3001/health
```

## Dockerfile Details

### Build Stages

**Stage 1 - Builder**: Compiles TypeScript
- Installs build tools (Python, C/C++ compiler)
- Installs all dependencies (dev + prod)
- Compiles TypeScript to JavaScript

**Stage 2 - Runtime**: Final production image
- Uses lightweight `node:20-alpine` base
- Installs dumb-init for proper signal handling
- Creates non-root `nodejs` user
- Installs only production dependencies
- Copies compiled output from builder

### Image Size

```
Base image:        44 MB (node:20-alpine)
With deps:        ~280 MB (production dependencies)
Final image:       ~62 MB (compressed)
```

### Security

- Non-root user (nodejs:1001)
- No development tools in runtime
- Minimal attack surface (alpine Linux)
- Health checks for container orchestration

## Performance Tips

1. **Build Caching**: Use `.dockerignore` to reduce context size
2. **Layer Caching**: Order Dockerfile instructions by change frequency
3. **Multi-stage Builds**: Reduce final image size
4. **Resource Limits**: Prevent one service from consuming all resources
5. **Database Indexing**: Ensure critical queries use indexes
6. **Redis Caching**: Use for frequent queries

## Security Best Practices

1. **Secrets Management**:
   - Never commit `.env` files
   - Use Docker secrets for production (Docker Swarm/Kubernetes)
   - Rotate credentials regularly

2. **Image Security**:
   - Scan images: `docker scan erp-api-gateway:dev`
   - Update base images regularly
   - Use specific versions, not `latest`

3. **Network Security**:
   - All services on isolated network
   - Restrict port exposure
   - Use HTTPS in production

4. **Container Security**:
   - Run as non-root
   - Read-only root filesystem where possible
   - Use seccomp/AppArmor profiles

## Monitoring & Logging

### Log Aggregation

Configure centralized logging:

```yaml
# In docker-compose.yml
logging:
  driver: splunk
  options:
    splunk-token: ${SPLUNK_TOKEN}
    splunk-url: ${SPLUNK_URL}
```

### Metrics

Enable Prometheus metrics:

```bash
# Check available metrics
curl http://localhost:3000/metrics
```

## Cleanup

### Remove Unused Resources

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Complete cleanup
docker system prune -a --volumes
```

### Full Reset

```bash
# Stop and remove everything
docker-compose down -v

# Remove all images
docker image rm erp-api-gateway:dev

# Start fresh
docker-compose build --no-cache
docker-compose up -d
```

## References

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/reference/)
- [Node.js Docker Best Practices](https://docs.docker.com/language/nodejs/build-images/)
- [Docker Security](https://docs.docker.com/engine/security/)

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Run health checks: `docker-compose ps`
3. Inspect services: `docker inspect container-name`
4. Review environment: `cat .env`

---

**Last Updated**: 2024
**Docker Version**: 4.10+
**Node.js Version**: 20+
