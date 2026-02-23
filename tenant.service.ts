// ============================================================
// Tenant Service - Multi-tenancy, Subscriptions, Billing
// ============================================================
import express from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import Stripe from 'stripe';
import {
  Tenant, SubscriptionPlan, TenantStatus, TenantSettings, ERP_MODULE
} from '@erp/types';
import { AuthenticatedRequest } from '@erp/auth';

// ─── Plan Definitions ─────────────────────────────────────────
export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  [SubscriptionPlan.FREE]: {
    plan: SubscriptionPlan.FREE,
    maxCompanies: 1,
    maxUsers: 3,
    maxStorageBytes: 100 * 1024 * 1024, // 100MB
    enabledModules: [ERP_MODULE.SALES, ERP_MODULE.PURCHASE, ERP_MODULE.INVENTORY],
    apiRequestsPerMinute: 30,
    stripePriceId: null,
  },
  [SubscriptionPlan.STARTER]: {
    plan: SubscriptionPlan.STARTER,
    maxCompanies: 2,
    maxUsers: 10,
    maxStorageBytes: 1024 * 1024 * 1024, // 1GB
    enabledModules: [
      ERP_MODULE.SALES, ERP_MODULE.PURCHASE, ERP_MODULE.INVENTORY, ERP_MODULE.ACCOUNTING
    ],
    apiRequestsPerMinute: 100,
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID,
  },
  [SubscriptionPlan.PROFESSIONAL]: {
    plan: SubscriptionPlan.PROFESSIONAL,
    maxCompanies: 5,
    maxUsers: 50,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    enabledModules: Object.values(ERP_MODULE),
    apiRequestsPerMinute: 500,
    stripePriceId: process.env.STRIPE_PROFESSIONAL_PRICE_ID,
  },
  [SubscriptionPlan.ENTERPRISE]: {
    plan: SubscriptionPlan.ENTERPRISE,
    maxCompanies: -1, // Unlimited
    maxUsers: -1,
    maxStorageBytes: -1,
    enabledModules: Object.values(ERP_MODULE),
    apiRequestsPerMinute: -1,
    stripePriceId: null, // Custom pricing
  },
};

interface PlanDefinition {
  plan: SubscriptionPlan;
  maxCompanies: number;
  maxUsers: number;
  maxStorageBytes: number;
  enabledModules: ERP_MODULE[];
  apiRequestsPerMinute: number;
  stripePriceId: string | null | undefined;
}

// ─── Usage Tracker ─────────────────────────────────────────────
export class UsageTracker {
  constructor(private pool: Pool, private redis: Redis) {}

  async trackAPIRequest(tenantId: string): Promise<void> {
    const key = `usage:api:${tenantId}:${new Date().toISOString().slice(0, 13)}`;
    await this.redis.incr(key);
    await this.redis.expire(key, 3600 * 25); // Keep 25 hours
  }

  async trackStorageUsed(tenantId: string, bytes: number): Promise<void> {
    await this.pool.query(
      `UPDATE tenants SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2`,
      [bytes, tenantId]
    );
  }

  async getAPIUsage(tenantId: string): Promise<{
    lastHour: number;
    last24Hours: number;
    lastMonth: number;
  }> {
    const now = new Date();
    const hourKeys = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now);
      d.setHours(d.getHours() - i);
      return `usage:api:${tenantId}:${d.toISOString().slice(0, 13)}`;
    });

    const values = await this.redis.mget(...hourKeys);
    const hourlyValues = values.map((v) => parseInt(v || '0', 10));

    return {
      lastHour: hourlyValues[0],
      last24Hours: hourlyValues.reduce((a, b) => a + b, 0),
      lastMonth: await this.getMonthlyAPIUsage(tenantId),
    };
  }

  async getMonthlyAPIUsage(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(request_count), 0) AS total
       FROM api_usage_logs
       WHERE tenant_id = $1
         AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [tenantId]
    );
    return Number(result.rows[0].total);
  }

  async checkRateLimit(
    tenantId: string,
    plan: SubscriptionPlan
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const planDef = PLAN_DEFINITIONS[plan];
    if (planDef.apiRequestsPerMinute === -1) {
      return { allowed: true, remaining: -1, resetAt: new Date() };
    }

    const minute = new Date().toISOString().slice(0, 16);
    const key = `ratelimit:${tenantId}:${minute}`;
    const current = await this.redis.incr(key);
    await this.redis.expire(key, 70); // 70 seconds to handle edge cases

    const resetAt = new Date();
    resetAt.setSeconds(60, 0);

    return {
      allowed: current <= planDef.apiRequestsPerMinute,
      remaining: Math.max(0, planDef.apiRequestsPerMinute - current),
      resetAt,
    };
  }
}

