import React from 'react';
import './ApprovalTemplate.css';

interface ApprovalTemplateProps {
    data: {
        title: string;
        docNumber: string;
        drafterDate: string;
        department: string;
        drafterName: string;
        receiver: string;
        reference: string;
        purpose: string; // 자금집행 / 요청사항
        content: string;
    };
    approvers: {
        drafter: { name: string; date: string; signed: boolean };
        teamLeader: { name: string; date: string; signed: boolean };
        head: { name: string; date: string; signed: boolean };
        ceo: { name: string; date: string; signed: boolean };
    };
}

const ApprovalTemplate: React.FC<ApprovalTemplateProps> = ({ data, approvers }) => {
    return (
        <div className="approval-paper">
            <div className="approval-header">
                <div className="doc-title">기 안 서</div>
                <div className="approval-line">
                    <table className="line-table">
                        <tbody>
                            <tr>
                                <th rowSpan={2} className="side-label">결 재</th>
                                <th>담 당</th>
                                <th>팀 장</th>
                                <th>본 부 장</th>
                                <th>대표이사</th>
                            </tr>
                            <tr className="sign-row">
                                <td>
                                    <div className="sign-box">
                                        {approvers.drafter.signed && <span className="sign-stamp">승인</span>}
                                        <div className="sign-name">{approvers.drafter.name}</div>
                                        <div className="sign-date">{approvers.drafter.date}</div>
                                    </div>
                                </td>
                                <td>
                                    <div className="sign-box">
                                        {approvers.teamLeader.signed && <span className="sign-stamp">승인</span>}
                                        <div className="sign-name">{approvers.teamLeader.name}</div>
                                        <div className="sign-date">{approvers.teamLeader.date}</div>
                                    </div>
                                </td>
                                <td>
                                    <div className="sign-box">
                                        {approvers.head.signed && <span className="sign-stamp">승인</span>}
                                        <div className="sign-name">{approvers.head.name}</div>
                                        <div className="sign-date">{approvers.head.date}</div>
                                    </div>
                                </td>
                                <td>
                                    <div className="sign-box">
                                        {approvers.ceo.signed && <span className="sign-stamp">승인</span>}
                                        <div className="sign-name">{approvers.ceo.name}</div>
                                        <div className="sign-date">{approvers.ceo.date}</div>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="info-section">
                <div className="grid-row">
                    <div className="grid-label">기안일자</div>
                    <div className="grid-content">{data.drafterDate}</div>
                    <div className="grid-label">기안부서</div>
                    <div className="grid-content">{data.department}</div>
                    <div className="grid-label">기 안 자</div>
                    <div className="grid-content">{data.drafterName} (인)</div>
                </div>
                <div className="grid-row">
                    <div className="grid-label">문서번호</div>
                    <div className="grid-content">{data.docNumber}</div>
                    <div className="grid-label-large">자금집행 / 요청사항</div>
                    <div className="grid-content-large">{data.purpose}</div>
                </div>
                <div className="grid-row">
                    <div className="grid-label">수 신</div>
                    <div className="grid-content">{data.receiver}</div>
                </div>
                <div className="grid-row">
                    <div className="grid-label">참 조</div>
                    <div className="grid-content">{data.reference}</div>
                </div>
            </div>

            <div className="title-section">
                <div className="grid-label">제 목</div>
                <div className="grid-content title-text">{data.title}</div>
            </div>

            <div className="body-section">
                <div className="content-side-label">내 용</div>
                <div className="content-area">
                    {data.content.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ApprovalTemplate;
