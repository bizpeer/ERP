// ============================================================
// Inventory Service - Stock, Warehouse, Movements
// ============================================================
import express from 'express';
import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';
import {
  Product, Warehouse, StockMovement, StockBalance,
  MovementType, QueryParams, PaginatedResponse, ERPEvent,
  WarehouseLocation, TrackingMethod
} from './index';
import { BaseRepository, CacheService } from './base.repository';
import { AuthenticatedRequest } from './auth.service';
import { MessageBus } from './message-bus.service';
import { AuditService } from './audit.service';
import { DocumentNumberGenerator } from './document-number.service';

// ─── Stock Balance Repository ─────────────────────────────────
export class StockBalanceRepository {
  constructor(private pool: Pool, private cache: CacheService) { }

  async getBalance(
    productId: string,
    warehouseId: string,
    tenantId: string,
    locationId?: string,
    lotNumber?: string
  ): Promise<StockBalance | null> {
    const cacheKey = `stock:${tenantId}:${productId}:${warehouseId}:${locationId || ''}:${lotNumber || ''}`;

    return this.cache.remember(cacheKey, 60, async () => {
      const result = await this.pool.query(
        `SELECT * FROM stock_balances
         WHERE product_id = $1 AND warehouse_id = $2 AND tenant_id = $3
           AND ($4::uuid IS NULL OR location_id = $4)
           AND ($5::text IS NULL OR lot_number = $5)`,
        [productId, warehouseId, tenantId, locationId, lotNumber]
      );
      return result.rows[0] || null;
    });
  }

  async getAvailableQuantity(
    productId: string,
    warehouseId: string,
    tenantId: string
  ): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(quantity_on_hand - quantity_reserved), 0) AS available
       FROM stock_balances
       WHERE product_id = $1 AND warehouse_id = $2 AND tenant_id = $3`,
      [productId, warehouseId, tenantId]
    );
    return Number(result.rows[0]?.available || 0);
  }

  async getLowStockProducts(
    tenantId: string,
    companyId: string
  ): Promise<Array<{ product: Partial<Product>; currentQty: number; reorderPoint: number }>> {
    const result = await this.pool.query(
      `SELECT 
        p.id, p.code, p.name, p.reorder_point,
        COALESCE(SUM(sb.quantity_on_hand - sb.quantity_reserved), 0) AS current_qty
       FROM products p
       LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1 AND p.company_id = $2 AND p.is_deleted = FALSE
         AND p.track_inventory = TRUE
       GROUP BY p.id, p.code, p.name, p.reorder_point
       HAVING COALESCE(SUM(sb.quantity_on_hand - sb.quantity_reserved), 0) <= p.reorder_point
       ORDER BY (COALESCE(SUM(sb.quantity_on_hand - sb.quantity_reserved), 0) / NULLIF(p.reorder_point, 0)) ASC`,
      [tenantId, companyId]
    );

    return result.rows.map((row) => ({
      product: { id: row.id, code: row.code, name: row.name },
      currentQty: Number(row.current_qty),
      reorderPoint: Number(row.reorder_point),
    }));
  }

  async getInventoryValueByWarehouse(
    tenantId: string,
    companyId: string
  ): Promise<Array<{ warehouseId: string; warehouseName: string; totalValue: number }>> {
    const result = await this.pool.query(
      `SELECT 
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        COALESCE(SUM(sb.quantity_on_hand * sb.average_cost), 0) AS total_value
       FROM warehouses w
       LEFT JOIN stock_balances sb ON sb.warehouse_id = w.id AND sb.tenant_id = w.tenant_id
       WHERE w.tenant_id = $1 AND w.company_id = $2 AND w.is_deleted = FALSE
       GROUP BY w.id, w.name
       ORDER BY total_value DESC`,
      [tenantId, companyId]
    );
    return result.rows.map((r) => ({
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      totalValue: Number(r.total_value),
    }));
  }

  async updateBalance(
    movement: StockMovement,
    client: PoolClient
  ): Promise<void> {
    // Update destination balance (for receipts and transfers in)
    if (movement.toWarehouseId) {
      await this.upsertBalance(
        movement.productId,
        movement.toWarehouseId,
        movement.toLocationId,
        movement.tenantId,
        movement.companyId,
        movement.quantity,
        0,
        movement.unitCost,
        client
      );
    }

    // Update source balance (for shipments and transfers out)
    if (movement.fromWarehouseId) {
      await this.upsertBalance(
        movement.productId,
        movement.fromWarehouseId,
        movement.fromLocationId,
        movement.tenantId,
        movement.companyId,
        -movement.quantity,
        0,
        movement.unitCost,
        client
      );
    }

    // Invalidate cache
    const cacheKey = `stock:${movement.tenantId}:${movement.productId}:*`;
    await this.cache.delPattern(cacheKey);
  }

  private async upsertBalance(
    productId: string,
    warehouseId: string,
    locationId: string | undefined,
    tenantId: string,
    companyId: string,
    quantityDelta: number,
    reservedDelta: number,
    unitCost: number,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO stock_balances (
        product_id, warehouse_id, location_id, tenant_id, company_id,
        quantity_on_hand, quantity_reserved, average_cost, total_value, last_movement_date
      )
      VALUES ($1, $2, $3, $4, $5, GREATEST(0, $6), GREATEST(0, $7), $8,
              GREATEST(0, $6) * $8, NOW())
      ON CONFLICT (product_id, warehouse_id, COALESCE(location_id, ''), tenant_id)
      DO UPDATE SET
        quantity_on_hand = GREATEST(0, stock_balances.quantity_on_hand + $6),
        quantity_reserved = GREATEST(0, stock_balances.quantity_reserved + $7),
        average_cost = CASE
          WHEN $6 > 0 THEN
            (stock_balances.quantity_on_hand * stock_balances.average_cost + $6 * $8) /
            NULLIF(stock_balances.quantity_on_hand + $6, 0)
          ELSE stock_balances.average_cost
        END,
        total_value = GREATEST(0, stock_balances.quantity_on_hand + $6) *
          CASE WHEN $6 > 0 THEN
            (stock_balances.quantity_on_hand * stock_balances.average_cost + $6 * $8) /
            NULLIF(stock_balances.quantity_on_hand + $6, 0)
          ELSE stock_balances.average_cost END,
        last_movement_date = NOW()`,
      [productId, warehouseId, locationId, tenantId, companyId,
        quantityDelta, reservedDelta, unitCost]
    );
  }
}

