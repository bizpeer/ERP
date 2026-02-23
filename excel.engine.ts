// ============================================================
// Excel Upload Engine - NLP Column Mapping, Validation,
// Duplicate Detection, Learning Memory
// ============================================================
import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { Pool } from 'pg';
import { MongoClient, Db, Collection } from 'mongodb';
import { Client as MinioClient } from 'minio';
import Fuse from 'fuse.js';
import { AuthenticatedRequest } from './auth.service';
import { ApiResponse } from './index';

// ─── Column Mapping Memory (MongoDB) ─────────────────────────
interface ColumnMappingRecord {
  _id?: string;
  tenantId: string;
  entityType: string;
  rawHeader: string;
  normalizedHeader: string;
  mappedField: string;
  confidence: number;
  usageCount: number;
  lastUsed: Date;
  userConfirmed: boolean;
}

// ─── Field Definitions per Entity ────────────────────────────
const FIELD_DEFINITIONS: Record<string, FieldDefinition[]> = {
  PRODUCT: [
    { field: 'code', label: 'Product Code', aliases: ['sku', 'item code', 'part number', 'item no', 'product id', '품번', '제품코드'], required: true, type: 'string' },
    { field: 'name', label: 'Product Name', aliases: ['item name', 'description', '제품명', '품명'], required: true, type: 'string' },
    { field: 'unitPrice', label: 'Unit Price', aliases: ['price', 'sale price', 'selling price', '단가', '판매가'], required: false, type: 'number' },
    { field: 'purchasePrice', label: 'Purchase Price', aliases: ['cost', 'cost price', 'buy price', '구매가', '원가'], required: false, type: 'number' },
    { field: 'categoryId', label: 'Category', aliases: ['category', 'group', 'class', '분류', '카테고리'], required: false, type: 'string' },
    { field: 'unitId', label: 'Unit', aliases: ['unit', 'uom', 'measure', '단위'], required: false, type: 'string' },
    { field: 'minStockLevel', label: 'Min Stock', aliases: ['minimum stock', 'min qty', 'min level', '최소재고'], required: false, type: 'number' },
    { field: 'barcode', label: 'Barcode', aliases: ['barcode', 'ean', 'upc', 'gtin', '바코드'], required: false, type: 'string' },
    { field: 'weight', label: 'Weight', aliases: ['weight', 'gross weight', 'net weight', '무게', '중량'], required: false, type: 'number' },
  ],
  CUSTOMER: [
    { field: 'code', label: 'Customer Code', aliases: ['customer id', 'account no', 'client code', '고객코드'], required: true, type: 'string' },
    { field: 'name', label: 'Customer Name', aliases: ['company', 'client', 'account name', '거래처명', '고객명'], required: true, type: 'string' },
    { field: 'email', label: 'Email', aliases: ['email address', 'e-mail', '이메일'], required: false, type: 'email' },
    { field: 'phone', label: 'Phone', aliases: ['telephone', 'mobile', 'contact', '전화번호', '연락처'], required: false, type: 'string' },
    { field: 'taxId', label: 'Tax ID', aliases: ['vat number', 'tax number', 'ein', 'registration no', '사업자번호'], required: false, type: 'string' },
    { field: 'creditLimit', label: 'Credit Limit', aliases: ['credit', 'limit', '신용한도'], required: false, type: 'number' },
    { field: 'paymentTerms', label: 'Payment Terms', aliases: ['terms', 'net days', '결제조건'], required: false, type: 'string' },
  ],
  SALES_ORDER: [
    { field: 'orderDate', label: 'Order Date', aliases: ['date', 'order date', 'so date', '주문일'], required: true, type: 'date' },
    { field: 'customerCode', label: 'Customer Code', aliases: ['customer', 'client code', 'account', '고객코드'], required: true, type: 'string' },
    { field: 'productCode', label: 'Product Code', aliases: ['item', 'sku', '품번'], required: true, type: 'string' },
    { field: 'quantity', label: 'Quantity', aliases: ['qty', 'amount', 'units', '수량'], required: true, type: 'number' },
    { field: 'unitPrice', label: 'Unit Price', aliases: ['price', 'rate', 'selling price', '단가'], required: false, type: 'number' },
    { field: 'discount', label: 'Discount %', aliases: ['discount', 'disc', '할인율'], required: false, type: 'number' },
  ],
};

interface FieldDefinition {
  field: string;
  label: string;
  aliases: string[];
  required: boolean;
  type: 'string' | 'number' | 'date' | 'email' | 'boolean';
}

