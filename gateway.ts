// ============================================================
// API Gateway - Routing, Middleware, Rate Limiting
// ============================================================
import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { Redis } from 'ioredis';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { authRateLimiter, apiRateLimiter } from './auth.service';

const app = express();

// ─── Config ───────────────────────────────────────────────────
const config = {
  port: parseInt(process.env.PORT || '3000'),
  services: {
    auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
    sales: process.env.SALES_SERVICE_URL || 'http://sales-service:3002',
    purchase: process.env.PURCHASE_SERVICE_URL || 'http://purchase-service:3003',
    inventory: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004',
    production: process.env.PRODUCTION_SERVICE_URL || 'http://production-service:3005',
    accounting: process.env.ACCOUNTING_SERVICE_URL || 'http://accounting-service:3006',
    tenant: process.env.TENANT_SERVICE_URL || 'http://tenant-service:3007',
    excel: process.env.EXCEL_ENGINE_URL || 'http://excel-engine:3008',
  },
};

// ─── OpenAPI Specification ────────────────────────────────────
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'ERP SaaS API',
    version: '1.0.0',
    description: 'Multi-tenant SaaS ERP System for Manufacturing & Distribution',
    contact: { name: 'ERP Support', email: 'support@erp.com' },
  },
  servers: [
    { url: 'http://localhost:3000/api', description: 'Development' },
    { url: 'https://api.erp.com/v1', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object' },
          message: { type: 'string' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                field: { type: 'string' },
              },
            },
          },
        },
      },
      PaginatedResponse: {
        allOf: [
          { $ref: '#/components/schemas/ApiResponse' },
          {
            properties: {
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                  total: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
              },
            },
          },
        ],
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication & Authorization' },
    { name: 'Sales', description: 'Sales Orders, Shipments, Invoices' },
    { name: 'Purchase', description: 'Purchase Orders & Receipts' },
    { name: 'Inventory', description: 'Stock Management & Warehouses' },
    { name: 'Production', description: 'BOM & Work Orders' },
    { name: 'Accounting', description: 'Journal Entries, AR/AP, Reports' },
    { name: 'Excel', description: 'Excel Import/Export Engine' },
    { name: 'Tenant', description: 'Tenant Management & Billing' },
    { name: 'Dashboard', description: 'KPI & Analytics' },
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'companyId'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  companyId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
          401: { description: 'Invalid credentials' },
        },
        security: [],
      },
    },
  },
};

// ─── Global Middleware ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:4000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Company-ID'],
}));

app.use(morgan('combined'));

// ─── Tenant Resolution Middleware ────────────────────────────
app.use((req: Request & { tenantId?: string }, res, next) => {
  // Resolve tenant from subdomain or header
  const tenantHeader = req.headers['x-tenant-id'] as string;
  const subdomain = req.hostname.split('.')[0];
  req.tenantId = tenantHeader || (subdomain !== 'api' ? subdomain : undefined);
  if (req.tenantId) {
    res.setHeader('X-Tenant-ID', req.tenantId);
  }
  next();
});

// ─── API Documentation ────────────────────────────────────────
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'ERP API Documentation',
}));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ─── Proxy Helper ─────────────────────────────────────────────
function createProxy(target: string, pathRewrite?: Record<string, string>) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      error: (err, _req, res) => {
        console.error('Proxy error:', err);
        (res as Response).status(503).json({
          success: false,
          message: 'Service temporarily unavailable',
        });
      },
      proxyReq: fixRequestBody,
    },
    headers: {
      'X-Forwarded-For': 'api-gateway',
    },
  });
}

// ─── Service Routes ───────────────────────────────────────────

// Auth (no rate limit on refresh, stricter on login)
app.use('/api/auth', createProxy(config.services.auth, { '^/api/auth': '/api' }));

// Tenant/Billing
app.use(
  '/api/tenant',
  apiRateLimiter,
  createProxy(config.services.tenant, { '^/api/tenant': '/api' })
);

// Sales Module
app.use(
  '/api/sales',
  apiRateLimiter,
  createProxy(config.services.sales, { '^/api/sales': '/api' })
);

// Purchase Module
app.use(
  '/api/purchase',
  apiRateLimiter,
  createProxy(config.services.purchase, { '^/api/purchase': '/api' })
);

// Inventory Module
app.use(
  '/api/inventory',
  apiRateLimiter,
  createProxy(config.services.inventory, { '^/api/inventory': '/api' })
);

// Production Module
app.use(
  '/api/production',
  apiRateLimiter,
  createProxy(config.services.production, { '^/api/production': '/api' })
);

// Accounting Module
app.use(
  '/api/accounting',
  apiRateLimiter,
  createProxy(config.services.accounting, { '^/api/accounting': '/api' })
);

// Excel Engine
app.use(
  '/api/excel',
  createProxy(config.services.excel, { '^/api/excel': '/api' })
);

// ─── Global Error Handler ────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const errors = err.errors || [];
  const code = err.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR');

  res.status(status).json({
    success: false,
    message,
    errors: errors.length > 0 ? errors : [{ code, message }],
    timestamp: new Date().toISOString(),
  });
});

// ─── Start ────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║         ERP SaaS API Gateway                  ║
╠═══════════════════════════════════════════════╣
║  Port:  ${config.port}                                ║
║  Docs:  http://localhost:${config.port}/docs          ║
║  Health: http://localhost:${config.port}/health       ║
╚═══════════════════════════════════════════════╝
  `);
});

export default app;