// ─── Stock Movement Repository ───────────────────────────────
export class StockMovementRepository extends BaseRepository<StockMovement> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'stock_movements', 'sm', 60, auditService);
  }

  async getMovementHistory(
    productId: string,
    warehouseId: string,
    tenantId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<StockMovement[]> {
    const result = await this.pool.query(
      `SELECT * FROM stock_movements
       WHERE product_id = $1 AND tenant_id = $2
         AND (from_warehouse_id = $3 OR to_warehouse_id = $3)
         AND created_at BETWEEN $4 AND $5
         AND is_deleted = FALSE
       ORDER BY created_at DESC`,
      [productId, tenantId, warehouseId, fromDate, toDate]
    );
    return result.rows.map(this.mapToEntity.bind(this));
  }

  protected mapToEntity(row: Record<string, unknown>): StockMovement {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      movementNumber: row.movement_number as string,
      movementType: row.movement_type as MovementType,
      productId: row.product_id as string,
      fromWarehouseId: row.from_warehouse_id as string,
      fromLocationId: row.from_location_id as string,
      toWarehouseId: row.to_warehouse_id as string,
      toLocationId: row.to_location_id as string,
      quantity: Number(row.quantity),
      unitCost: Number(row.unit_cost),
      totalCost: Number(row.total_cost),
      referenceType: row.reference_type as string,
      referenceId: row.reference_id as string,
      lotNumber: row.lot_number as string,
      serialNumbers: row.serial_numbers as string[],
      notes: row.notes as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      isDeleted: row.is_deleted as boolean,
      version: row.version as number,
    };
  }
}

// ─── Inventory Service ────────────────────────────────────────
export class InventoryService {
  constructor(
    private movementRepo: StockMovementRepository,
    private balanceRepo: StockBalanceRepository,
    private pool: Pool,
    private numberGenerator: DocumentNumberGenerator
  ) { }

  async createMovement(
    data: Omit<StockMovement, 'id' | 'movementNumber' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'version'>,
    userId: string
  ): Promise<StockMovement> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Validate for outbound movements
      if (data.fromWarehouseId && data.movementType !== MovementType.RECEIPT) {
        const available = await this.balanceRepo.getAvailableQuantity(
          data.productId,
          data.fromWarehouseId,
          data.tenantId
        );
        if (available < data.quantity) {
          throw new Error(
            `Insufficient stock. Available: ${available}, Required: ${data.quantity}`
          );
        }
      }

      const movementNumber = await this.numberGenerator.next(
        'STM', data.tenantId, data.companyId
      );

      const movement = await this.movementRepo.create(
        { ...data, movementNumber, totalCost: data.quantity * data.unitCost },
        userId,
        client
      );