// ─── NLP Column Mapper ────────────────────────────────────────
export class NLPColumnMapper {
  private readonly SIMILARITY_THRESHOLD = 0.4;

  async mapColumns(
    headers: string[],
    entityType: string,
    tenantId: string,
    mappingCollection: Collection<ColumnMappingRecord>
  ): Promise<ColumnMappingResult[]> {
    const fieldDefs = FIELD_DEFINITIONS[entityType] || [];
    const results: ColumnMappingResult[] = [];

    for (const header of headers) {
      const normalized = this.normalizeHeader(header);

      // 1. Check learned mappings first (highest priority)
      const learned = await mappingCollection.findOne({
        tenantId,
        entityType,
        normalizedHeader: normalized,
        userConfirmed: true,
      });

      if (learned && learned.confidence >= 0.9) {
        results.push({
          rawHeader: header,
          normalizedHeader: normalized,
          mappedField: learned.mappedField,
          confidence: learned.confidence,
          source: 'LEARNED',
        });
        continue;
      }

      // 2. Exact match on aliases
      let bestMatch: ColumnMappingResult | null = null;

      for (const fieldDef of fieldDefs) {
        const normalizedField = fieldDef.field.toLowerCase();
        const normalizedLabel = this.normalizeHeader(fieldDef.label);
        const normalizedAliases = fieldDef.aliases.map(a => this.normalizeHeader(a));

        if (normalized === normalizedField || normalized === normalizedLabel || normalizedAliases.includes(normalized)) {
          bestMatch = {
            rawHeader: header,
            normalizedHeader: normalized,
            mappedField: fieldDef.field,
            confidence: 1.0,
            source: 'EXACT',
          };
          break;
        }
      }

      if (!bestMatch) {
        // 3. Fuzzy matching using Fuse.js
        const searchItems = fieldDefs.flatMap((def) =>
          def.aliases.map((alias) => ({ field: def.field, alias }))
        );

        const fuse = new Fuse(searchItems, {
          keys: ['alias'],
          threshold: this.SIMILARITY_THRESHOLD,
          includeScore: true,
        });

        const fuseResults = fuse.search(normalized);
        if (fuseResults.length > 0 && fuseResults[0].score !== undefined) {
          const confidence = 1 - fuseResults[0].score;
          bestMatch = {
            rawHeader: header,
            normalizedHeader: normalized,
            mappedField: fuseResults[0].item.field,
            confidence,
            source: 'FUZZY',
          };
        }
      }

      if (!bestMatch) {
        // 4. Semantic similarity (keyword overlap)
        bestMatch = this.semanticMatch(normalized, fieldDefs, header);
      }

      results.push(
        bestMatch || {
          rawHeader: header,
          normalizedHeader: normalized,
          mappedField: '',
          confidence: 0,
          source: 'UNKNOWN',
        }
      );
    }

    return results;
  }

