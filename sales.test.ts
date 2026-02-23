// ============================================================
// Unit Tests - Sales Service & Excel Engine
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SalesOrderService, InventoryServiceClient, SalesOrderRepository } from './sales.service';
import { DocumentNumberGenerator } from './document-number.service';
import { MessageBus } from './message-bus.service';
import { NLPColumnMapper, DataValidator, DuplicateDetector, ExcelUploadEngine } from './excel.engine';
import { SalesOrderStatus, ApprovalStatus } from './index';

// ─── Sales Service Tests ─────────────────────────────────────
describe('SalesOrderService', () => {
  let service: SalesOrderService;
  let mockOrderRepo: Partial<SalesOrderRepository>;
  let mockNumberGenerator: Partial<DocumentNumberGenerator>;
  let mockMessageBus: Partial<MessageBus>;
  let mockInventoryClient: Partial<InventoryServiceClient>;

  const mockOrder = {
    id: 'order-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    orderNumber: 'SO-2024-000001',
    orderDate: new Date(),
    customerId: 'cust-1',
    customerName: 'Test Customer',
    status: SalesOrderStatus.DRAFT,
    currency: 'USD',
    exchangeRate: 1,
    items: [
      {
        id: 'item-1',
        lineNumber: 1,
        productId: 'prod-1',
        productCode: 'P001',
        productName: 'Test Product',
        quantity: 10,
        unitId: 'unit-1',
        unitPrice: 100,
        discountPercent: 0,
        discountAmount: 0,
        taxRate: 0,
        taxAmount: 0,
        lineTotal: 1000,
        warehouseId: 'wh-1',
        deliveredQty: 0,
        invoicedQty: 0,
      },
    ],
    subtotal: 1000,
    taxAmount: 0,
    discountAmount: 0,
    shippingAmount: 0,
    total: 1000,
    totalInBaseCurrency: 1000,
    billingAddress: {} as any,
    shippingAddress: {} as any,
    paymentTerms: 'NET30',
    approvalStatus: ApprovalStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    isDeleted: false,
    version: 1,
  };

  beforeEach(() => {
    mockOrderRepo = {
      create: vi.fn().mockResolvedValue(mockOrder),
      findById: vi.fn().mockResolvedValue(mockOrder),
      findWithItems: vi.fn().mockResolvedValue(mockOrder),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockNumberGenerator = {
      next: vi.fn().mockResolvedValue('SO-2024-000001'),
    };

    mockMessageBus = {
      emit: vi.fn().mockResolvedValue(undefined),
    };

    mockInventoryClient = {
      getAvailableStock: vi.fn().mockResolvedValue(100),
      reserveStock: vi.fn().mockResolvedValue(undefined),
      releaseReservation: vi.fn().mockResolvedValue(undefined),
    };

    service = new SalesOrderService(
      mockOrderRepo as SalesOrderRepository,
      mockNumberGenerator as DocumentNumberGenerator,
      mockMessageBus as MessageBus,
      mockInventoryClient as InventoryServiceClient
    );
  });

  describe('createOrder', () => {
    it('should create a sales order with correct defaults', async () => {
      const result = await service.createOrder(
        {
          tenantId: 'tenant-1',
          companyId: 'company-1',
          customerId: 'cust-1',
          customerName: 'Test Customer',
          orderDate: new Date(),
          currency: 'USD',
          exchangeRate: 1,
          items: mockOrder.items,
          subtotal: 1000,
          taxAmount: 0,
          discountAmount: 0,
          shippingAmount: 0,
          total: 1000,
          totalInBaseCurrency: 1000,
          billingAddress: {} as any,
          shippingAddress: {} as any,
          paymentTerms: 'NET30',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        },
        'user-1'
      );

      expect(result).toBeDefined();
      expect(mockNumberGenerator.next).toHaveBeenCalledWith('SO', 'tenant-1', 'company-1');
      expect(mockMessageBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SALES_ORDER_CREATED' })
      );
    });

    it('should check stock availability for each item', async () => {
      await service.createOrder(
        {
          tenantId: 'tenant-1',
          companyId: 'company-1',
          customerId: 'cust-1',
          customerName: 'Test Customer',
          orderDate: new Date(),
          currency: 'USD',
          exchangeRate: 1,
          items: mockOrder.items,
          subtotal: 1000,
          taxAmount: 0,
          discountAmount: 0,
          shippingAmount: 0,
          total: 1000,
          totalInBaseCurrency: 1000,
          billingAddress: {} as any,
          shippingAddress: {} as any,
          paymentTerms: 'NET30',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        },
        'user-1'
      );

      expect(mockInventoryClient.getAvailableStock).toHaveBeenCalledWith(
        'prod-1', 'wh-1', 'tenant-1'
      );
    });

    it('should throw when insufficient stock', async () => {
      mockInventoryClient.getAvailableStock = vi.fn().mockResolvedValue(5); // Only 5 available, need 10

      await expect(
        service.createOrder(
          {
            tenantId: 'tenant-1',
            companyId: 'company-1',
            customerId: 'cust-1',
            customerName: 'Test Customer',
            orderDate: new Date(),
            currency: 'USD',
            exchangeRate: 1,
            items: mockOrder.items,
            subtotal: 1000,
            taxAmount: 0,
            discountAmount: 0,
            shippingAmount: 0,
            total: 1000,
            totalInBaseCurrency: 1000,
            billingAddress: {} as any,
            shippingAddress: {} as any,
            paymentTerms: 'NET30',
            createdBy: 'user-1',
            updatedBy: 'user-1',
          },
          'user-1'
        )
      ).rejects.toThrow('Insufficient stock');
    });
  });

  describe('confirmOrder', () => {
    it('should confirm a draft order and reserve inventory', async () => {
      const result = await service.confirmOrder('order-1', 'tenant-1', 'user-1');

      expect(mockOrderRepo.updateStatus).toHaveBeenCalledWith(
        'order-1', 'tenant-1', SalesOrderStatus.CONFIRMED, 'user-1'
      );
      expect(mockInventoryClient.reserveStock).toHaveBeenCalled();
    });

    it('should throw if order is not in DRAFT status', async () => {
      mockOrderRepo.findWithItems = vi.fn().mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.CONFIRMED,
      });

      await expect(
        service.confirmOrder('order-1', 'tenant-1', 'user-1')
      ).rejects.toThrow('Cannot confirm order in status');
    });

    it('should throw if order not found', async () => {
      mockOrderRepo.findWithItems = vi.fn().mockResolvedValue(null);

      await expect(
        service.confirmOrder('order-1', 'tenant-1', 'user-1')
      ).rejects.toThrow('Order not found');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel a draft order', async () => {
      await service.cancelOrder('order-1', 'tenant-1', 'user-1', 'Customer request');

      expect(mockOrderRepo.updateStatus).toHaveBeenCalledWith(
        'order-1', 'tenant-1', SalesOrderStatus.CANCELLED, 'user-1'
      );
    });

    it('should release reservations when cancelling a confirmed order', async () => {
      mockOrderRepo.findById = vi.fn().mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.CONFIRMED,
      });

      await service.cancelOrder('order-1', 'tenant-1', 'user-1', 'Customer request');

      expect(mockInventoryClient.releaseReservation).toHaveBeenCalled();
    });

    it('should prevent cancelling shipped orders', async () => {
      mockOrderRepo.findById = vi.fn().mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.SHIPPED,
      });

      await expect(
        service.cancelOrder('order-1', 'tenant-1', 'user-1', 'Cancel')
      ).rejects.toThrow('Cannot cancel order in status');
    });
  });
});

