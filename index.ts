// ============================================================
// @erp/types - Shared type definitions across all services
// ============================================================

// ─── Base Entity ────────────────────────────────────────────
export interface BaseEntity {
  id: string;
  tenantId: string;
  companyId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  isDeleted: boolean;
  version: number; // Optimistic locking
}

// ─── Tenant & Company ────────────────────────────────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: SubscriptionPlan;
  status: TenantStatus;
  settings: TenantSettings;
  billingInfo: BillingInfo;
  storageUsedBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Company extends BaseEntity {
  name: string;
  code: string;
  taxId: string;
  address: Address;
  defaultCurrency: string;
  fiscalYearStart: number; // month 1-12
  logo?: string;
  settings: CompanySettings;
}

export interface TenantSettings {
  maxCompanies: number;
  maxUsers: number;
  maxStorageBytes: number;
  enabledModules: ERP_MODULE[];
  features: Record<string, boolean>;
}

export interface CompanySettings {
  dateFormat: string;
  numberFormat: string;
  decimalPlaces: number;
  autoApprove: boolean;
  requireApproval: string[]; // document types
}

export interface BillingInfo {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  planStartDate: Date;
  planEndDate?: Date;
  paymentMethod?: string;
}

export enum SubscriptionPlan {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRIAL = 'TRIAL',
  CANCELLED = 'CANCELLED',
}

export enum ERP_MODULE {
  SALES = 'SALES',
  PURCHASE = 'PURCHASE',
  INVENTORY = 'INVENTORY',
  PRODUCTION = 'PRODUCTION',
  ACCOUNTING = 'ACCOUNTING',
  CASHFLOW = 'CASHFLOW',
  HR = 'HR',
}

// ─── User & Auth ─────────────────────────────────────────────
export interface User extends BaseEntity {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  roles: Role[];
  permissions: Permission[];
  isActive: boolean;
  lastLoginAt?: Date;
  mfaEnabled: boolean;
  mfaSecret?: string;
  preferredLanguage: string;
  timezone: string;
}

export interface Role {
  id: string;
  name: string;
  code: string;
  tenantId: string;
  permissions: Permission[];
  isSystem: boolean;
}

export interface Permission {
  module: ERP_MODULE | string;
  actions: PermissionAction[];
  conditions?: PermissionCondition[];
}

export enum PermissionAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
}

export interface PermissionCondition {
  field: string;
  operator: 'eq' | 'in' | 'gt' | 'lt';
  value: unknown;
}

export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  companyId: string;
  roles: string[];
  permissions: string[];
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─── Common Types ────────────────────────────────────────────
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: Date;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface SortOption {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterOption {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'between';
  value: unknown;
}

export interface QueryParams {
  page?: number;
  pageSize?: number;
  sort?: SortOption[];
  filters?: FilterOption[];
  search?: string;
  include?: string[];
}

// ─── Audit & Memo ────────────────────────────────────────────
export interface AuditLog {
  id: string;
  tenantId: string;
  companyId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  userId: string;
  userName: string;
  changes?: FieldChange[];
  metadata?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  EXPORT = 'EXPORT',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
}

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface Memo {
  id: string;
  tenantId: string;
  companyId: string;
  entityType: string;
  entityId: string;
  content: string;
  attachments: Attachment[];
  mentions: string[]; // user IDs
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  isInternal: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
}

// ─── Custom Fields ───────────────────────────────────────────
export interface CustomField {
  id: string;
  tenantId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  options?: string[]; // For select/multi-select
  isRequired: boolean;
  defaultValue?: unknown;
  validationRules?: ValidationRule[];
  sortOrder: number;
}

export enum CustomFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  BOOLEAN = 'BOOLEAN',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  URL = 'URL',
  EMAIL = 'EMAIL',
}

export interface ValidationRule {
  type: 'min' | 'max' | 'regex' | 'custom';
  value: unknown;
  message: string;
}

export interface CustomFieldValue {
  customFieldId: string;
  entityId: string;
  value: unknown;
}

// ─── Approval Workflow ───────────────────────────────────────
export interface ApprovalWorkflow {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  entityType: string;
  conditions: ApprovalCondition[];
  steps: ApprovalStep[];
  isActive: boolean;
}

export interface ApprovalCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface ApprovalStep {
  stepNumber: number;
  name: string;
  approverType: 'USER' | 'ROLE' | 'MANAGER';
  approverIds: string[];
  isParallel: boolean;
  timeoutHours?: number;
  onTimeout: 'ESCALATE' | 'AUTO_APPROVE' | 'AUTO_REJECT';
}

export interface ApprovalRequest extends BaseEntity {
  workflowId: string;
  entityType: string;
  entityId: string;
  currentStep: number;
  status: ApprovalStatus;
  requestedBy: string;
  comments?: ApprovalComment[];
}