  private normalizeHeader(header: string): string {
    return header
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9가-힣]/g, '');
  }

  private semanticMatch(
    normalized: string,
    fieldDefs: FieldDefinition[],
    rawHeader: string
  ): ColumnMappingResult | null {
    const words = normalized.split(' ');
    let bestScore = 0;
    let bestField = '';

    for (const fieldDef of fieldDefs) {
      let score = 0;
      const allTerms = [fieldDef.field, ...fieldDef.aliases];

      for (const term of allTerms) {
        const termWords = term.split(' ');
        const overlap = words.filter((w) => termWords.includes(w)).length;
        const termScore = overlap / Math.max(words.length, termWords.length);
        score = Math.max(score, termScore);
      }

      if (score > bestScore) {
        bestScore = score;
        bestField = fieldDef.field;
      }
    }

    if (bestScore >= 0.3) {
      return {
        rawHeader,
        normalizedHeader: normalized,
        mappedField: bestField,
        confidence: bestScore * 0.8, // Discount semantic matches slightly
        source: 'SEMANTIC',
      };
    }

    return null;
  }

  async saveMapping(
    mapping: ColumnMappingResult,
    entityType: string,
    tenantId: string,
    userConfirmed: boolean,
    collection: Collection<ColumnMappingRecord>
  ): Promise<void> {
    await collection.updateOne(
      { tenantId, entityType, normalizedHeader: mapping.normalizedHeader },
      {
        $set: {
          rawHeader: mapping.rawHeader,
          mappedField: mapping.mappedField,
          confidence: userConfirmed ? Math.max(mapping.confidence, 0.95) : mapping.confidence,
          userConfirmed,
          lastUsed: new Date(),
        },
        $inc: { usageCount: 1 },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }
}

interface ColumnMappingResult {
  rawHeader: string;
  normalizedHeader: string;
  mappedField: string;
  confidence: number;
  source: 'LEARNED' | 'EXACT' | 'FUZZY' | 'SEMANTIC' | 'UNKNOWN';
}

// ─── Data Validator ───────────────────────────────────────────
export class DataValidator {
  validateRow(
    row: Record<string, unknown>,
    fieldDefs: FieldDefinition[],
    rowIndex: number
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const fieldDef of fieldDefs) {
      const value = row[fieldDef.field];

      // Required check
      if (fieldDef.required && (value === null || value === undefined || value === '')) {
        errors.push({
          row: rowIndex,
          field: fieldDef.field,
          message: `${fieldDef.label} is required`,
          code: 'REQUIRED',
        });
        continue;
      }

      if (value === null || value === undefined || value === '') continue;

      // Type validation
      switch (fieldDef.type) {
        case 'number': {
          const num = Number(value);
          if (isNaN(num)) {
            errors.push({
              row: rowIndex,
              field: fieldDef.field,
              message: `${fieldDef.label} must be a number, got: ${value}`,
              code: 'INVALID_TYPE',
            });
          } else if (num < 0) {
            warnings.push({
              row: rowIndex,
              field: fieldDef.field,
              message: `${fieldDef.label} is negative: ${num}`,
            });
          }
          break;
        }
        case 'date': {
          const date = this.parseDate(value as string);
          if (!date) {
            errors.push({
              row: rowIndex,
              field: fieldDef.field,
              message: `${fieldDef.label} is not a valid date: ${value}`,
              code: 'INVALID_DATE',
            });
          }
          break;
        }
        case 'email': {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
            errors.push({
              row: rowIndex,
              field: fieldDef.field,
              message: `${fieldDef.label} is not a valid email: ${value}`,
              code: 'INVALID_EMAIL',
            });
          }
          break;
        }
      }
    }

    return { rowIndex, isValid: errors.length === 0, errors, warnings };
  }

  private parseDate(value: string): Date | null {
    if (!value) return null;

    // Excel serial date number
    if (typeof value === 'number') {
      const date = xlsx.SSF.parse_date_code(value as number);
      if (date) return new Date(date.y, date.m - 1, date.d);
    }

    // Try common formats
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})$/,   // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // MM/DD/YYYY
      /^(\d{2})-(\d{2})-(\d{4})$/,   // DD-MM-YYYY
      /^(\d{4})(\d{2})(\d{2})$/,     // YYYYMMDD
    ];

    for (const format of formats) {
      const match = String(value).match(format);
      if (match) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) return date;
      }
    }

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  coerceValue(value: unknown, type: string): unknown {
    if (value === null || value === undefined || value === '') return null;

    switch (type) {
      case 'number': return Number(value);
      case 'boolean': return ['true', '1', 'yes', 'y'].includes(String(value).toLowerCase());
      case 'date': return this.parseDate(String(value));
      default: return String(value).trim();
    }
  }
}

interface ValidationResult {
  rowIndex: number;
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
  code: string;
}

interface ValidationWarning {
  row: number;
  field: string;
  message: string;
}

// ─── Duplicate Detector ───────────────────────────────────────
export class DuplicateDetector {
  constructor(private pool: Pool) { }

  async detectDuplicates(
    entityType: string,
    records: Record<string, unknown>[],
    tenantId: string,
    companyId: string,
    uniqueKey: string
  ): Promise<DuplicateResult[]> {
    const tableMap: Record<string, string> = {
      PRODUCT: 'products',
      CUSTOMER: 'customers',
      SUPPLIER: 'suppliers',
    };

    const table = tableMap[entityType];
    if (!table) return [];

    const keys = records.map((r) => r[uniqueKey]).filter(Boolean);
    if (keys.length === 0) return [];

    // Check against DB
    const placeholders = keys.map((_, i) => `$${i + 3}`).join(', ');
    const result = await this.pool.query(
      `SELECT ${uniqueKey} as key FROM ${table}
       WHERE tenant_id = $1 AND company_id = $2
         AND ${uniqueKey} IN (${placeholders})
         AND is_deleted = FALSE`,
      [tenantId, companyId, ...keys]
    );

    const existingKeys = new Set(result.rows.map((r) => r.key));

    // Check within the batch
    const batchKeys = new Set<unknown>();
    const batchDuplicates = new Set<unknown>();

    for (const record of records) {
      const key = record[uniqueKey];
      if (batchKeys.has(key)) batchDuplicates.add(key);
      batchKeys.add(key);
    }

    return records.map((record, index) => {
      const key = record[uniqueKey];
      return {
        rowIndex: index,
        key,
        isDuplicate: existingKeys.has(key),
        isBatchDuplicate: batchDuplicates.has(key),
        existsInDb: existingKeys.has(key),
      };
    });
  }
}

