# 🏭 ERP SaaS - Multi-Tenant Manufacturing & Distribution Platform

A production-grade, multi-tenant SaaS ERP system built with microservices architecture, covering the full operational lifecycle of manufacturing and distribution companies.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                                │
│              (Web App / Mobile App / Third-party Integrations)                  │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                    ┌────────────────▼──────────────────┐
                    │          API Gateway :3000          │
                    │  (Routing, Auth, Rate Limiting,     │
                    │   CORS, OpenAPI Docs)               │
                    └──────┬────────────────────┬─────────┘
                           │                    │
          ┌────────────────▼──┐         ┌───────▼─────────────┐
          │  Auth Service     │         │  Tenant Service     │
          │  :3001            │         │  :3007              │
          │  JWT/RBAC         │         │  Subscription/Billing│
          └───────────────────┘         └─────────────────────┘
                    │
    ┌───────────────┼───────────────────────────┐
    │               │               │           │
┌───▼───┐   ┌───────▼──┐  ┌────────▼──┐  ┌─────▼──────┐
│ Sales │   │ Purchase │  │ Inventory │  │ Production │
│ :3002 │   │  :3003   │  │  :3004    │  │  :3005     │
└───────┘   └──────────┘  └───────────┘  └────────────┘
    │               │               │           │
┌───▼───────────────▼───────────────▼───────────▼──────┐
│                Message Bus (RabbitMQ)                  │
│           (Event-driven inter-service comms)           │
└───────────────────────────────────────────────────────┘
    │
┌───▼─────────────┐  ┌────────────────┐  ┌─────────────────┐
│ Accounting :3006│  │ Excel Engine   │  │  Notification   │
│ Journal/AR/AP   │  │ :3008 NLP+EL   │  │  Service        │
└─────────────────┘  └────────────────┘  └─────────────────┘
    │
┌───▼──────────────────────────────────────────────────┐
│                  Data Layer                           │
│  PostgreSQL (primary)  MongoDB (logs/memo)  Redis    │
│  Multi-tenant schema   Audit trail          Cache    │
└──────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
erp-saas/
├── services/
│   ├── api-gateway/          # Entry point, routing, OpenAPI docs
│   │   └── src/gateway.ts
│   ├── auth-service/         # JWT auth, RBAC, MFA
│   │   └── src/auth.service.ts
│   ├── sales-service/        # Orders, Shipments, Invoices
│   │   └── src/sales.service.ts
│   ├── purchase-service/     # POs, Receipts, Suppliers
│   ├── inventory-service/    # Stock, Warehouses, Movements
│   │   └── src/inventory.service.ts
│   ├── production-service/   # BOM, Work Orders, Operations
│   │   └── src/production.service.ts
│   ├── accounting-service/   # Journal, AR/AP, Reports
│   │   └── src/accounting.service.ts
│   ├── excel-engine/         # NLP mapping, validation, import
│   │   └── src/excel.engine.ts
│   ├── tenant-service/       # Multi-tenancy, billing, usage
│   │   └── src/tenant.service.ts
│   └── notification-service/ # Email, push, in-app alerts
├── shared/
│   ├── types/                # All TypeScript interfaces
│   │   └── index.ts
│   ├── database/             # Base repository, query builder
│   │   └── base.repository.ts
│   ├── middleware/           # Auth, tenant, validation
│   └── utils/                # Helpers, formatters
├── kubernetes/
│   └── deployment.yaml       # K8s manifests with HPA
├── scripts/
│   ├── init-db.sql           # PostgreSQL schema (full)
│   └── schema-part2.sql
├── tests/
│   └── unit/
│       └── sales.test.ts     # Unit tests
└── docker-compose.yml        # Full local stack
```

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ & Yarn
- kubectl (for K8s deployment)

### 1. Environment Setup
```bash
cp .env.example .env
# Edit .env with your secrets
```

### 2. Start Local Stack
```bash
docker-compose up -d
```

### 3. Initialize Database
```bash
# Auto-runs via Docker init scripts
# Or manually:
psql -U erp_user -d erp_main -f scripts/init-db.sql
```

### 4. Access Services
| Service | URL |
|---------|-----|
| API Gateway | http://localhost:3000 |
| API Docs (Swagger) | http://localhost:3000/docs |
| RabbitMQ Management | http://localhost:15672 |
| MinIO Console | http://localhost:9001 |

---

## 🔐 Authentication Flow

```
1. POST /api/auth/login
   { email, password, companyId }
   → { accessToken (15min), refreshToken (7d) }

2. All API requests:
   Authorization: Bearer <accessToken>
   X-Tenant-ID: <tenantSlug>

3. Token refresh:
   POST /api/auth/refresh
   { refreshToken }
   → { new accessToken, new refreshToken }