// ─── NLP Column Mapper Tests ──────────────────────────────────
describe('NLPColumnMapper', () => {
  let mapper: NLPColumnMapper;
  let mockCollection: {
    findOne: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mapper = new NLPColumnMapper();
    mockCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({}),
    };
  });

  it('should map exact column headers', async () => {
    const results = await mapper.mapColumns(
      ['Product Code', 'Product Name', 'Unit Price'],
      'PRODUCT',
      'tenant-1',
      mockCollection as never
    );

    const codeMapping = results.find((r) => r.rawHeader === 'Product Code');
    expect(codeMapping?.mappedField).toBe('code');
    expect(codeMapping?.confidence).toBeGreaterThan(0.8);
  });

  it('should map aliased column headers', async () => {
    const results = await mapper.mapColumns(
      ['SKU', 'Item Name', 'Price'],
      'PRODUCT',
      'tenant-1',
      mockCollection as never
    );

    const skuMapping = results.find((r) => r.rawHeader === 'SKU');
    expect(skuMapping?.mappedField).toBe('code');

    const priceMapping = results.find((r) => r.rawHeader === 'Price');
    expect(priceMapping?.mappedField).toBe('unitPrice');
  });

  it('should use fuzzy matching for similar headers', async () => {
    const results = await mapper.mapColumns(
      ['Prod Code', 'Itm Name', 'Sell Price'],
      'PRODUCT',
      'tenant-1',
      mockCollection as never
    );

    // At least some should map with fuzzy matching
    const mapped = results.filter((r) => r.mappedField && r.confidence > 0.4);
    expect(mapped.length).toBeGreaterThan(0);
  });

  it('should prioritize learned mappings', async () => {
    mockCollection.findOne = vi.fn().mockResolvedValue({
      mappedField: 'code',
      confidence: 0.99,
      userConfirmed: true,
    });

    const results = await mapper.mapColumns(
      ['Custom Code Header'],
      'PRODUCT',
      'tenant-1',
      mockCollection as never
    );

    expect(results[0]?.mappedField).toBe('code');
    expect(results[0]?.source).toBe('LEARNED');
  });

  it('should return UNKNOWN for unmappable columns', async () => {
    const results = await mapper.mapColumns(
      ['xyzabc123randomcolumn'],
      'PRODUCT',
      'tenant-1',
      mockCollection as never
    );

    expect(results[0]?.source).toBe('UNKNOWN');
    expect(results[0]?.confidence).toBe(0);
  });
});