      await this.balanceRepo.updateBalance(movement, client);
      await client.query('COMMIT');

      return movement;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveStock(
    productId: string,
    warehouseId: string,
    quantity: number,
    referenceId: string,
    tenantId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE stock_balances
       SET quantity_reserved = quantity_reserved + $1
       WHERE product_id = $2 AND warehouse_id = $3 AND tenant_id = $4
         AND quantity_on_hand - quantity_reserved >= $1`,
      [quantity, productId, warehouseId, tenantId]
    );
  }

  async releaseReservation(
    productId: string,
    warehouseId: string,
    quantity: number,
    referenceId: string,
    tenantId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE stock_balances
       SET quantity_reserved = GREATEST(0, quantity_reserved - $1)
       WHERE product_id = $2 AND warehouse_id = $3 AND tenant_id = $4`,
      [quantity, productId, warehouseId, tenantId]
    );
  }

  async performStockAdjustment(
    productId: string,
    warehouseId: string,
    newQuantity: number,
    reason: string,
    tenantId: string,
    companyId: string,
    userId: string
  ): Promise<StockMovement> {
    const currentBalance = await this.balanceRepo.getBalance(
      productId, warehouseId, tenantId
    );
    const currentQty = currentBalance?.quantityOnHand || 0;
    const delta = newQuantity - currentQty;

    if (delta === 0) throw new Error('No adjustment needed');

    return this.createMovement(
      {
        tenantId,
        companyId,
        movementType: MovementType.ADJUSTMENT,
        productId,
        toWarehouseId: delta > 0 ? warehouseId : undefined,
        fromWarehouseId: delta < 0 ? warehouseId : undefined,
        quantity: Math.abs(delta),
        unitCost: currentBalance?.averageCost || 0,
        totalCost: Math.abs(delta) * (currentBalance?.averageCost || 0),
        notes: reason,
      } as Omit<StockMovement, 'id' | 'movementNumber' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'version'>,
      userId
    );
  }
}


// ─── Inventory Router ─────────────────────────────────────────
export function createInventoryRouter(
  service: InventoryService,
  balanceRepo: StockBalanceRepository
): express.Router {
  const router = express.Router();

  // Get available stock
  router.get('/stock/available', async (req: AuthenticatedRequest, res) => {
    try {
      const { productId, warehouseId } = req.query as Record<string, string>;
      const available = await balanceRepo.getAvailableQuantity(
        productId, warehouseId, req.tenantId!
      );
      res.json({ success: true, data: { available } });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get stock' });
    }
  });

  // Reserve stock
  router.post('/stock/reserve', async (req: AuthenticatedRequest, res) => {
    try {
      const { productId, warehouseId, quantity, referenceId } = req.body;
      await service.reserveStock(productId, warehouseId, quantity, referenceId, req.tenantId!);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Reserve failed',
      });
    }
  });

  // Release reservation
  router.post('/stock/release', async (req: AuthenticatedRequest, res) => {
    try {
      const { productId, warehouseId, quantity, referenceId } = req.body;
      await service.releaseReservation(productId, warehouseId, quantity, referenceId, req.tenantId!);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, message: 'Release failed' });
    }
  });

  // Stock adjustment
  router.post('/stock/adjust', async (req: AuthenticatedRequest, res) => {
    try {
      const { productId, warehouseId, newQuantity, reason } = req.body;
      const movement = await service.performStockAdjustment(
        productId, warehouseId, newQuantity, reason,
        req.tenantId!, req.companyId!, req.user!.sub
      );
      res.json({ success: true, data: movement });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Adjustment failed',
      });
    }
  });

  // Low stock alert
  router.get('/stock/low', async (req: AuthenticatedRequest, res) => {
    try {
      const items = await balanceRepo.getLowStockProducts(req.tenantId!, req.companyId!);
      res.json({ success: true, data: items });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get low stock items' });
    }
  });

  // Inventory valuation
  router.get('/stock/valuation', async (req: AuthenticatedRequest, res) => {
    try {
      const breakdown = await balanceRepo.getInventoryValueByWarehouse(
        req.tenantId!, req.companyId!
      );
      res.json({ success: true, data: breakdown });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get valuation' });
    }
  });

  // Create stock movement
  router.post('/movements', async (req: AuthenticatedRequest, res) => {
    try {
      const movement = await service.createMovement(
        { ...req.body, tenantId: req.tenantId, companyId: req.companyId },
        req.user!.sub
      );
      res.status(201).json({ success: true, data: movement });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Movement failed',
      });
    }
  });

  return router;
}