export interface ApprovalComment {
  userId: string;
  userName: string;
  comment: string;
  action: 'APPROVE' | 'REJECT' | 'COMMENT';
  timestamp: Date;
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

// ─── Sales Module ────────────────────────────────────────────
export interface SalesOrder extends BaseEntity {
  orderNumber: string;
  orderDate: Date;
  customerId: string;
  customerName: string;
  status: SalesOrderStatus;
  currency: string;
  exchangeRate: number;
  items: SalesOrderItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  shippingAmount: number;
  total: number;
  totalInBaseCurrency: number;
  billingAddress: Address;
  shippingAddress: Address;
  paymentTerms: string;
  expectedDeliveryDate?: Date;
  notes?: string;
  approvalStatus: ApprovalStatus;
  shipments?: Shipment[];
  invoices?: Invoice[];
  customFields?: Record<string, unknown>;
}

export interface SalesOrderItem {
  id: string;
  lineNumber: number;
  productId: string;
  productCode: string;
  productName: string;
  description?: string;
  quantity: number;
  unitId: string;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  warehouseId?: string;
  deliveredQty: number;
  invoicedQty: number;
}

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  PARTIALLY_SHIPPED = 'PARTIALLY_SHIPPED',
  SHIPPED = 'SHIPPED',
  PARTIALLY_INVOICED = 'PARTIALLY_INVOICED',
  INVOICED = 'INVOICED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export interface Shipment extends BaseEntity {
  shipmentNumber: string;
  salesOrderId: string;
  shipmentDate: Date;
  status: ShipmentStatus;
  warehouseId: string;
  carrier?: string;
  trackingNumber?: string;
  items: ShipmentItem[];
  notes?: string;
}

export interface ShipmentItem {
  id: string;
  salesOrderItemId: string;
  productId: string;
  quantity: number;
  lotNumber?: string;
  serialNumbers?: string[];
}

export enum ShipmentStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  RETURNED = 'RETURNED',
}

export interface Invoice extends BaseEntity {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  salesOrderId?: string;
  customerId: string;
  status: InvoiceStatus;
  currency: string;
  exchangeRate: number;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentTerms: string;
  notes?: string;
}

