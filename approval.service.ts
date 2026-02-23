import { BaseRepository } from './base.repository';
import { Pool } from 'pg';
import { User, BaseEntity } from './index';

export enum ApprovalStatus {
    DRAFT = 'DRAFT',
    PENDING_TEAM = 'PENDING_TEAM',
    PENDING_HEAD = 'PENDING_HEAD',
    PENDING_CEO = 'PENDING_CEO',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface ApprovalDoc extends BaseEntity {
    drafterId: string;
    drafterName: string;
    department: string;
    title: string;
    content: string;
    purpose: string;
    docNumber: string;
    status: ApprovalStatus;
    currentApproverId?: string;
    approvals: {
        drafter: { name: string; date: string; signed: boolean };
        teamLeader: { name: string; date?: string; signed: boolean; userId?: string };
        head: { name: string; date?: string; signed: boolean; userId?: string };
        ceo: { name: string; date?: string; signed: boolean; userId?: string };
    };
}

export class ApprovalService {
    constructor(private pool: Pool, private repo: BaseRepository<ApprovalDoc>) { }

    /**
     * 신규 기안 생성
     */
    async createRequest(user: User, data: any): Promise<ApprovalDoc> {
        const docNumber = `ERP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

        let initialStatus = ApprovalStatus.PENDING_TEAM;
        let nextApprover = data.teamLeaderId;

        if (user.roles.some(r => r.code === 'TEAM_LEADER')) {
            initialStatus = ApprovalStatus.PENDING_HEAD;
            nextApprover = data.headId;
        }

        const doc: any = {
            tenantId: user.tenantId,
            companyId: user.companyId,
            drafterId: user.id,
            drafterName: `${user.lastName}${user.firstName}`,
            department: user.timezone || '미지정',
            title: data.title,
            content: data.content,
            purpose: data.purpose,
            docNumber,
            status: initialStatus,
            currentApproverId: nextApprover,
            approvals: {
                drafter: { name: `${user.lastName}${user.firstName}`, date: new Date().toISOString().split('T')[0], signed: true },
                teamLeader: { name: data.teamLeaderName || '', signed: false, userId: data.teamLeaderId },
                head: { name: data.headName || '', signed: false, userId: data.headId },
                ceo: { name: '대표이사', signed: false }
            }
        };

        return this.repo.create(doc, user.id);
    }

    /**
     * 결재 승인 처리
     */
    async approve(docId: string, user: User): Promise<ApprovalDoc | null> {
        const doc = await this.repo.findById(docId, user.tenantId);
        if (!doc) throw new Error('문서를 찾을 수 없습니다.');
        if (doc.currentApproverId !== user.id) throw new Error('결재 권한이 없습니다.');

        let nextStatus = doc.status;
        let nextApprover = null;

        if (doc.status === ApprovalStatus.PENDING_TEAM) {
            nextStatus = ApprovalStatus.PENDING_HEAD;
            nextApprover = doc.approvals.head.userId;
            doc.approvals.teamLeader.signed = true;
            doc.approvals.teamLeader.date = new Date().toISOString().split('T')[0];
        } else if (doc.status === ApprovalStatus.PENDING_HEAD) {
            nextStatus = ApprovalStatus.PENDING_CEO;
            nextApprover = null;
            doc.approvals.head.signed = true;
            doc.approvals.head.date = new Date().toISOString().split('T')[0];
        } else if (doc.status === ApprovalStatus.PENDING_CEO) {
            nextStatus = ApprovalStatus.APPROVED;
            doc.approvals.ceo.signed = true;
            doc.approvals.ceo.date = new Date().toISOString().split('T')[0];
        }

        const result = await this.repo.update(docId, user.tenantId, {
            status: nextStatus as any,
            currentApproverId: nextApprover as any,
            approvals: doc.approvals as any
        }, user.id, user.roles.some(r => r.code === 'ADMIN'));

        return result;
    }

    /**
     * CFO / CEO 열람용 전체 조회
     */
    async getAllFinalDocs(user: User): Promise<ApprovalDoc[]> {
        const response = await this.repo.findAll(user.tenantId, user.companyId, {
            filters: [{ field: 'status', operator: 'eq', value: ApprovalStatus.APPROVED }]
        });

        return response.data;
    }
}
