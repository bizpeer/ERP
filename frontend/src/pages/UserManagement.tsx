import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, AlertCircle, ShieldCheck } from 'lucide-react';
import axios from 'axios';

interface User {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
}

const UserManagement = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [formData, setFormData] = useState({
        email: '',
        username: '',
        firstName: '',
        lastName: '',
        password: ''
    });

    const API_BASE = 'http://localhost:3000/auth';
    // Note: In a real app, the token would be stored in localStorage/context
    const token = localStorage.getItem('token');

    const fetchUsers = async () => {
        try {
            setLoading(true);
            // Dummy data for now since actual API integration requires auth flow
            // In production: const response = await axios.get(`${API_BASE}/users`, { headers: { Authorization: `Bearer ${token}` } });
            const mockUsers: User[] = [
                { id: '1', email: 'admin@company.com', username: 'admin', firstName: 'System', lastName: 'Admin', isActive: true },
                { id: '2', email: 'user1@company.com', username: 'user1', firstName: 'John', lastName: 'Doe', isActive: true },
            ];
            setUsers(mockUsers);
            setError(null);
        } catch (err) {
            setError('사용자 목록을 불러오는데 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (users.length >= 10) {
            alert('사용자 정원(10명)이 초과되었습니다.');
            return;
        }

        try {
            // In production: await axios.post(`${API_BASE}/users`, formData, { headers: { Authorization: `Bearer ${token}` } });
            alert('새로운 사용자가 등록되었습니다.');
            setShowAddModal(false);
            fetchUsers();
        } catch (err) {
            alert('사용자 등록 실패: 정원 초과 또는 서버 오류');
        }
    };

    const handleDeleteUser = async (id: string) => {
        if (!window.confirm('정말 이 사용자를 삭제하시겠습니까?')) return;

        try {
            // In production: await axios.delete(`${API_BASE}/users/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            alert('사용자가 삭제되었습니다.');
            fetchUsers();
        } catch (err) {
            alert('삭제 실패');
        }
    };

    return (
        <div className="user-mgmt-container">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>계정 관리</h2>
                    <p style={{ color: 'var(--text-muted)' }}>시스템 접속 권한을 가진 사용자를 관리합니다. (최대 10명)</p>
                </div>
                <button
                    className="btn-primary"
                    onClick={() => setShowAddModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <UserPlus size={18} /> 사용자 추가
                </button>
            </header>

            {/* Capacity Indicator */}
            <div className="glass-card" style={{ padding: '20px', marginBottom: '24px', borderLeft: `4px solid ${users.length >= 9 ? '#ef4444' : '#38bdf8'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <ShieldCheck color={users.length >= 9 ? '#ef4444' : '#38bdf8'} />
                        <span>현재 사용 중인 라이선스: <strong>{users.length}</strong> / 10 계정</span>
                    </div>
                    <div style={{ width: '200px', height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${(users.length / 10) * 100}%`, height: '100%', background: users.length >= 9 ? '#ef4444' : '#38bdf8' }}></div>
                    </div>
                </div>
            </div>

            {loading ? (
                <p>로딩 중...</p>
            ) : (
                <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)' }}>
                                <th style={{ padding: '16px' }}>이름</th>
                                <th style={{ padding: '16px' }}>아이디 / 이메일</th>
                                <th style={{ padding: '16px' }}>상태</th>
                                <th style={{ padding: '16px' }}>작업</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '16px' }}>{user.firstName} {user.lastName}</td>
                                    <td style={{ padding: '16px' }}>
                                        <div style={{ fontSize: '0.875rem' }}>{user.username}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.email}</div>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>Active</span>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <button
                                            onClick={() => handleDeleteUser(user.id)}
                                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showAddModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="glass-card" style={{ width: '400px', padding: '32px' }}>
                        <h3 style={{ marginTop: 0 }}>신규 사용자 등록</h3>
                        <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input type="text" placeholder="아이디" required onChange={e => setFormData({ ...formData, username: e.target.value })} />
                            <input type="email" placeholder="이메일" required onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="text" placeholder="성" required onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                                <input type="text" placeholder="이름" required onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                            </div>
                            <input type="password" placeholder="비밀번호" required onChange={e => setFormData({ ...formData, password: e.target.value })} />

                            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                                <button type="button" className="btn-primary" style={{ flex: 1, background: '#475569' }} onClick={() => setShowAddModal(false)}>취소</button>
                                <button type="submit" className="btn-primary" style={{ flex: 1 }}>등록</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