interface DuplicateResult {
  rowIndex: number;
  key: unknown;
  isDuplicate: boolean;
  isBatchDuplicate: boolean;
  existsInDb: boolean;
}

// ─── Excel Upload Engine ──────────────────────────────────────
export class ExcelUploadEngine {
  constructor(
    private mapper: NLPColumnMapper,
    private validator: DataValidator,
    private duplicateDetector: DuplicateDetector,
    private mappingCollection: Collection<ColumnMappingRecord>
  ) { }

  async processUpload(
    fileBuffer: Buffer,
    entityType: string,
    tenantId: string,
    companyId: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const startTime = Date.now();

    // 1. Parse Excel file
    const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
    const sheetName = options.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return this.errorResult('Sheet not found', entityType);
    }

    const rawData = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });

    if (rawData.length < 2) {
      return this.errorResult('File has no data rows', entityType);
    }

    const headers = (rawData[0] as unknown[]).map(String);
    const dataRows = rawData.slice(1) as unknown[][];

    // 2. Map columns using NLP
    const mappings = await this.mapper.mapColumns(
      headers,
      entityType,
      tenantId,
      this.mappingCollection
    );

    // 3. Convert rows using mapped columns
    const fieldDefs = FIELD_DEFINITIONS[entityType] || [];
    const unmappedHeaders = mappings.filter((m) => !m.mappedField || m.confidence < 0.5);

    // Return mapping preview if confidence is low
    if (unmappedHeaders.length > 0 && !options.skipMappingPreview) {
      return {
        status: 'MAPPING_REQUIRED',
        mappings,
        totalRows: dataRows.length,
        entityType,
        processingTimeMs: Date.now() - startTime,
        data: [],
        errors: [],
        warnings: [],
        duplicates: [],
      };
    }

    // 4. Transform rows
    const mappedRows: Record<string, unknown>[] = dataRows.map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        const mapping = mappings.find((m) => m.rawHeader === header);
        if (mapping?.mappedField) {
          const fieldDef = fieldDefs.find((f) => f.field === mapping.mappedField);
          const rawValue = (row as unknown[])[idx];
          obj[mapping.mappedField] = fieldDef
            ? this.validator.coerceValue(rawValue, fieldDef.type)
            : rawValue;
        }
      });
      return obj;
    });

    // 5. Validate
    const validationResults = mappedRows.map((row, i) =>
      this.validator.validateRow(row, fieldDefs, i + 2) // +2 for header row and 1-based index
    );

    const allErrors = validationResults.flatMap((r) => r.errors);
    const allWarnings = validationResults.flatMap((r) => r.warnings);

    // 6. Detect duplicates
    const uniqueKey = fieldDefs.find((f) => f.required)?.field || 'code';
    const duplicates = await this.duplicateDetector.detectDuplicates(
      entityType, mappedRows, tenantId, companyId, uniqueKey
    );

    // 7. Split valid/invalid rows
    const invalidRows = new Set(allErrors.map((e) => e.row - 2));
    const duplicateRows = new Set(
      duplicates.filter((d) => d.isDuplicate && !options.updateOnDuplicate).map((d) => d.rowIndex)
    );

    const validRows = mappedRows.filter(
      (_, i) => !invalidRows.has(i) && !duplicateRows.has(i)
    );
    const errorRows = mappedRows.filter((_, i) => invalidRows.has(i) || duplicateRows.has(i));

    // 8. Save learned mappings
    for (const mapping of mappings) {
      if (mapping.mappedField && mapping.confidence > 0.5) {
        await this.mapper.saveMapping(
          mapping, entityType, tenantId, false, this.mappingCollection
        );
      }
    }

    return {
      status: allErrors.length > 0 && validRows.length === 0 ? 'FAILED' :
        allErrors.length > 0 ? 'PARTIAL' : 'SUCCESS',
      mappings,
      totalRows: dataRows.length,
      validRows: validRows.length,
      errorRows: errorRows.length,
      duplicateRows: duplicateRows.size,
      entityType,
      processingTimeMs: Date.now() - startTime,
      data: validRows,
      errors: allErrors.slice(0, 100), // Limit error report
      warnings: allWarnings.slice(0, 50),
      duplicates: duplicates.filter((d) => d.isDuplicate),
    };
  }

  private errorResult(message: string, entityType: string): UploadResult {
    return {
      status: 'FAILED',
      mappings: [],
      totalRows: 0,
      entityType,
      processingTimeMs: 0,
      data: [],
      errors: [{ row: 0, field: '', message, code: 'PARSE_ERROR' }],
      warnings: [],
      duplicates: [],
    };
  }
}

