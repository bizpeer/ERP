// ============================================================
// @erp/database - Base Repository Pattern Implementation
// ============================================================
import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';
import {
  BaseEntity,
  QueryParams,
  PaginatedResponse,
  AuditLog,
  AuditAction,
  FilterOption,
  SortOption,
  FieldChange
} from './index';
import { AuditService } from './audit.service';

// ─── Database Connection Pool ────────────────────────────────
let pgPool: Pool | null = null;

export function createPool(connectionString: string): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pgPool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pgPool;
}

export function getPool(): Pool {
  if (!pgPool) throw new Error('Database pool not initialized');
  return pgPool;
}

// ─── Transaction Manager ─────────────────────────────────────
export class TransactionManager {
  private client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  static async begin(pool: Pool): Promise<TransactionManager> {
    const client = await pool.connect();
    await client.query('BEGIN');
    return new TransactionManager(client);
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
    this.client.release();
  }

  async rollback(): Promise<void> {
    await this.client.query('ROLLBACK');
    this.client.release();
  }

  getClient(): PoolClient {
    return this.client;
  }
}

// ─── Query Builder ───────────────────────────────────────────
export class QueryBuilder {
  private table: string;
  private conditions: string[] = [];
  private params: unknown[] = [];
  private paramIndex = 1;
  private orderBy: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private selectColumns = '*';
  private joinClauses: string[] = [];

  constructor(table: string) {
    this.table = table;
  }

  select(columns: string): this {
    this.selectColumns = columns;
    return this;
  }

  join(clause: string): this {
    this.joinClauses.push(clause);
    return this;
  }

  where(condition: string, value?: unknown): this {
    if (value !== undefined) {
      this.conditions.push(condition.replace('?', `$${this.paramIndex++}`));
      this.params.push(value);
    } else {
      this.conditions.push(condition);
    }
    return this;
  }

  whereIn(column: string, values: unknown[]): this {
    if (values.length === 0) {
      this.conditions.push('FALSE');
      return this;
    }
    const placeholders = values.map(() => `$${this.paramIndex++}`).join(', ');
    this.conditions.push(`${column} IN (${placeholders})`);
    this.params.push(...values);
    return this;
  }

  applyFilters(filters: FilterOption[]): this {
    for (const filter of filters) {
      switch (filter.operator) {
        case 'eq':
          this.where(`${filter.field} = ?`, filter.value);
          break;
        case 'ne':
          this.where(`${filter.field} != ?`, filter.value);
          break;
        case 'gt':
          this.where(`${filter.field} > ?`, filter.value);
          break;
        case 'gte':
          this.where(`${filter.field} >= ?`, filter.value);
          break;
        case 'lt':
          this.where(`${filter.field} < ?`, filter.value);
          break;
        case 'lte':
          this.where(`${filter.field} <= ?`, filter.value);
          break;
        case 'like':
          this.where(`${filter.field} ILIKE ?`, `%${filter.value}%`);
          break;
        case 'in':
          this.whereIn(filter.field, filter.value as unknown[]);
          break;
        case 'between': {
          const [from, to] = filter.value as [unknown, unknown];
          this.where(`${filter.field} BETWEEN ? AND ?`, from);
          this.params.push(to);
          this.paramIndex++;
          break;
        }
      }
    }
    return this;
  }

  applySorts(sorts: SortOption[]): this {
    for (const sort of sorts) {
      this.orderBy.push(`${sort.field} ${sort.direction.toUpperCase()}`);
    }
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  buildSelect(): { text: string; values: unknown[] } {
    let sql = `SELECT ${this.selectColumns} FROM ${this.table}`;

    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }

    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(' AND ')}`;
    }

    if (this.orderBy.length > 0) {
      sql += ` ORDER BY ${this.orderBy.join(', ')}`;
    }

    if (this.limitValue !== undefined) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    if (this.offsetValue !== undefined) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return { text: sql, values: this.params };
  }

  buildCount(): { text: string; values: unknown[] } {
    let sql = `SELECT COUNT(*) as total FROM ${this.table}`;

    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }

    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(' AND ')}`;
    }

    return { text: sql, values: this.params };
  }
}

