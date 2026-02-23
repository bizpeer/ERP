// ============================================================
// Production Service - BOM, Work Orders, Operations
// ============================================================
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import express from 'express';
import {
  BillOfMaterials, WorkOrder, WorkOrderStatus, MovementType,
  BOMComponent, BOMOperation, WorkOrderOperation, MaterialConsumption
} from './index';
import { BaseRepository } from './base.repository';
import { AuthenticatedRequest } from './auth.service';
import { MessageBus } from './message-bus.service';
import { AuditService } from './audit.service';
import { DocumentNumberGenerator } from './document-number.service';

// ─── BOM Repository ───────────────────────────────────────────
export class BOMRepository extends BaseRepository<BillOfMaterials> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'bill_of_materials', 'bom', 300, auditService);
  }

  async findActiveByProduct(
    productId: string,
    tenantId: string
  ): Promise<BillOfMaterials | null> {
    const result = await this.pool.query(
      `SELECT bom.*,
              json_agg(DISTINCT bc) FILTER (WHERE bc.id IS NOT NULL) AS components,
              json_agg(DISTINCT bo ORDER BY bo.sequence) FILTER (WHERE bo.id IS NOT NULL) AS operations
       FROM bill_of_materials bom
       LEFT JOIN bom_components bc ON bc.bom_id = bom.id
       LEFT JOIN bom_operations bo ON bo.bom_id = bom.id
       WHERE bom.product_id = $1 AND bom.tenant_id = $2
         AND bom.is_active = TRUE AND bom.is_deleted = FALSE
       GROUP BY bom.id
       LIMIT 1`,
      [productId, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  async explodeBOM(
    productId: string,
    quantity: number,
    tenantId: string,
    level = 0,
    maxLevel = 5
  ): Promise<BOMExplosion[]> {
    if (level >= maxLevel) return [];

    const bom = await this.findActiveByProduct(productId, tenantId);
    if (!bom) return [];

    const result: BOMExplosion[] = [];
    const scaleFactor = quantity / bom.quantity;

    for (const component of bom.components) {
      const requiredQty = component.quantity * scaleFactor * (1 + component.scrapPercent / 100);
      result.push({
        level,
        productId: component.componentProductId,
        parentProductId: productId,
        requiredQuantity: requiredQty,
        unitId: component.unitId,
        scrapPercent: component.scrapPercent,
        isOptional: component.isOptional,
        children: await this.explodeBOM(
          component.componentProductId,
          requiredQty,
          tenantId,
          level + 1,
          maxLevel
        ),
      });
    }

    return result;
  }

  protected mapToEntity(row: Record<string, unknown>): BillOfMaterials {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      code: row.code as string,
      name: row.name as string,
      productId: row.product_id as string,
      version: row.version as number,
      isActive: row.is_active as boolean,
      quantity: Number(row.quantity),
      unitId: row.unit_id as string,
      components: (row.components as BOMComponent[]) || [],
      operations: (row.operations as BOMOperation[]) || [],
      notes: row.notes as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      isDeleted: row.is_deleted as boolean,
    };
  }
}

interface BOMExplosion {
  level: number;
  productId: string;
  parentProductId: string;
  requiredQuantity: number;
  unitId: string;
  scrapPercent: number;
  isOptional: boolean;
  children: BOMExplosion[];
}

// ─── Work Order Repository ────────────────────────────────────
export class WorkOrderRepository extends BaseRepository<WorkOrder> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'work_orders', 'wo', 60, auditService);
  }

  async findWithDetails(id: string, tenantId: string): Promise<WorkOrder | null> {
    const result = await this.pool.query(
      `SELECT wo.*,
              json_agg(DISTINCT woo ORDER BY woo.sequence) FILTER (WHERE woo.id IS NOT NULL) AS operations,
              json_agg(DISTINCT mc) FILTER (WHERE mc.id IS NOT NULL) AS material_consumptions
       FROM work_orders wo
       LEFT JOIN work_order_operations woo ON woo.work_order_id = wo.id
       LEFT JOIN material_consumptions mc ON mc.work_order_id = wo.id
       WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.is_deleted = FALSE
       GROUP BY wo.id`,
      [id, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  async getProductionSchedule(
    tenantId: string,
    companyId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<WorkOrder[]> {
    const result = await this.pool.query(
      `SELECT * FROM work_orders
       WHERE tenant_id = $1 AND company_id = $2
         AND planned_start_date <= $4 AND planned_end_date >= $3
         AND status NOT IN ('COMPLETED', 'CANCELLED')
         AND is_deleted = FALSE
       ORDER BY planned_start_date`,
      [tenantId, companyId, fromDate, toDate]
    );
    return result.rows.map(this.mapToEntity.bind(this));
  }

  protected mapToEntity(row: Record<string, unknown>): WorkOrder {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      orderNumber: row.order_number as string,
      productId: row.product_id as string,
      bomId: row.bom_id as string,
      warehouseId: row.warehouse_id as string,
      plannedQty: Number(row.planned_qty),
      completedQty: Number(row.completed_qty),
      scrapQty: Number(row.scrap_qty),
      status: row.status as WorkOrderStatus,
      plannedStartDate: row.planned_start_date as Date,
      plannedEndDate: row.planned_end_date as Date,
      actualStartDate: row.actual_start_date as Date,
      actualEndDate: row.actual_end_date as Date,
      operations: (row.operations as WorkOrderOperation[]) || [],
      materialConsumptions: (row.material_consumptions as MaterialConsumption[]) || [],
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

// ─── Production Service ────────────────────────────────────────
export class ProductionService {
  constructor(
    private workOrderRepo: WorkOrderRepository,
    private bomRepo: BOMRepository,
    private pool: Pool,
    private inventoryServiceUrl: string,
    private numberGenerator: DocumentNumberGenerator,
    private messageBus: MessageBus,
    private auditService: AuditService
  ) { }

  async createWorkOrder(
    data: {
      productId: string;
      quantity: number;
      warehouseId: string;
      plannedStartDate: Date;
      plannedEndDate: Date;
      tenantId: string;
      companyId: string;
      notes?: string;
    },
    userId: string
  ): Promise<WorkOrder> {
    // Get active BOM
    const bom = await this.bomRepo.findActiveByProduct(data.productId, data.tenantId);
    if (!bom) throw new Error(`No active BOM found for product: ${data.productId}`);

    // Check material availability
    const scaleFactor = data.quantity / bom.quantity;
    for (const component of bom.components) {
      if (component.isOptional) continue;
      const required = component.quantity * scaleFactor * (1 + component.scrapPercent / 100);
      const available = await this.getAvailableStock(
        component.componentProductId,
        data.warehouseId,
        data.tenantId
      );
      if (available < required) {
        throw new Error(
          `Insufficient stock for component ${component.componentProductId}. ` +
          `Required: ${required.toFixed(2)}, Available: ${available}`
        );
      }
    }

    const orderNumber = await this.numberGenerator.next('WO', data.tenantId, data.companyId);

    // Build work order operations from BOM
    const operations: Omit<WorkOrderOperation, 'id'>[] = bom.operations.map((op) => ({
      bomOperationId: op.id,
      sequence: op.sequence,
      name: op.name,
      workCenterId: op.workCenterId,
      status: 'PENDING' as const,
      plannedQty: data.quantity,
      completedQty: 0,
      plannedTimeMinutes: op.setupTimeMinutes + op.runTimeMinutes * data.quantity,
    }));

    // Build material consumptions from BOM
    const consumptions: Omit<MaterialConsumption, 'id'>[] = bom.components.map((comp) => ({
      componentProductId: comp.componentProductId,
      plannedQty: comp.quantity * scaleFactor * (1 + comp.scrapPercent / 100),
      actualQty: 0,
    }));

    const workOrder = await this.workOrderRepo.create(
      {
        orderNumber,
        productId: data.productId,
        bomId: bom.id,
        warehouseId: data.warehouseId,
        plannedQty: data.quantity,
        completedQty: 0,
        scrapQty: 0,
        status: WorkOrderStatus.DRAFT,
        plannedStartDate: data.plannedStartDate,
        plannedEndDate: data.plannedEndDate,
        operations: operations as WorkOrderOperation[],
        materialConsumptions: consumptions as MaterialConsumption[],
        notes: data.notes,
        tenantId: data.tenantId,
        companyId: data.companyId,
        createdBy: userId,
        updatedBy: userId,
      } as WorkOrder,
      userId
    );

    return workOrder;
  }

  async startWorkOrder(id: string, tenantId: string, userId: string): Promise<WorkOrder> {
    const workOrder = await this.workOrderRepo.findWithDetails(id, tenantId);
    if (!workOrder) throw new Error('Work order not found');
    if (workOrder.status !== WorkOrderStatus.CONFIRMED) {
      throw new Error(`Cannot start work order in status: ${workOrder.status}`);
    }

    // Consume raw materials from inventory
    for (const consumption of workOrder.materialConsumptions) {
      await this.createInventoryMovement({
        movementType: MovementType.PRODUCTION_OUT,
        productId: consumption.componentProductId,
        fromWarehouseId: workOrder.warehouseId,
        quantity: consumption.plannedQty,
        referenceType: 'WORK_ORDER',
        referenceId: workOrder.id,
        tenantId,
        companyId: workOrder.companyId,
      });
    }

    await this.pool.query(
      `UPDATE work_orders
       SET status = $1, actual_start_date = NOW(), updated_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [WorkOrderStatus.IN_PROGRESS, userId, id]
    );

    return (await this.workOrderRepo.findWithDetails(id, tenantId))!;
  }

  async completeWorkOrder(
    id: string,
    tenantId: string,
    completedQty: number,
    scrapQty: number,
    userId: string
  ): Promise<WorkOrder> {
    const workOrder = await this.workOrderRepo.findWithDetails(id, tenantId);
    if (!workOrder) throw new Error('Work order not found');
    if (workOrder.status !== WorkOrderStatus.IN_PROGRESS) {
      throw new Error(`Cannot complete work order in status: ${workOrder.status}`);
    }

    // Produce finished goods to inventory
    await this.createInventoryMovement({
      movementType: MovementType.PRODUCTION_IN,
      productId: workOrder.productId,
      toWarehouseId: workOrder.warehouseId,
      quantity: completedQty,
      referenceType: 'WORK_ORDER',
      referenceId: workOrder.id,
      tenantId,
      companyId: workOrder.companyId,
    });

    const newStatus = completedQty >= workOrder.plannedQty
      ? WorkOrderStatus.COMPLETED
      : WorkOrderStatus.PARTIALLY_COMPLETED;

    await this.pool.query(
      `UPDATE work_orders
       SET status = $1, completed_qty = $2, scrap_qty = $3,
           actual_end_date = NOW(), updated_by = $4, updated_at = NOW()
       WHERE id = $5`,
      [newStatus, completedQty, scrapQty, userId, id]
    );

    return (await this.workOrderRepo.findWithDetails(id, tenantId))!;
  }

  private async getAvailableStock(
    productId: string,
    warehouseId: string,
    tenantId: string
  ): Promise<number> {
    const response = await fetch(
      `${this.inventoryServiceUrl}/api/stock/available?productId=${productId}&warehouseId=${warehouseId}`,
      { headers: { 'X-Tenant-ID': tenantId } }
    );
    const data = await response.json() as { data: { available: number } };
    return data.data.available;
  }

  private async createInventoryMovement(data: {
    movementType: MovementType;
    productId: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    quantity: number;
    referenceType: string;
    referenceId: string;
    tenantId: string;
    companyId: string;
  }): Promise<void> {
    await fetch(`${this.inventoryServiceUrl}/api/movements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': data.tenantId,
      },
      body: JSON.stringify(data),
    });
  }
}


// ─── Production Router ────────────────────────────────────────
export function createProductionRouter(
  service: ProductionService,
  bomRepo: BOMRepository,
  workOrderRepo: WorkOrderRepository
): express.Router {
  const router = express.Router();

  // BOM routes
  router.get('/bom', async (req: AuthenticatedRequest, res) => {
    try {
      const data = await bomRepo.findAll(req.tenantId!, req.companyId!);
      res.json({ success: true, ...data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get BOMs' });
    }
  });

  router.get('/bom/:productId/explode', async (req: AuthenticatedRequest, res) => {
    try {
      const qty = parseFloat(req.query.quantity as string) || 1;
      const explosion = await bomRepo.explodeBOM(req.params.productId, qty, req.tenantId!);
      res.json({ success: true, data: explosion });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to explode BOM' });
    }
  });

  // Work Order routes
  router.get('/work-orders', async (req: AuthenticatedRequest, res) => {
    try {
      const data = await workOrderRepo.findAll(req.tenantId!, req.companyId!);
      res.json({ success: true, ...data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get work orders' });
    }
  });

  router.get('/work-orders/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const wo = await workOrderRepo.findWithDetails(req.params.id, req.tenantId!);
      if (!wo) {
        res.status(404).json({ success: false, message: 'Work order not found' });
        return;
      }
      res.json({ success: true, data: wo });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get work order' });
    }
  });

  router.post('/work-orders', async (req: AuthenticatedRequest, res) => {
    try {
      const wo = await service.createWorkOrder(
        { ...req.body, tenantId: req.tenantId, companyId: req.companyId },
        req.user!.sub
      );
      res.status(201).json({ success: true, data: wo });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create work order',
      });
    }
  });

  router.post('/work-orders/:id/start', async (req: AuthenticatedRequest, res) => {
    try {
      const wo = await service.startWorkOrder(req.params.id, req.tenantId!, req.user!.sub);
      res.json({ success: true, data: wo });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start work order',
      });
    }
  });

  router.post('/work-orders/:id/complete', async (req: AuthenticatedRequest, res) => {
    try {
      const { completedQty, scrapQty } = req.body;
      const wo = await service.completeWorkOrder(
        req.params.id, req.tenantId!, completedQty, scrapQty || 0, req.user!.sub
      );
      res.json({ success: true, data: wo });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to complete work order',
      });
    }
  });

  // Production schedule (Gantt data)
  router.get('/schedule', async (req: AuthenticatedRequest, res) => {
    try {
      const fromDate = new Date((req.query.fromDate as string) || Date.now());
      const toDate = new Date((req.query.toDate as string) || Date.now());
      const schedule = await workOrderRepo.getProductionSchedule(
        req.tenantId!, req.companyId!, fromDate, toDate
      );
      res.json({ success: true, data: schedule });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get schedule' });
    }
  });

  return router;
}