```

---

## 📦 Core Modules

### Sales Module
| Endpoint | Description |
|----------|-------------|
| `GET /api/sales/orders` | List orders with pagination/filters |
| `POST /api/sales/orders` | Create sales order (validates stock) |
| `POST /api/sales/orders/:id/confirm` | Confirm & reserve inventory |
| `POST /api/sales/orders/:id/cancel` | Cancel & release reservations |
| `GET /api/sales/dashboard` | KPI stats |

### Inventory Module
| Endpoint | Description |
|----------|-------------|
| `GET /api/inventory/stock/available` | Get available qty |
| `POST /api/inventory/stock/adjust` | Stock adjustment |
| `GET /api/inventory/stock/low` | Low stock alerts |
| `GET /api/inventory/stock/valuation` | Inventory value by warehouse |
| `POST /api/inventory/movements` | Create stock movement |

### Accounting Module
| Endpoint | Description |
|----------|-------------|
| `GET /api/accounting/accounts` | Chart of accounts (tree) |
| `POST /api/accounting/journals` | Create journal entry |
| `POST /api/accounting/journals/:id/post` | Post journal entry |
| `GET /api/accounting/reports/trial-balance` | Trial balance |
| `GET /api/accounting/reports/profit-loss` | P&L statement |
| `GET /api/accounting/reports/cash-flow` | Cash flow statement |

### Production Module
| Endpoint | Description |
|----------|-------------|
| `GET /api/production/bom` | List BOMs |
| `GET /api/production/bom/:productId/explode` | Multi-level BOM explosion |
| `POST /api/production/work-orders` | Create work order (checks materials) |
| `POST /api/production/work-orders/:id/start` | Start & consume materials |
| `POST /api/production/work-orders/:id/complete` | Complete & produce to stock |
| `GET /api/production/schedule` | Gantt data |

### Excel Upload Engine
| Endpoint | Description |
|----------|-------------|
| `POST /api/excel/upload` | Upload Excel with NLP mapping |
| `POST /api/excel/confirm-mapping` | Confirm column mappings |
| `GET /api/excel/template/:entityType` | Download template |

---

## 🧠 Excel Engine - NLP Column Mapping

The Excel engine uses a 4-tier mapping strategy:

```
1. LEARNED     → User-confirmed mappings (highest priority)
2. EXACT       → Direct alias match
3. FUZZY       → Fuse.js similarity search (threshold: 0.4)
4. SEMANTIC    → Keyword overlap analysis
```

**Supported Entity Types:** `PRODUCT`, `CUSTOMER`, `SUPPLIER`, `SALES_ORDER`

**Example: Auto-mapping diverse headers**
```
"품번"          → code       (Korean alias match)
"SKU"          → code       (exact alias)
"Prod Code"    → code       (fuzzy match)
"Selling Price"→ unitPrice  (fuzzy match)
"단가"          → unitPrice  (Korean alias)
```

---

## 🏢 Multi-Tenant Architecture

### Tenant Isolation
- **Row-level security** via `tenant_id` on every table
- **Redis namespacing**: `{service}:{tenantId}:{id}`
- **URL-based routing**: `{tenant}.erp.com` or `X-Tenant-ID` header

### Subscription Plans
| Plan | Companies | Users | Storage | Modules |
|------|-----------|-------|---------|---------|
| FREE | 1 | 3 | 100MB | Sales, Purchase, Inventory |
| STARTER | 2 | 10 | 1GB | + Accounting |
| PROFESSIONAL | 5 | 50 | 10GB | All modules |
| ENTERPRISE | ∞ | ∞ | ∞ | All + Custom |

---

## 🗄️ Database Design

### Key Design Patterns
- **Soft Delete**: `is_deleted`, `deleted_at`, `deleted_by` on all tables
- **Optimistic Locking**: `version` field prevents concurrent update conflicts
- **Audit Trail**: MongoDB captures all field-level changes
- **Custom Fields**: `custom_fields` + `custom_field_values` tables
- **Memo System**: Entity-linked notes with attachments and @mentions
- **Multi-currency**: Exchange rates table + base currency conversion
- **Hierarchical Accounts**: Recursive CTE for Chart of Accounts

---

## ⚙️ Key Technical Decisions

| Concern | Solution | Why |
|---------|----------|-----|
| Service Communication | HTTP + RabbitMQ events | Sync for reads, async for side effects |
| Caching | Redis with TTL + tag invalidation | Reduce DB load, tenant-isolated |
| Double-entry accounting | Balanced journal validation | Mathematical correctness enforced |
| Inventory costing | Weighted Average Cost (WAC) | Standard for manufacturing |
| BOM explosion | Recursive with scrap % | Industry standard |
| Document numbers | Atomic DB sequences | No gaps, no duplicates |
| File storage | MinIO (S3-compatible) | Storage tracking per tenant |

---

## 🧪 Testing

```bash
# Run all unit tests
yarn test

# Run specific service tests
yarn workspace @erp/sales test

# Run with coverage
yarn test --coverage
```

---

## ☸️ Kubernetes Deployment

```bash
# Apply all K8s manifests
kubectl apply -f kubernetes/

# Create secrets
kubectl create secret generic erp-secrets \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=JWT_SECRET='...' \
  -n erp-saas

# Check deployments
kubectl get pods -n erp-saas

# Scale a service
kubectl scale deployment sales-service --replicas=4 -n erp-saas
```

---

## 📊 Approval Workflow Engine

The approval workflow supports:
- **Multi-step** sequential approvals
- **Parallel** approval from any/all approvers
- **Role-based** or user-specific approvers
- **Timeout actions**: escalate, auto-approve, auto-reject
- **Condition-based** triggering (e.g., orders > $10,000)

---

## 🔄 Event-Driven Architecture

Key domain events published to RabbitMQ:

```
erp.events exchange (topic)
├── sales.order.created       → Trigger approval workflow
├── sales.order.approved      → Update status, notify
├── shipment.confirmed        → Update order delivery qty
├── invoice.paid              → Update AR, post payment JE
├── stock.movement.created    → Update balances
├── work.order.completed      → Post FG to inventory
└── inventory.low.stock       → Send reorder alerts
```
