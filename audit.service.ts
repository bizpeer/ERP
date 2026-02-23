import { MongoClient, Db, Collection } from 'mongodb';
import { AuditLog } from './index';

export class AuditService {
    private client: MongoClient;
    private db: Db | null = null;
    private collection: Collection<AuditLog> | null = null;

    constructor(private readonly url: string, private readonly dbName: string) {
        this.client = new MongoClient(this.url);
    }

    async connect(): Promise<void> {
        if (this.db) return;
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection<AuditLog>('audit_logs');

        // Create indices for performant lookups
        await this.collection.createIndex({ tenantId: 1, entityType: 1, entityId: 1 });
        await this.collection.createIndex({ createdAt: -1 });
    }

    async log(entry: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
        if (!this.collection) await this.connect();

        await this.collection!.insertOne({
            ...entry,
            timestamp: new Date(),
        } as AuditLog);
    }

    async getEntityHistory(
        entityType: string,
        entityId: string,
        tenantId: string
    ): Promise<AuditLog[]> {
        if (!this.collection) await this.connect();

        return this.collection!
            .find({ entityType, entityId, tenantId })
            .sort({ timestamp: -1 })
            .toArray();
    }

    async getRecentLogs(tenantId: string, limit = 50): Promise<AuditLog[]> {
        if (!this.collection) await this.connect();

        return this.collection!
            .find({ tenantId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }
}