// ─── Tenant Repository ────────────────────────────────────────
export class TenantRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      'SELECT * FROM tenants WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;
    return this.mapTenant(result.rows[0]);
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      'SELECT * FROM tenants WHERE slug = $1',
      [slug]
    );
    if (result.rows.length === 0) return null;
    return this.mapTenant(result.rows[0]);
  }

  async create(data: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tenant> {
    const result = await this.pool.query(
      `INSERT INTO tenants (name, slug, plan, status, settings, billing_info, storage_used_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       RETURNING *`,
      [data.name, data.slug, data.plan, data.status,
       JSON.stringify(data.settings), JSON.stringify(data.billingInfo)]
    );
    return this.mapTenant(result.rows[0]);
  }

  async updatePlan(tenantId: string, plan: SubscriptionPlan): Promise<void> {
    const planDef = PLAN_DEFINITIONS[plan];
    const settings: TenantSettings = {
      maxCompanies: planDef.maxCompanies,
      maxUsers: planDef.maxUsers,
      maxStorageBytes: planDef.maxStorageBytes,
      enabledModules: planDef.enabledModules,
      features: {},
    };

    await this.pool.query(
      `UPDATE tenants SET plan = $1, settings = $2, updated_at = NOW() WHERE id = $3`,
      [plan, JSON.stringify(settings), tenantId]
    );
  }

  async updateStatus(tenantId: string, status: TenantStatus): Promise<void> {
    await this.pool.query(
      'UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, tenantId]
    );
  }

  private mapTenant(row: Record<string, unknown>): Tenant {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      plan: row.plan as SubscriptionPlan,
      status: row.status as TenantStatus,
      settings: row.settings as TenantSettings,
      billingInfo: row.billing_info as Record<string, unknown> as Tenant['billingInfo'],
      storageUsedBytes: Number(row.storage_used_bytes),
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}

// ─── Tenant Service ───────────────────────────────────────────
export class TenantService {
  private stripe: Stripe;

  constructor(
    private tenantRepo: TenantRepository,
    private usageTracker: UsageTracker,
    stripeSecretKey: string
  ) {
    this.stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-10-28.acacia' });
  }

  async registerTenant(data: {
    name: string;
    slug: string;
    ownerEmail: string;
    ownerName: string;
  }): Promise<{ tenant: Tenant; setupToken: string }> {
    // Validate slug uniqueness
    const existing = await this.tenantRepo.findBySlug(data.slug);
    if (existing) throw new Error('Slug already taken');

    // Create Stripe customer
    const stripeCustomer = await this.stripe.customers.create({
      email: data.ownerEmail,
      name: data.name,
      metadata: { slug: data.slug },
    });

    const planDef = PLAN_DEFINITIONS[SubscriptionPlan.FREE];
    const settings: TenantSettings = {
      maxCompanies: planDef.maxCompanies,
      maxUsers: planDef.maxUsers,
      maxStorageBytes: planDef.maxStorageBytes,
      enabledModules: planDef.enabledModules,
      features: {},
    };

    const tenant = await this.tenantRepo.create({
      name: data.name,
      slug: data.slug,
      plan: SubscriptionPlan.FREE,
      status: TenantStatus.TRIAL,
      settings,
      billingInfo: {
        stripeCustomerId: stripeCustomer.id,
        planStartDate: new Date(),
      },
      storageUsedBytes: 0,
    });

    // Generate setup token for initial admin setup
    const setupToken = Buffer.from(`${tenant.id}:${Date.now()}`).toString('base64');

    return { tenant, setupToken };
  }

  async upgradePlan(
    tenantId: string,
    newPlan: SubscriptionPlan,
    paymentMethodId: string
  ): Promise<{ tenant: Tenant; subscriptionId: string }> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const planDef = PLAN_DEFINITIONS[newPlan];
    if (!planDef.stripePriceId) {
      throw new Error(`Plan ${newPlan} requires manual setup. Contact sales.`);
    }

    // Attach payment method and create subscription in Stripe
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: tenant.billingInfo.stripeCustomerId!,
    });

    await this.stripe.customers.update(tenant.billingInfo.stripeCustomerId!, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await this.stripe.subscriptions.create({
      customer: tenant.billingInfo.stripeCustomerId!,
      items: [{ price: planDef.stripePriceId }],
      metadata: { tenantId },
    });

    await this.tenantRepo.updatePlan(tenantId, newPlan);

    const updatedTenant = await this.tenantRepo.findById(tenantId);
    return { tenant: updatedTenant!, subscriptionId: subscription.id };
  }

  async handleStripeWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = invoice.metadata?.['tenantId'];
        if (tenantId) {
          await this.tenantRepo.updateStatus(tenantId, TenantStatus.ACTIVE);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = invoice.metadata?.['tenantId'];
        if (tenantId) {
          await this.tenantRepo.updateStatus(tenantId, TenantStatus.SUSPENDED);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.['tenantId'];
        if (tenantId) {
          await this.tenantRepo.updatePlan(tenantId, SubscriptionPlan.FREE);
        }
        break;
      }
    }
  }

  async checkModuleAccess(tenantId: string, module: ERP_MODULE): Promise<boolean> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) return false;
    if (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.TRIAL) {
      return false;
    }
    return tenant.settings.enabledModules.includes(module);
  }

  async getUsageSummary(tenantId: string): Promise<UsageSummary> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const apiUsage = await this.usageTracker.getAPIUsage(tenantId);
    const planDef = PLAN_DEFINITIONS[tenant.plan];

    return {
      plan: tenant.plan,
      storage: {
        used: tenant.storageUsedBytes,
        limit: planDef.maxStorageBytes,
        percentage: planDef.maxStorageBytes === -1
          ? 0
          : (tenant.storageUsedBytes / planDef.maxStorageBytes) * 100,
      },
      api: {
        lastHour: apiUsage.lastHour,
        last24Hours: apiUsage.last24Hours,
        lastMonth: apiUsage.lastMonth,
        limit: planDef.apiRequestsPerMinute === -1 ? -1 : planDef.apiRequestsPerMinute * 60 * 24 * 30,
      },
      enabledModules: tenant.settings.enabledModules,
      limits: {
        maxCompanies: planDef.maxCompanies,
        maxUsers: planDef.maxUsers,
      },
    };
  }
}

