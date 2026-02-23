// ============================================================
// Accounting Service - Double-Entry Journal, AR/AP, Cash Flow
// ============================================================
import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';
import express from 'express';
import {
  Account, AccountType, JournalEntry, JournalLine, JournalStatus,
  Invoice, InvoiceStatus, QueryParams, PaginatedResponse, Money
} from './index';
import { BaseRepository } from './base.repository';
import { AuthenticatedRequest } from './auth.service';
import { MessageBus } from './message-bus.service';
import { AuditService } from './audit.service';
import { DocumentNumberGenerator } from './document-number.service';

// ─── Account Repository ───────────────────────────────────────
export class AccountRepository extends BaseRepository<Account> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'accounts', 'acc', 3600, auditService);
  }

  async getChartOfAccounts(
    tenantId: string,
    companyId: string
  ): Promise<Account[]> {
    const cacheKey = `acc:coa:${tenantId}:${companyId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.pool.query(
      `WITH RECURSIVE account_tree AS (
        SELECT *, 0 AS level, ARRAY[sort_order]::int[] AS path
        FROM accounts
        WHERE tenant_id = $1 AND company_id = $2 AND parent_id IS NULL AND is_deleted = FALSE
        
        UNION ALL
        
        SELECT a.*, at.level + 1, at.path || a.sort_order
        FROM accounts a
        JOIN account_tree at ON a.parent_id = at.id
        WHERE a.is_deleted = FALSE
      )
      SELECT * FROM account_tree
      ORDER BY path`,
      [tenantId, companyId]
    );

    const accounts = result.rows.map(this.mapToEntity.bind(this));
    await this.redis.setex(cacheKey, 600, JSON.stringify(accounts));
    return accounts;
  }

  async getAccountBalance(
    accountId: string,
    tenantId: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<{ debit: number; credit: number; balance: number }> {
    const result = await this.pool.query(
      `SELECT 
        COALESCE(SUM(jl.debit_in_base_currency), 0) AS total_debit,
        COALESCE(SUM(jl.credit_in_base_currency), 0) AS total_credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_id
       WHERE jl.account_id = $1 AND jl.tenant_id = $2
         AND je.status = 'POSTED'
         AND ($3::date IS NULL OR je.entry_date >= $3)
         AND ($4::date IS NULL OR je.entry_date <= $4)`,
      [accountId, tenantId, fromDate, toDate]
    );

    const { total_debit: debit, total_credit: credit } = result.rows[0];
    const account = await this.findById(accountId, tenantId);
    const normalBalance = this.getNormalBalance(account?.accountType);
    const balance = normalBalance === 'debit' ? debit - credit : credit - debit;

    return { debit, credit, balance };
  }

  private getNormalBalance(accountType?: AccountType): 'debit' | 'credit' {
    if (!accountType) return 'debit';
    return [AccountType.ASSET, AccountType.EXPENSE, AccountType.COST_OF_GOODS].includes(accountType)
      ? 'debit'
      : 'credit';
  }

  protected mapToEntity(row: Record<string, unknown>): Account {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      code: row.code as string,
      name: row.name as string,
      accountType: row.account_type as AccountType,
      parentId: row.parent_id as string,
      currency: row.currency as string,
      isHeader: row.is_header as boolean,
      isActive: row.is_active as boolean,
      openingBalance: Number(row.opening_balance),
      currentBalance: Number(row.current_balance),
      description: row.description as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      isDeleted: row.is_deleted as boolean,
      version: row.version as number,
    };
  }
}

// ─── Journal Entry Repository ─────────────────────────────────
export class JournalRepository extends BaseRepository<JournalEntry> {
  constructor(pool: Pool, redis: Redis, auditService?: AuditService) {
    super(pool, redis, 'journal_entries', 'je', 60, auditService);
  }

  async findWithLines(id: string, tenantId: string): Promise<JournalEntry | null> {
    const result = await this.pool.query(
      `SELECT je.*,
              json_agg(jl ORDER BY jl.id) FILTER (WHERE jl.id IS NOT NULL) AS lines
       FROM journal_entries je
       LEFT JOIN journal_lines jl ON jl.journal_id = je.id
       WHERE je.id = $1 AND je.tenant_id = $2 AND je.is_deleted = FALSE
       GROUP BY je.id`,
      [id, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  async getTrial Balance(
    tenantId: string,
    companyId: string,
    toDate: Date
  ): Promise<TrialBalanceItem[]> {
    const result = await this.pool.query(
      `SELECT 
        a.id, a.code, a.name, a.account_type, a.parent_id,
        a.opening_balance,
        COALESCE(SUM(jl.debit_in_base_currency), 0) AS period_debit,
        COALESCE(SUM(jl.credit_in_base_currency), 0) AS period_credit,
        a.opening_balance + COALESCE(SUM(jl.debit_in_base_currency), 0) - 
          COALESCE(SUM(jl.credit_in_base_currency), 0) AS closing_balance
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
       LEFT JOIN journal_entries je ON je.id = jl.journal_id
         AND je.status = 'POSTED'
         AND je.entry_date <= $3
       WHERE a.tenant_id = $1 AND a.company_id = $2
         AND a.is_deleted = FALSE AND a.is_header = FALSE
       GROUP BY a.id, a.code, a.name, a.account_type, a.parent_id, a.opening_balance
       ORDER BY a.code`,
      [tenantId, companyId, toDate]
    );

    return result.rows.map((r) => ({
      accountId: r.id,
      accountCode: r.code,
      accountName: r.name,
      accountType: r.account_type as AccountType,
      parentId: r.parent_id,
      openingBalance: Number(r.opening_balance),
      periodDebit: Number(r.period_debit),
      periodCredit: Number(r.period_credit),
      closingBalance: Number(r.closing_balance),
    }));
  }

  async getProfitAndLoss(
    tenantId: string,
    companyId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<ProfitAndLoss> {
    const result = await this.pool.query(
      `SELECT 
        a.account_type,
        COALESCE(SUM(
          CASE WHEN a.account_type IN ('REVENUE') 
            THEN jl.credit_in_base_currency - jl.debit_in_base_currency
            ELSE jl.debit_in_base_currency - jl.credit_in_base_currency
          END
        ), 0) AS amount
       FROM accounts a
       JOIN journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
       JOIN journal_entries je ON je.id = jl.journal_id
         AND je.status = 'POSTED'
         AND je.entry_date BETWEEN $3 AND $4
       WHERE a.tenant_id = $1 AND a.company_id = $2
         AND a.account_type IN ('REVENUE', 'EXPENSE', 'COST_OF_GOODS')
       GROUP BY a.account_type`,
      [tenantId, companyId, fromDate, toDate]
    );

    const data: Record<string, number> = {};
    for (const row of result.rows) {
      data[row.account_type] = Number(row.amount);
    }

    const revenue = data['REVENUE'] || 0;
    const cogs = data['COST_OF_GOODS'] || 0;
    const expenses = data['EXPENSE'] || 0;
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenses;

    return { revenue, cogs, grossProfit, expenses, netProfit };
  }

  protected mapToEntity(row: Record<string, unknown>): JournalEntry {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      entryNumber: row.entry_number as string,
      entryDate: row.entry_date as Date,
      description: row.description as string,
      referenceType: row.reference_type as string,
      referenceId: row.reference_id as string,
      status: row.status as JournalStatus,
      currency: row.currency as string,
      exchangeRate: Number(row.exchange_rate),
      lines: (row.lines as JournalLine[]) || [],
      totalDebit: Number(row.total_debit),
      totalCredit: Number(row.total_credit),
      approvedBy: row.approved_by as string,
      approvedAt: row.approved_at as Date,
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

interface TrialBalanceItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentId?: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

interface ProfitAndLoss {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

// ─── Journal Service ─────────────────────────────────────────
export class JournalService {
  constructor(
    private journalRepo: JournalRepository,
    private accountRepo: AccountRepository,
    private pool: Pool,
    private numberGenerator: DocumentNumberGenerator,
    private messageBus: MessageBus,
    private auditService: AuditService
  ) { }

  async createJournalEntry(
    data: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'version' | 'status' | 'totalDebit' | 'totalCredit'>,
    userId: string,
    autoPost = false
  ): Promise<JournalEntry> {
    // Validate double-entry principle
    const totalDebit = data.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
    const totalCredit = data.lines.reduce((sum, l) => sum + (l.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new Error(
        `Journal entry is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`
      );
    }

    // Validate all accounts exist
    for (const line of data.lines) {
      const account = await this.accountRepo.findById(line.accountId, data.tenantId);
      if (!account) throw new Error(`Account not found: ${line.accountId}`);
      if (!account.isActive) throw new Error(`Account is inactive: ${account.code}`);
    }

    const entryNumber = await this.numberGenerator.next('JE', data.tenantId, data.companyId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const entry = await this.journalRepo.create(
        {
          ...data,
          entryNumber,
          status: autoPost ? JournalStatus.POSTED : JournalStatus.DRAFT,
          totalDebit,
          totalCredit,
        },
        userId,
        client
      );

      // Insert journal lines
      for (const line of data.lines) {
        await client.query(
          `INSERT INTO journal_lines (
            journal_id, account_id, account_code, account_name, description,
            debit, credit, debit_in_base_currency, credit_in_base_currency,
            cost_center_id, project_id, partner_id, tenant_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            entry.id, line.accountId, line.accountCode, line.accountName,
            line.description, line.debit, line.credit,
            line.debit * data.exchangeRate, line.credit * data.exchangeRate,
            line.costCenterId, line.projectId, line.partnerId, data.tenantId
          ]
        );

        // Update account balance if posting
        if (autoPost) {
          await this.updateAccountBalance(line.accountId, line.debit - line.credit, client);
        }
      }

      await client.query('COMMIT');
      return entry;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async postJournalEntry(
    id: string,
    tenantId: string,
    userId: string
  ): Promise<JournalEntry> {
    const entry = await this.journalRepo.findWithLines(id, tenantId);
    if (!entry) throw new Error('Journal entry not found');
    if (entry.status !== JournalStatus.DRAFT) {
      throw new Error(`Cannot post entry in status: ${entry.status}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE journal_entries
         SET status = 'POSTED', approved_by = $1, approved_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [userId, id]
      );

      // Update account balances
      for (const line of entry.lines) {
        await this.updateAccountBalance(
          line.accountId,
          line.debitInBaseCurrency - line.creditInBaseCurrency,
          client
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return (await this.journalRepo.findWithLines(id, tenantId))!;
  }

  // Auto-generate journal from invoice
  async createInvoiceJournal(
    invoice: Invoice,
    arAccountId: string,
    revenueAccountId: string,
    taxAccountId: string,
    userId: string
  ): Promise<JournalEntry> {
    const lines: Omit<JournalLine, 'id'>[] = [
      // Debit AR
      {
        accountId: arAccountId,
        accountCode: '',
        accountName: 'Accounts Receivable',
        description: `Invoice ${invoice.invoiceNumber}`,
        debit: invoice.total,
        credit: 0,
        debitInBaseCurrency: invoice.total * invoice.exchangeRate,
        creditInBaseCurrency: 0,
      },
      // Credit Revenue
      {
        accountId: revenueAccountId,
        accountCode: '',
        accountName: 'Revenue',
        description: `Invoice ${invoice.invoiceNumber}`,
        debit: 0,
        credit: invoice.subtotal,
        debitInBaseCurrency: 0,
        creditInBaseCurrency: invoice.subtotal * invoice.exchangeRate,
      },
    ];

    // Credit Tax if applicable
    if (invoice.taxAmount > 0) {
      lines.push({
        accountId: taxAccountId,
        accountCode: '',
        accountName: 'Tax Payable',
        description: `Tax on Invoice ${invoice.invoiceNumber}`,
        debit: 0,
        credit: invoice.taxAmount,
        debitInBaseCurrency: 0,
        creditInBaseCurrency: invoice.taxAmount * invoice.exchangeRate,
      });
    }

    return this.createJournalEntry(
      {
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        entryDate: invoice.invoiceDate,
        description: `Sales Invoice: ${invoice.invoiceNumber}`,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        lines: lines as JournalLine[],
        createdBy: userId,
        updatedBy: userId,
      },
      userId,
      true // auto post
    );
  }

  // Cash Flow Statement
  async getCashFlowStatement(
    tenantId: string,
    companyId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<CashFlowStatement> {
    const result = await this.pool.query(
      `SELECT 
        cf.category,
        cf.subcategory,
        COALESCE(SUM(
          CASE WHEN a.account_type = 'ASSET' 
            THEN jl.debit_in_base_currency - jl.credit_in_base_currency
            ELSE jl.credit_in_base_currency - jl.debit_in_base_currency
          END
        ), 0) AS amount
       FROM accounts a
       JOIN account_cashflow_mapping cf ON cf.account_id = a.id
       JOIN journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
       JOIN journal_entries je ON je.id = jl.journal_id
         AND je.status = 'POSTED'
         AND je.entry_date BETWEEN $3 AND $4
       WHERE a.tenant_id = $1 AND a.company_id = $2
       GROUP BY cf.category, cf.subcategory`,
      [tenantId, companyId, fromDate, toDate]
    );

    const operating: CashFlowItem[] = [];
    const investing: CashFlowItem[] = [];
    const financing: CashFlowItem[] = [];

    for (const row of result.rows) {
      const item = { description: row.subcategory, amount: Number(row.amount) };
      switch (row.category) {
        case 'OPERATING': operating.push(item); break;
        case 'INVESTING': investing.push(item); break;
        case 'FINANCING': financing.push(item); break;
      }
    }

    const netOperating = operating.reduce((s, i) => s + i.amount, 0);
    const netInvesting = investing.reduce((s, i) => s + i.amount, 0);
    const netFinancing = financing.reduce((s, i) => s + i.amount, 0);

    return {
      fromDate, toDate,
      operating, netOperating,
      investing, netInvesting,
      financing, netFinancing,
      netCashFlow: netOperating + netInvesting + netFinancing,
    };
  }

  private async updateAccountBalance(
    accountId: string,
    netDebit: number,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      `UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2`,
      [netDebit, accountId]
    );
  }
}

interface CashFlowItem {
  description: string;
  amount: number;
}

interface CashFlowStatement {
  fromDate: Date;
  toDate: Date;
  operating: CashFlowItem[];
  netOperating: number;
  investing: CashFlowItem[];
  netInvesting: number;
  financing: CashFlowItem[];
  netFinancing: number;
  netCashFlow: number;
}


// ─── Accounting Router ────────────────────────────────────────
export function createAccountingRouter(
  journalService: JournalService,
  journalRepo: JournalRepository,
  accountRepo: AccountRepository
): express.Router {
  const router = express.Router();

  // Chart of Accounts
  router.get('/accounts', async (req: AuthenticatedRequest, res) => {
    try {
      const accounts = await accountRepo.getChartOfAccounts(req.tenantId!, req.companyId!);
      res.json({ success: true, data: accounts });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get accounts' });
    }
  });

  // Account balance
  router.get('/accounts/:id/balance', async (req: AuthenticatedRequest, res) => {
    try {
      const { fromDate, toDate } = req.query as Record<string, string>;
      const balance = await accountRepo.getAccountBalance(
        req.params.id, req.tenantId!,
        fromDate ? new Date(fromDate) : undefined,
        toDate ? new Date(toDate) : undefined
      );
      res.json({ success: true, data: balance });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get balance' });
    }
  });

  // Trial Balance
  router.get('/reports/trial-balance', async (req: AuthenticatedRequest, res) => {
    try {
      const toDate = new Date((req.query.toDate as string) || Date.now());
      const data = await journalRepo.getTrialBalance(req.tenantId!, req.companyId!, toDate);
      res.json({ success: true, data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get trial balance' });
    }
  });

  // P&L Report
  router.get('/reports/profit-loss', async (req: AuthenticatedRequest, res) => {
    try {
      const { fromDate, toDate } = req.query as Record<string, string>;
      const data = await journalRepo.getProfitAndLoss(
        req.tenantId!, req.companyId!,
        new Date(fromDate), new Date(toDate)
      );
      res.json({ success: true, data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get P&L' });
    }
  });

  // Cash Flow
  router.get('/reports/cash-flow', async (req: AuthenticatedRequest, res) => {
    try {
      const { fromDate, toDate } = req.query as Record<string, string>;
      const data = await journalService.getCashFlowStatement(
        req.tenantId!, req.companyId!,
        new Date(fromDate), new Date(toDate)
      );
      res.json({ success: true, data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get cash flow' });
    }
  });

  // Journal Entries
  router.get('/journals', async (req: AuthenticatedRequest, res) => {
    try {
      const data = await journalRepo.findAll(req.tenantId!, req.companyId!, {
        page: parseInt(req.query.page as string) || 1,
        pageSize: 20,
      });
      res.json({ success: true, ...data });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to get journals' });
    }
  });

  router.post('/journals', async (req: AuthenticatedRequest, res) => {
    try {
      const entry = await journalService.createJournalEntry(
        { ...req.body, tenantId: req.tenantId, companyId: req.companyId },
        req.user!.sub,
        req.body.autoPost
      );
      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create journal',
      });
    }
  });

  router.post('/journals/:id/post', async (req: AuthenticatedRequest, res) => {
    try {
      const entry = await journalService.postJournalEntry(
        req.params.id, req.tenantId!, req.user!.sub
      );
      res.json({ success: true, data: entry });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to post journal',
      });
    }
  });

  return router;
}