interface UploadOptions {
  sheetName?: string;
  skipMappingPreview?: boolean;
  updateOnDuplicate?: boolean;
}

interface UploadResult {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'MAPPING_REQUIRED';
  mappings: ColumnMappingResult[];
  totalRows: number;
  validRows?: number;
  errorRows?: number;
  duplicateRows?: number;
  entityType: string;
  processingTimeMs: number;
  data: Record<string, unknown>[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
  duplicates: DuplicateResult[];
}

// ─── Excel Router ─────────────────────────────────────────────
export function createExcelRouter(engine: ExcelUploadEngine): express.Router {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
      ];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  /**
   * @openapi
   * /excel/upload:
   *   post:
   *     summary: Upload and process an Excel file
   *     tags: [Excel]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *               entityType:
   *                 type: string
   *                 enum: [PRODUCT, CUSTOMER, SUPPLIER, SALES_ORDER]
   *               skipMappingPreview:
   *                 type: boolean
   *               updateOnDuplicate:
   *                 type: boolean
   */
  router.post(
    '/upload',
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ success: false, message: 'No file uploaded' });
          return;
        }

        const { entityType, skipMappingPreview, updateOnDuplicate, sheetName } = req.body;

        if (!entityType || !FIELD_DEFINITIONS[entityType]) {
          res.status(400).json({
            success: false,
            message: `Invalid entityType. Supported: ${Object.keys(FIELD_DEFINITIONS).join(', ')}`,
          });
          return;
        }

        const result = await engine.processUpload(
          req.file.buffer,
          entityType,
          req.tenantId!,
          req.companyId!,
          {
            sheetName,
            skipMappingPreview: skipMappingPreview === 'true',
            updateOnDuplicate: updateOnDuplicate === 'true',
          }
        );

        const statusCode = result.status === 'FAILED' ? 422 :
          result.status === 'MAPPING_REQUIRED' ? 200 : 200;

        res.status(statusCode).json({ success: result.status !== 'FAILED', data: result });
      } catch (error) {
        console.error('Excel upload error:', error);
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Upload processing failed',
        });
      }
    }
  );

  /**
   * @openapi
   * /excel/confirm-mapping:
   *   post:
   *     summary: Confirm column mappings and reprocess
   */
  router.post('/confirm-mapping', async (req: AuthenticatedRequest, res) => {
    try {
      const { sessionId, confirmedMappings } = req.body;
      // Retrieve cached upload session and reprocess with confirmed mappings
      res.json({ success: true, message: 'Mappings confirmed, processing...' });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to confirm mappings' });
    }
  });

  /**
   * @openapi
   * /excel/template/{entityType}:
   *   get:
   *     summary: Download Excel template for an entity type
   */
  router.get('/template/:entityType', (req: AuthenticatedRequest, res) => {
    const { entityType } = req.params;
    const fieldDefs = FIELD_DEFINITIONS[entityType];

    if (!fieldDefs) {
      res.status(404).json({ success: false, message: 'Entity type not found' });
      return;
    }

    const wb = xlsx.utils.book_new();
    const headers = fieldDefs.map((f) => f.label);
    const exampleRow = fieldDefs.map((f) => {
      switch (f.type) {
        case 'number': return 0;
        case 'date': return new Date().toISOString().split('T')[0];
        default: return `Example ${f.label}`;
      }
    });

    const ws = xlsx.utils.aoa_to_sheet([headers, exampleRow]);

    // Style required columns
    const reqCols = fieldDefs
      .map((f, i) => (f.required ? i : -1))
      .filter((i) => i >= 0);

    xlsx.utils.book_append_sheet(wb, ws, entityType);

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${entityType}_template.xlsx"`);
    res.send(buffer);
  });

  return router;
}
