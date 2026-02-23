import { Pool } from 'pg';

export class DocumentNumberGenerator {
    constructor(private pool: Pool) { }

    async next(prefix: string, tenantId: string, companyId: string): Promise<string> {
        const result = await this.pool.query(
            `INSERT INTO document_sequences (tenant_id, company_id, prefix, last_number)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (tenant_id, company_id, prefix)
       DO UPDATE SET last_number = document_sequences.last_number + 1
       RETURNING last_number, prefix`,
            [tenantId, companyId, prefix]
        );

        const { last_number, prefix: pfx } = result.rows[0];
        const year = new Date().getFullYear();
        return `${pfx}-${year}-${String(last_number).padStart(6, '0')}`;
    }
}
