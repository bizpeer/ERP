// ============================================================
// Sales Service - Orders, Shipments, Invoices
// ============================================================
import express from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import amqp from 'amqplib';
import {
  SalesOrder, SalesOrderStatus, SalesOrderItem, Shipment,
  ShipmentStatus, Invoice, InvoiceStatus, ApprovalStatus,
  QueryParams, PaginatedResponse, ERPEvent, Money,
  ERP_MODULE, PermissionAction
} from './index';
import { BaseRepository, QueryBuilder } from './base.repository';
import { AuthenticatedRequest, createPermissionMiddleware } from './auth.service';
import { MessageBus } from './message-bus.service';
import { AuditService } from './audit.service';
import { DocumentNumberGenerator } from './document-number.service';

// ─── Sales Order Repository ──────────────────────────────────
export class SalesOrderRepository extends BaseRepository<SalesOrder> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'sales_orders', 'so', 120, auditService);
  }

  async findByNumber(
    orderNumber: string,
    tenantId: string
  ): Promise<SalesOrder | null> {
    const result = await this.pool.query(
      `SELECT so.*, 
              json_agg(soi ORDER BY soi.line_number) AS items
       FROM sales_orders so
       LEFT JOIN sales_order_items soi ON soi.order_id = so.id
       WHERE so.order_number = $1 AND so.tenant_id = $2 AND so.is_deleted = FALSE
       GROUP BY so.id`,
      [orderNumber, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  async findWithItems(id: string, tenantId: string): Promise<SalesOrder | null> {
    const result = await this.pool.query(
      `SELECT so.*,
              json_agg(soi ORDER BY soi.line_number) FILTER (WHERE soi.id IS NOT NULL) AS items
       FROM sales_orders so
       LEFT JOIN sales_order_items soi ON soi.order_id = so.id AND soi.is_deleted = FALSE
       WHERE so.id = $1 AND so.tenant_id = $2 AND so.is_deleted = FALSE
       GROUP BY so.id`,
      [id, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  async getOrdersByCustomer(
    customerId: string,
    tenantId: string,
    params: QueryParams = {}
  ): Promise<PaginatedResponse<SalesOrder>> {
    const filters = [
      ...(params.filters || []),
      { field: 'customer_id', operator: 'eq' as const, value: customerId }
    ];
    return this.findAll(tenantId, params.filters?.[0]?.value as string || '', {
      ...params,
      filters,
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: SalesOrderStatus,
    userId: string,
    isAdmin: boolean = false // 관리자 권한 여부 추가
  ): Promise<void> {
    const existing = await this.findById(id, tenantId);
    if (existing) {
      this.checkTimeLimit(existing, isAdmin);
    }

    await this.pool.query(
      `UPDATE sales_orders SET status = $1, updated_by = $2, updated_at = NOW(), version = version + 1
       WHERE id = $3 AND tenant_id = $4 AND is_deleted = FALSE`,
      [status, userId, id, tenantId]
    );
    await this.invalidateCache(tenantId, id);
  }

  async getDashboardStats(
    tenantId: string,
    companyId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<{
    totalOrders: number;
    totalRevenue: number;
    pendingOrders: number;
    confirmedOrders: number;
  }> {
    const result = await this.pool.query(
      `SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total), 0) AS total_revenue,
        COUNT(*) FILTER (WHERE status = 'DRAFT') AS pending_orders,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'PROCESSING')) AS confirmed_orders
       FROM sales_orders
       WHERE tenant_id = $1 AND company_id = $2
         AND order_date BETWEEN $3 AND $4
         AND is_deleted = FALSE`,
      [tenantId, companyId, fromDate, toDate]
    );
    return result.rows[0];
  }

  protected applySearch(qb: QueryBuilder, search: string): void {
    qb.where(
      `(so.order_number ILIKE $${(qb as any).paramIndex} OR so.customer_name ILIKE $${(qb as any).paramIndex})`,
      `%${search}%`
    );
  }

  protected mapToEntity(row: Record<string, unknown>): SalesOrder {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      orderNumber: row.order_number as string,
      orderDate: row.order_date as Date,
      customerId: row.customer_id as string,
      customerName: row.customer_name as string,
      status: row.status as SalesOrderStatus,
      currency: row.currency as string,
      exchangeRate: Number(row.exchange_rate),
      items: (row.items as SalesOrderItem[]) || [],
      subtotal: Number(row.subtotal),
      taxAmount: Number(row.tax_amount),
      discountAmount: Number(row.discount_amount),
      shippingAmount: Number(row.shipping_amount),
      total: Number(row.total),
      totalInBaseCurrency: Number(row.total_in_base_currency),
      billingAddress: row.billing_address as any,
      shippingAddress: row.shipping_address as any,
      paymentTerms: row.payment_terms as string,
      expectedDeliveryDate: row.expected_delivery_date as Date,
      notes: row.notes as string,
      approvalStatus: row.approval_status as ApprovalStatus,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      isDeleted: row.is_deleted as boolean,
      version: row.version as number,
    };
  }
}

// ─── Sales Service (Business Logic) ──────────────────────────
export class SalesOrderService {
  constructor(
    private orderRepo: SalesOrderRepository,
    private numberGenerator: DocumentNumberGenerator,
    private messageBus: MessageBus,
    private inventoryClient: InventoryServiceClient
  ) { }

  async createOrder(
    data: Omit<SalesOrder, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'version' | 'status' | 'approvalStatus'>,
    userId: string
  ): Promise<SalesOrder> {
    // Validate stock availability
    for (const item of data.items) {
      if (item.warehouseId) {
        const available = await this.inventoryClient.getAvailableStock(
          item.productId,
          item.warehouseId,
          data.tenantId
        );
        if (available < item.quantity) {
          throw new Error(
            `Insufficient stock for product ${item.productCode}. Available: ${available}, Required: ${item.quantity}`
          );
        }
      }
    }

    const orderNumber = await this.numberGenerator.next(
      'SO', data.tenantId, data.companyId
    );

    // Calculate totals
    const calculated = this.calculateTotals(data.items);

    const order = await this.orderRepo.create(
      {
        ...data,
        orderNumber,
        status: SalesOrderStatus.DRAFT,
        approvalStatus: ApprovalStatus.PENDING,
        ...calculated,
      },
      userId
    );

    // Emit event for approval workflow, notifications, etc.
    await this.messageBus.emit({
      type: 'SALES_ORDER_CREATED',
      payload: order,
    });

    return order;
  }

  async confirmOrder(id: string, tenantId: string, userId: string): Promise<SalesOrder> {
    const order = await this.orderRepo.findWithItems(id, tenantId);
    if (!order) throw new Error('Order not found');

    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new Error(`Cannot confirm order in status: ${order.status}`);
    }

    await this.orderRepo.updateStatus(id, tenantId, SalesOrderStatus.CONFIRMED, userId);

    // Reserve inventory
    for (const item of order.items) {
      if (item.warehouseId) {
        await this.inventoryClient.reserveStock(
          item.productId,
          item.warehouseId,
          item.quantity,
          order.id,
          tenantId
        );
      }
    }

    return (await this.orderRepo.findWithItems(id, tenantId))!;
  }

  async cancelOrder(
    id: string,
    tenantId: string,
    userId: string,
    reason: string
  ): Promise<void> {
    const order = await this.orderRepo.findById(id, tenantId);
    if (!order) throw new Error('Order not found');

    if ([SalesOrderStatus.SHIPPED, SalesOrderStatus.INVOICED, SalesOrderStatus.CLOSED].includes(order.status)) {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }

    await this.orderRepo.updateStatus(id, tenantId, SalesOrderStatus.CANCELLED, userId);

    // Release reserved inventory
    if (order.status === SalesOrderStatus.CONFIRMED || order.status === SalesOrderStatus.PROCESSING) {
      for (const item of order.items) {
        if (item.warehouseId) {
          await this.inventoryClient.releaseReservation(
            item.productId,
            item.warehouseId,
            item.quantity,
            order.id,
            tenantId
          );
        }
      }
    }
  }

  private calculateTotals(items: SalesOrderItem[]): {
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    total: number;
  } {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discountAmount = items.reduce((sum, item) => sum + item.discountAmount, 0);
    const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
    const total = subtotal - discountAmount + taxAmount;

    return { subtotal, taxAmount, discountAmount, total };
  }
}

// ─── Inventory Client (HTTP) ─────────────────────────────────

// ─── Inventory Client (HTTP) ─────────────────────────────────
export class InventoryServiceClient {
  constructor(private baseUrl: string) { }

  async getAvailableStock(
    productId: string,
    warehouseId: string,
    tenantId: string
  ): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/api/stock/available?productId=${productId}&warehouseId=${warehouseId}`,
      { headers: { 'X-Tenant-ID': tenantId } }
    );
    const data = await response.json() as { data: { available: number } };
    return data.data.available;
  }

  async reserveStock(
    productId: string,
    warehouseId: string,
    quantity: number,
    referenceId: string,
    tenantId: string
  ): Promise<void> {
    await fetch(`${this.baseUrl}/api/stock/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
      body: JSON.stringify({ productId, warehouseId, quantity, referenceId }),
    });
  }

  async releaseReservation(
    productId: string,
    warehouseId: string,
    quantity: number,
    referenceId: string,
    tenantId: string
  ): Promise<void> {
    await fetch(`${this.baseUrl}/api/stock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
      body: JSON.stringify({ productId, warehouseId, quantity, referenceId }),
    });
  }
}

// ─── Sales Router ─────────────────────────────────────────────
export function createSalesRouter(
  service: SalesOrderService,
  orderRepo: SalesOrderRepository,
  permissionCheck: ReturnType<typeof createPermissionMiddleware>
): express.Router {
  const router = express.Router();
  const canRead = createPermissionMiddleware(
    null as ReturnType<typeof import('@erp/auth').PermissionService>,
    ERP_MODULE.SALES, PermissionAction.READ
  );
  const canCreate = createPermissionMiddleware(
    null as ReturnType<typeof import('@erp/auth').PermissionService>,
    ERP_MODULE.SALES, PermissionAction.CREATE
  );
  const canUpdate = createPermissionMiddleware(
    null as ReturnType<typeof import('@erp/auth').PermissionService>,
    ERP_MODULE.SALES, PermissionAction.UPDATE
  );

  /**
   * @openapi
   * /sales/orders:
   *   get:
   *     summary: List sales orders
   *     tags: [Sales]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: pageSize
   *         schema:
   *           type: integer
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   */
  router.get('/orders', async (req: AuthenticatedRequest, res) => {
    try {
      const params: QueryParams = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 20,
        search: req.query.search as string,
        filters: req.query.status
          ? [{ field: 'status', operator: 'eq', value: req.query.status }]
          : [],
        sort: req.query.sortBy
          ? [{ field: req.query.sortBy as string, direction: (req.query.sortDir as 'asc' | 'desc') || 'desc' }]
          : [],
      };

      const result = await orderRepo.findAll(
        req.tenantId!,
        req.companyId!,
        params
      );
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
  });

  /**
   * @openapi
   * /sales/orders/{id}:
   *   get:
   *     summary: Get a sales order by ID
   *     tags: [Sales]
   */
  router.get('/orders/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const order = await orderRepo.findWithItems(req.params.id, req.tenantId!);
      if (!order) {
        res.status(404).json({ success: false, message: 'Order not found' });
        return;
      }
      res.json({ success: true, data: order });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to fetch order' });
    }
  });

  /**
   * @openapi
   * /sales/orders:
   *   post:
   *     summary: Create a new sales order
   *     tags: [Sales]
   */
  router.post('/orders', async (req: AuthenticatedRequest, res) => {
    try {
      const order = await service.createOrder(
        { ...req.body, tenantId: req.tenantId, companyId: req.companyId },
        req.user!.sub
      );
      res.status(201).json({ success: true, data: order });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create order',
      });
    }
  });

  router.post('/orders/:id/confirm', async (req: AuthenticatedRequest, res) => {
    try {
      const order = await service.confirmOrder(
        req.params.id,
        req.tenantId!,
        req.user!.sub
      );
      res.json({ success: true, data: order });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to confirm order',
      });
    }
  });

  router.post('/orders/:id/cancel', async (req: AuthenticatedRequest, res) => {
    try {
      await service.cancelOrder(
        req.params.id,
        req.tenantId!,
        req.user!.sub,
        req.body.reason
      );
      res.json({ success: true, message: 'Order cancelled successfully' });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel order',
      });
    }
  });

  /**
   * @openapi
   * /sales/dashboard:
   *   get:
   *     summary: Get sales dashboard stats
   *     tags: [Sales]
   */
  router.get('/dashboard', async (req: AuthenticatedRequest, res) => {
    try {
      const fromDate = new Date(req.query.fromDate as string || new Date().setDate(1));
      const toDate = new Date(req.query.toDate as string || Date.now());

      const stats = await orderRepo.getDashboardStats(
        req.tenantId!,
        req.companyId!,
        fromDate,
        toDate
      );

      res.json({ success: true, data: stats });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
  });

  return router;
}

// ─── Main Entry Point ─────────────────────────────────────────
export async function createSalesApp(config: {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
  inventoryServiceUrl: string;
}): Promise<void> {
  const { createPool } = await import('@erp/database');
  const { Redis } = await import('ioredis');

  const pool = createPool(config.databaseUrl);
  const redis = new Redis(config.redisUrl);
  const auditService = new AuditService(process.env.MONGO_URL!, 'erp');
  const messageBus = new MessageBus(config.rabbitmqUrl);
  const inventoryClient = new InventoryServiceClient(config.inventoryServiceUrl);
  const numberGenerator = new DocumentNumberGenerator(pool);
  const orderRepo = new SalesOrderRepository(pool, redis, auditService);
  const salesService = new SalesOrderService(
    orderRepo,
    numberGenerator,
    messageBus,
    inventoryClient
  );

  await messageBus.connect();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', service: 'sales-service' })
  );

  // Mount routes
  app.use('/api', createSalesRouter(salesService, orderRepo, null as unknown as ReturnType<typeof createPermissionMiddleware>));

  app.listen(config.port, () => {
    console.log(`Sales service running on port ${config.port}`);
  });
}