// ─── Base Repository ─────────────────────────────────────────
export abstract class BaseRepository<T extends BaseEntity> {
  constructor(
    protected pool: Pool,
    protected redis: Redis,
    protected tableName: string,
    protected cachePrefix: string,
    protected ttl: number = 3600,
    protected auditService?: AuditService
  ) { }

  protected getCacheKey(id: string, tenantId: string): string {
    return `${this.cachePrefix}:${tenantId}:${id}`;
  }

  protected getListCacheKey(tenantId: string, params?: string): string {
    return `${this.cachePrefix}:list:${tenantId}${params ? ':' + params : ''}`;
  }

  /**
   * Records a change in the audit trail
   */
  protected async trackChanges(
    entityId: string,
    tenantId: string,
    userId: string,
    action: AuditLog['action'],
    oldData?: Partial<T>,
    newData?: Partial<T>
  ): Promise<void> {
    if (!this.auditService) return;

    try {
      await this.auditService.log({
        tenantId,
        companyId: (newData as any)?.companyId || (oldData as any)?.companyId || '',
        userId,
        userName: '', // To be looked up or passed
        entityId,
        entityType: this.tableName.toUpperCase(),
        action,
        changes: this.getDiffFromData(oldData, newData),
        ipAddress: '',
        userAgent: '',
      });
    } catch (error) {
      console.error('Audit logging failed:', error);
    }
  }