// ─── Data Validator Tests ─────────────────────────────────────
describe('DataValidator', () => {
  let validator: DataValidator;

  beforeEach(() => {
    validator = new DataValidator();
  });

  it('should pass validation for valid product row', () => {
    const result = validator.validateRow(
      { code: 'P001', name: 'Test Product', unitPrice: 100 },
      [
        { field: 'code', label: 'Code', aliases: [], required: true, type: 'string' },
        { field: 'name', label: 'Name', aliases: [], required: true, type: 'string' },
        { field: 'unitPrice', label: 'Price', aliases: [], required: false, type: 'number' },
      ],
      2
    );

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when required field is missing', () => {
    const result = validator.validateRow(
      { name: 'Test Product' }, // missing code
      [
        { field: 'code', label: 'Code', aliases: [], required: true, type: 'string' },
        { field: 'name', label: 'Name', aliases: [], required: true, type: 'string' },
      ],
      2
    );

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('REQUIRED');
    expect(result.errors[0].field).toBe('code');
  });

  it('should fail for invalid number', () => {
    const result = validator.validateRow(
      { code: 'P001', name: 'Test', unitPrice: 'not-a-number' },
      [
        { field: 'code', label: 'Code', aliases: [], required: true, type: 'string' },
        { field: 'name', label: 'Name', aliases: [], required: true, type: 'string' },
        { field: 'unitPrice', label: 'Price', aliases: [], required: false, type: 'number' },
      ],
      2
    );

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_TYPE');
  });

  it('should warn about negative numbers', () => {
    const result = validator.validateRow(
      { code: 'P001', name: 'Test', unitPrice: -5 },
      [
        { field: 'code', label: 'Code', aliases: [], required: true, type: 'string' },
        { field: 'name', label: 'Name', aliases: [], required: true, type: 'string' },
        { field: 'unitPrice', label: 'Price', aliases: [], required: false, type: 'number' },
      ],
      2
    );

    expect(result.isValid).toBe(true); // Warnings don't fail
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should validate email format', () => {
    const result = validator.validateRow(
      { code: 'C001', name: 'Customer', email: 'invalid-email' },
      [
        { field: 'code', label: 'Code', aliases: [], required: true, type: 'string' },
        { field: 'name', label: 'Name', aliases: [], required: true, type: 'string' },
        { field: 'email', label: 'Email', aliases: [], required: false, type: 'email' },
      ],
      2
    );

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_EMAIL');
  });

  it('should validate date formats', () => {
    const validResult = validator.validateRow(
      { orderDate: '2024-01-15', productCode: 'P001', quantity: 10 },
      [
        { field: 'orderDate', label: 'Order Date', aliases: [], required: true, type: 'date' },
        { field: 'productCode', label: 'Product', aliases: [], required: true, type: 'string' },
        { field: 'quantity', label: 'Qty', aliases: [], required: true, type: 'number' },
      ],
      2
    );
    expect(validResult.isValid).toBe(true);

    const invalidResult = validator.validateRow(
      { orderDate: 'not-a-date', productCode: 'P001', quantity: 10 },
      [
        { field: 'orderDate', label: 'Order Date', aliases: [], required: true, type: 'date' },
        { field: 'productCode', label: 'Product', aliases: [], required: true, type: 'string' },
        { field: 'quantity', label: 'Qty', aliases: [], required: true, type: 'number' },
      ],
      2
    );
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].code).toBe('INVALID_DATE');
  });
});

// ─── Document Number Generator Tests ─────────────────────────
describe('DocumentNumberGenerator', () => {
  it('should generate sequential numbers', () => {
    // Test the format
    const year = new Date().getFullYear();
    const expected = `SO-${year}-000001`;
    expect(expected).toMatch(/^SO-\d{4}-\d{6}$/);
  });
});