export interface InvoiceItem {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

// ─── Purchase Module ─────────────────────────────────────────
export interface PurchaseOrder extends BaseEntity {
  orderNumber: string;
  orderDate: Date;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  currency: string;
  exchangeRate: number;
  items: PurchaseOrderItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  paymentTerms: string;
  expectedDeliveryDate?: Date;
  approvalStatus: ApprovalStatus;
  notes?: string;
  customFields?: Record<string, unknown>;
}

export interface PurchaseOrderItem {
  id: string;
  lineNumber: number;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitId: string;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  warehouseId: string;
  receivedQty: number;
  invoicedQty: number;
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  CONFIRMED = 'CONFIRMED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  INVOICED = 'INVOICED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

// ─── Inventory Module ────────────────────────────────────────
export interface Product extends BaseEntity {
  code: string;
  name: string;
  description?: string;
  categoryId: string;
  unitId: string;
  productType: ProductType;
  trackingMethod: TrackingMethod;
  purchasePrice: number;
  salePrice: number;
  minStockLevel: number;
  maxStockLevel: number;
  reorderPoint: number;
  reorderQty: number;
  leadTimeDays: number;
  weight?: number;
  dimensions?: Dimensions;
  barcode?: string;
  isActive: boolean;
  customFields?: Record<string, unknown>;
}

export enum ProductType {
  FINISHED_GOODS = 'FINISHED_GOODS',
  RAW_MATERIAL = 'RAW_MATERIAL',
  SEMI_FINISHED = 'SEMI_FINISHED',
  CONSUMABLE = 'CONSUMABLE',
  SERVICE = 'SERVICE',
  ASSET = 'ASSET',
}

export enum TrackingMethod {
  NONE = 'NONE',
  LOT = 'LOT',
  SERIAL = 'SERIAL',
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: 'cm' | 'inch';
}

export interface Warehouse extends BaseEntity {
  code: string;
  name: string;
  address: Address;
  managerId?: string;
  isActive: boolean;
  locations: WarehouseLocation[];
}

export interface WarehouseLocation {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  bin?: string;
  isActive: boolean;
}

export interface StockMovement extends BaseEntity {
  movementNumber: string;
  movementType: MovementType;
  productId: string;
  fromWarehouseId?: string;
  fromLocationId?: string;
  toWarehouseId?: string;
  toLocationId?: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceType?: string; // 'SALES_ORDER', 'PURCHASE_ORDER', etc.
  referenceId?: string;
  lotNumber?: string;
  serialNumbers?: string[];
  notes?: string;
}

export enum MovementType {
  RECEIPT = 'RECEIPT',
  SHIPMENT = 'SHIPMENT',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
  PRODUCTION_IN = 'PRODUCTION_IN',
  PRODUCTION_OUT = 'PRODUCTION_OUT',
  RETURN_IN = 'RETURN_IN',
  RETURN_OUT = 'RETURN_OUT',
}

export interface StockBalance {
  productId: string;
  warehouseId: string;
  locationId?: string;
  lotNumber?: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  averageCost: number;
  totalValue: number;
  lastMovementDate: Date;
}

// ─── Production Module ───────────────────────────────────────
export interface BillOfMaterials extends BaseEntity {
  code: string;
  name: string;
  productId: string;
  version: number;
  isActive: boolean;
  quantity: number; // output quantity per BOM
  unitId: string;
  components: BOMComponent[];
  operations: BOMOperation[];
  notes?: string;
}

export interface BOMComponent {
  id: string;
  componentProductId: string;
  quantity: number;
  unitId: string;
  scrapPercent: number;
  isOptional: boolean;
  substituteProductIds?: string[];
}

export interface BOMOperation {
  id: string;
  sequence: number;
  name: string;
  workCenterId: string;
  setupTimeMinutes: number;
  runTimeMinutes: number; // per unit
  laborCostPerHour: number;
  machineCostPerHour: number;
}

export interface WorkOrder extends BaseEntity {
  orderNumber: string;
  productId: string;
  bomId: string;
  warehouseId: string;
  plannedQty: number;
  completedQty: number;
  scrapQty: number;
  status: WorkOrderStatus;
  plannedStartDate: Date;
  plannedEndDate: Date;
  actualStartDate?: Date;
  actualEndDate?: Date;
  operations: WorkOrderOperation[];
  materialConsumptions: MaterialConsumption[];
  notes?: string;
}

export interface WorkOrderOperation {
  id: string;
  bomOperationId: string;
  sequence: number;
  name: string;
  workCenterId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  plannedQty: number;
  completedQty: number;
  plannedTimeMinutes: number;
  actualTimeMinutes?: number;
}

export interface MaterialConsumption {
  id: string;
  componentProductId: string;
  plannedQty: number;
  actualQty: number;
  lotNumber?: string;
}

export enum WorkOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// ─── Accounting Module ───────────────────────────────────────
export interface Account extends BaseEntity {
  code: string;
  name: string;
  accountType: AccountType;
  parentId?: string;
  currency: string;
  isHeader: boolean;
  isActive: boolean;
  openingBalance: number;
  currentBalance: number;
  description?: string;
}

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
  COST_OF_GOODS = 'COST_OF_GOODS',
}

export interface JournalEntry extends BaseEntity {
  entryNumber: string;
  entryDate: Date;
  description: string;
  referenceType?: string;
  referenceId?: string;
  status: JournalStatus;
  currency: string;
  exchangeRate: number;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
}

export interface JournalLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  description?: string;
  debit: number;
  credit: number;
  debitInBaseCurrency: number;
  creditInBaseCurrency: number;
  costCenterId?: string;
  projectId?: string;
  partnerId?: string;
}

export enum JournalStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}

// ─── API Response Wrappers ───────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: ApiError[];
  meta?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
}

// ─── Dashboard KPI ───────────────────────────────────────────
export interface DashboardKPI {
  totalRevenue: Money;
  revenueGrowth: number; // percentage
  totalOrders: number;
  pendingOrders: number;
  totalPurchases: Money;
  inventoryValue: Money;
  lowStockProducts: number;
  accountsReceivable: Money;
  accountsPayable: Money;
  cashBalance: Money;
  grossMargin: number;
  netProfit: Money;
  activeWorkOrders: number;
}

// ─── Event Types for Message Bus ─────────────────────────────
export type ERPEvent =
  | { type: 'SALES_ORDER_CREATED'; payload: SalesOrder }
  | { type: 'SALES_ORDER_APPROVED'; payload: { orderId: string; approvedBy: string } }
  | { type: 'SHIPMENT_CONFIRMED'; payload: Shipment }
  | { type: 'INVOICE_PAID'; payload: { invoiceId: string; amount: number } }
  | { type: 'PURCHASE_ORDER_CREATED'; payload: PurchaseOrder }
  | { type: 'STOCK_MOVEMENT_CREATED'; payload: StockMovement }
  | { type: 'WORK_ORDER_COMPLETED'; payload: WorkOrder }
  | { type: 'LOW_STOCK_ALERT'; payload: { productId: string; currentQty: number; reorderPoint: number } }
  | { type: 'JOURNAL_POSTED'; payload: JournalEntry }
  | { type: 'APPROVAL_REQUESTED'; payload: ApprovalRequest }
  | { type: 'APPROVAL_COMPLETED'; payload: { requestId: string; status: ApprovalStatus } };
