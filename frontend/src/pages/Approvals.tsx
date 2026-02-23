import { useState, useEffect } from 'react';
import { Eye, ClipboardCheck, CheckCircle2, History } from 'lucide-react';
import ApprovalTemplate from '../components/ApprovalTemplate';
import './Approvals.css';

const Approvals = () => {
    const [view, setView] = useState<'list' | 'detail' | 'create'>('list');
    const [selectedDoc, setSelectedDoc] = useState<any>(null);
    const [docs, setDocs] = useState<any[]>([]);

    const mockDocs = [
        {
            id: '1',
            docNumber: 'ERP-2024-0012',
            drafterDate: '2024-02-23',
            department: '영업본부',
            drafterName: '관리자',
            title: '창고 증축을 위한 자금 집행 기안',
            purpose: '자금집행',
            receiver: '내부결재',
            reference: '회계재무부',
            content: '사세 확장으로 인한 물류 적재 공간 부족으로 인해 제3공장 부지에 창고 증축을 제안합니다.\n총 예산은 5,000만원이며, 구체적인 산출 내역은 첨부파일을 참조 바랍니다.',
            status: 'PENDING_HEAD'
        }
    ];

    const mockApprovers = {
        drafter: { name: '관리자', date: '2024-02-23', signed: true },
        teamLeader: { name: '이팀장', date: '2024-02-23', signed: true },
        head: { name: '박본부장', date: '', signed: false },
        ceo: { name: '김대표', date: '', signed: false }
    };

    useEffect(() => {
        setDocs(mockDocs);
    }, []);

    return (
        <div className="approvals-container">
            <header className="approvals-header">
                <div>
                    <h2 style={{ fontSize: '1.8rem', margin: '0 0 8px 0' }}>전자결재 센터</h2>
                    <p style={{ color: 'var(--text-muted)' }}>기안 작성 및 사내 결재 프로세스를 관리합니다.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="glass-card" style={{ display: 'flex', padding: '4px', gap: '4px' }}>
                        <button className={`tab-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
                            내 결재함
                        </button>
                        <button className="tab-btn">
                            전체 승인 문서 (CFO/CEO)
                        </button>
                    </div>
                    <button className="btn-primary" onClick={() => setView('create')} style={{ background: '#475569' }}>
                        + 기안 작성
                    </button>
                </div>
            </header>

            {view === 'list' && (
                <div className="approval-list-grid">
                    <div className="glass-card" style={{ padding: '0' }}>
                        <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', fontWeight: 'bold' }}>
                            결재 대기/진행 문서
                        </div>
                        <table className="approvals-table">
                            <thead>
                                <tr>
                                    <th>번호</th>
                                    <th>제목</th>
                                    <th>기안자</th>
                                    <th>상태</th>
                                    <th>조회</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docs.map(doc => (
                                    <tr key={doc.id}>
                                        <td>{doc.docNumber}</td>
                                        <td>{doc.title}</td>
                                        <td>{doc.drafterName}</td>
                                        <td>
                                            <span className={`status-badge ${doc.status}`}>
                                                {doc.status === 'PENDING_HEAD' ? '본부장결재중' : doc.status}
                                            </span>
                                        </td>
                                        <td>
                                            <button
                                                onClick={() => { setSelectedDoc(doc); setView('detail'); }}
                                                className="icon-btn"
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {view === 'detail' && selectedDoc && (
                <div className="detail-view">
                    <div style={{ marginBottom: '20px', display: 'flex', gap: '12px' }}>
                        <button className="btn-primary" onClick={() => setView('list')}>목록으로</button>
                        <button className="btn-primary" style={{ background: '#22c55e' }}>승인하기</button>
                        <button className="btn-primary" style={{ background: '#ef4444' }}>반려하기</button>
                        <button className="btn-primary" onClick={() => window.print()} style={{ background: '#64748b' }}>인쇄</button>
                    </div>
                    <div className="paper-container">
                        <ApprovalTemplate data={selectedDoc} approvers={mockApprovers} />
                    </div>
                </div>
            )}

            {view === 'create' && (
                <div className="glass-card" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
                    <h3>새 기안서 작성</h3>
                    <form className="create-form">
                        <label>기안 제목</label>
                        <input type="text" placeholder="제목을 입력하세요" />

                        <div style={{ display: 'flex', gap: '20px' }}>
                            <div style={{ flex: 1 }}>
                                <label>구분</label>
                                <select>
                                    <option>자금집행</option>
                                    <option>일반기안</option>
                                    <option>인사/복지</option>
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label>수신인</label>
                                <input type="text" defaultValue="내부결재" />
                            </div>
                        </div>

                        <label>내용</label>
                        <textarea rows={10} placeholder="상세 내용을 입력하세요"></textarea>

                        <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
                            <button type="button" className="btn-primary" style={{ background: '#475569' }} onClick={() => setView('list')}>취소</button>
                            <button type="button" className="btn-primary">기안하기</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Approvals;