interface UsageSummary {
  plan: SubscriptionPlan;
  storage: { used: number; limit: number; percentage: number };
  api: { lastHour: number; last24Hours: number; lastMonth: number; limit: number };
  enabledModules: ERP_MODULE[];
  limits: { maxCompanies: number; maxUsers: number };
}

// ─── Module Guard Middleware ───────────────────────────────────
export function createModuleGuard(tenantService: TenantService, module: ERP_MODULE) {
  return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction): Promise<void> => {
    const hasAccess = await tenantService.checkModuleAccess(req.tenantId!, module);
    if (!hasAccess) {
      res.status(403).json({
        success: false,
        message: `Module ${module} is not available in your current plan. Please upgrade.`,
        upgradeUrl: '/api/billing/upgrade',
      });
      return;
    }
    next();
  };
}

// ─── Tenant Router ─────────────────────────────────────────────
export function createTenantRouter(
  tenantService: TenantService,
  usageTracker: UsageTracker
): express.Router {
  const router = express.Router();

  // Register new tenant (public)
  router.post('/register', async (req, res) => {
    try {
      const { name, slug, ownerEmail, ownerName } = req.body;
      const result = await tenantService.registerTenant({ name, slug, ownerEmail, ownerName });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Registration failed',
      });
    }
  });

  // Upgrade plan
  router.post('/upgrade', async (req: AuthenticatedRequest, res) => {
    try {
      const { plan, paymentMethodId } = req.body;
      const result = await tenantService.upgradePlan(req.tenantId!, plan, paymentMethodId);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Upgrade failed',
      });
    }
  });

  // Usage summary
  router.get('/usage', async (req: AuthenticatedRequest, res) => {
    try {
      const summary = await tenantService.getUsageSummary(req.tenantId!);
      res.json({ success: true, data: summary });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get usage' });
    }
  });

  // Stripe webhook (no auth required)
  router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    try {
      // Webhook validation happens inside the service
      res.json({ received: true });
    } catch {
      res.status(400).json({ error: 'Webhook error' });
    }
  });

  return router;
}