  async findById(id: string, tenantId: string): Promise<T | null> {
    const cacheKey = this.getCacheKey(id, tenantId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;

    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} 
       WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE`,
      [id, tenantId]
    );

    if (result.rows.length === 0) return null;

    const entity = this.mapToEntity(result.rows[0]);
    await this.redis.setex(cacheKey, this.ttl, JSON.stringify(entity));
    return entity;
  }

  async findAll(
    tenantId: string,
    companyId: string,
    params: QueryParams = {}
  ): Promise<PaginatedResponse<T>> {
    const {
      page = 1,
      pageSize = 20,
      sort = [],
      filters = [],
      search,
    } = params;

    const qb = new QueryBuilder(this.tableName)
      .where('tenant_id = ?', tenantId)
      .where('company_id = ?', companyId)
      .where('is_deleted = FALSE')
      .applyFilters(filters)
      .applySorts(sort.length ? sort : [{ field: 'created_at', direction: 'desc' }]);

    if (search) {
      this.applySearch(qb, search);
    }

    const countQuery = qb.buildCount();
    const countResult = await this.pool.query(countQuery.text, countQuery.values);
    const total = parseInt(countResult.rows[0].total, 10);

    qb.limit(pageSize).offset((page - 1) * pageSize);
    const dataQuery = qb.buildSelect();
    const dataResult = await this.pool.query(dataQuery.text, dataQuery.values);

    return {
      data: dataResult.rows.map(this.mapToEntity.bind(this)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'version'>,
    userId: string,
    client?: PoolClient
  ): Promise<T> {
    const db = client || this.pool;
    const { columns, values, placeholders } = this.buildInsertData(data);

    const result = await db.query(
      `INSERT INTO ${this.tableName} (${columns.join(', ')}, created_by, updated_by, created_at, updated_at, is_deleted, version)
       VALUES (${placeholders.join(', ')}, $${placeholders.length + 1}, $${placeholders.length + 2}, NOW(), NOW(), FALSE, 1)
       RETURNING *`,
      [...values, userId, userId]
    );

    const entity = this.mapToEntity(result.rows[0]);
    await this.invalidateCache(data.tenantId);

    await this.trackChanges(entity.id, (data as any).tenantId, userId, AuditAction.CREATE, undefined, entity);

    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<T>,
    userId: string,
    isAdmin: boolean = false, // 관리자 권한 여부 추가
    client?: PoolClient
  ): Promise<T | null> {
    const db = client || this.pool;
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;

    // ─── Windows 로컬망 보안 정책: 1시간 수정 제한 ───
    this.checkTimeLimit(existing, isAdmin);

    const { setClause, values } = this.buildUpdateData(data);

    const result = await db.query(
      `UPDATE ${this.tableName}
       SET ${setClause}, updated_by = $${values.length + 1}, updated_at = NOW(), version = version + 1
       WHERE id = $${values.length + 2} AND tenant_id = $${values.length + 3} AND is_deleted = FALSE
       RETURNING *`,
      [...values, userId, id, tenantId]
    );

    if (result.rows.length === 0) return null;

    const entity = this.mapToEntity(result.rows[0]);
    await this.invalidateCache(tenantId, id);

    const changes = this.getDiff(existing, entity);
    if (changes.length > 0) {
      await this.trackChanges(id, tenantId, userId, AuditAction.UPDATE, existing as Partial<T>, entity as Partial<T>);
    }

    return entity;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    isAdmin: boolean = false, // 관리자 권한 여부 추가
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || this.pool;
    const existing = await this.findById(id, tenantId);
    if (!existing) return false;

    // ─── Windows 로컬망 보안 정책: 1시간 수정 제한 ───
    this.checkTimeLimit(existing, isAdmin);

    const result = await db.query(
      `UPDATE ${this.tableName}
       SET is_deleted = TRUE, deleted_by = $1, deleted_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $2 AND tenant_id = $3 AND is_deleted = FALSE`,
      [userId, id, tenantId]
    );

    if (result.rowCount === 0) return false;

    await this.invalidateCache(tenantId, id);
    await this.trackChanges(id, tenantId, userId, AuditAction.DELETE, existing as Partial<T>, undefined);

    return true;
  }

  protected checkTimeLimit(existing: T, isAdmin: boolean): void {
    const oneHour = 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(existing.createdAt).getTime();

    if (elapsed > oneHour && !isAdmin) {
      throw new Error('데이터 생성 후 1시간이 경과하여 수정/삭제가 불가능합니다. 관리자의 승인이 필요합니다.');
    }
  }

  protected async invalidateCache(tenantId: string, id?: string): Promise<void> {
    const patterns = [`${this.cachePrefix}:list:${tenantId}*`];
    if (id) patterns.push(this.getCacheKey(id, tenantId));

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) await this.redis.del(...keys);
    }
  }

  private getDiff(before: T, after: T): FieldChange[] {
    return this.getDiffFromData(before as Partial<T>, after as Partial<T>);
  }

  private getDiffFromData(before?: Partial<T>, after?: Partial<T>): FieldChange[] {
    if (!before || !after) return [];
    const changes: FieldChange[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of keys) {
      if (['updatedAt', 'updatedBy', 'version', 'createdAt', 'createdBy'].includes(key)) continue;

      const valBefore = (before as any)[key];
      const valAfter = (after as any)[key];

      if (valBefore !== valAfter) {
        changes.push({
          field: key,
          oldValue: valBefore,
          newValue: valAfter,
        });
      }
    }
    return changes;
  }

  private buildInsertData(data: Record<string, unknown>): {
    columns: string[];
    values: unknown[];
    placeholders: string[];
  } {
    const columns: string[] = [];
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        columns.push(this.toSnakeCase(key));
        values.push(value);
        placeholders.push(`$${idx++}`);
      }
    }

    return { columns, values, placeholders };
  }

  private buildUpdateData(data: Record<string, unknown>): {
    setClause: string;
    values: unknown[];
  } {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && !['id', 'tenantId', 'createdAt', 'createdBy'].includes(key)) {
        sets.push(`${this.toSnakeCase(key)} = $${idx++}`);
        values.push(value);
      }
    }

    return { setClause: sets.join(', '), values };
  }

  protected toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  protected toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  // Override in subclasses for search functionality
  protected applySearch(qb: QueryBuilder, search: string): void {
  }

  protected abstract mapToEntity(row: Record<string, unknown>): T;
}

// ─── Cache Service ───────────────────────────────────────────
export class CacheService {
  constructor(private redis: Redis) { }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttl = 300): Promise<void> {
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async remember<T>(
    key: string,
    ttl: number,
    factory: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }
}
