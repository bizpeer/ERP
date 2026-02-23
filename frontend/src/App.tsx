import { useState } from 'react';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    FileText,
    Settings,
    Search,
    Bell,
    ArrowUpRight,
    TrendingUp,
    DollarSign,
    Activity,
    ClipboardCheck
} from 'lucide-react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import UserManagement from './pages/UserManagement';
import Approvals from './pages/Approvals';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const App = () => {
    const [activeTab, setActiveTab] = useState('dashboard');

    const chartData = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [
            {
                label: 'Revenue',
                data: [35000, 42000, 38000, 55000, 48000, 62000],
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                fill: true,
                tension: 0.4,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        plugins: {
            legend: { display: false },
        },
        scales: {
            y: { display: false },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    };

    return (
        <div className="app-container">
            {/* Sidebar */}
            <aside className="sidebar">
                <div style={{ padding: '0 0 40px 0' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                        ERP<span style={{ color: 'var(--primary)' }}>SaaS</span>
                    </h2>
                </div>

                <nav>
                    <a href="#" className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                        <LayoutDashboard size={20} /> Dashboard
                    </a>
                    <a href="#" className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`} onClick={() => setActiveTab('approvals')}>
                        <ClipboardCheck size={20} /> 전자결재 (기안)
                    </a>
                    <a href="#" className={`nav-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => setActiveTab('sales')}>
                        <ShoppingCart size={20} /> Sales
                    </a>
                    <a href="#" className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}>
                        <Package size={20} /> Inventory
                    </a>
                    <a href="#" className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
                        <Users size={20} /> Users (Admin)
                    </a>
                    <a href="#" className={`nav-item ${activeTab === 'accounting' ? 'active' : ''}`} onClick={() => setActiveTab('accounting')}>
                        <FileText size={20} /> Accounting
                    </a>
                </nav>

                <div style={{ marginTop: 'auto', paddingTop: '40px' }}>
                    <a href="#" className="nav-item">
                        <Settings size={20} /> Settings
                    </a>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                    <div>
                        <h1 style={{ fontSize: '2rem', margin: '0 0 8px 0' }}>Welcome back, Admin</h1>
                        <p style={{ color: 'var(--text-muted)', margin: 0 }}>사내 로컬망 ERP 시스템에 접속되었습니다. 최종 결재 문서는 대표이사 및 회계본부장이 열람 가능합니다.</p>
                    </div>

                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div className="glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Search size={18} color="#94a3b8" />
                            <input
                                type="text"
                                placeholder="Search anything..."
                                style={{ background: 'none', border: 'none', color: 'white', outline: 'none' }}
                            />
                        </div>
                        <div className="glass-card" style={{ padding: '8px', cursor: 'pointer' }}>
                            <Bell size={20} />
                        </div>
                        <img
                            src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                            alt="avatar"
                            style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid var(--primary)' }}
                        />
                    </div>
                </header>

                {activeTab === 'users' ? (
                    <UserManagement />
                ) : activeTab === 'approvals' ? (
                    <Approvals />
                ) : (
                    <>
                        {/* Stats Grid */}
                        <section className="stat-grid">
                            <div className="glass-card stat-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span>Total Revenue</span>
                                    <DollarSign size={18} />
                                </div>
                                <div className="stat-value">$128,430</div>
                                <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.875rem' }}>
                                    <TrendingUp size={14} /> +12.5% vs last month
                                </div>
                            </div>

                            <div className="glass-card stat-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span>Active Orders</span>
                                    <ShoppingCart size={18} />
                                </div>
                                <div className="stat-value">642</div>
                                <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.875rem' }}>
                                    <TrendingUp size={14} /> +8.2% vs last month
                                </div>
                            </div>

                            <div className="glass-card stat-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span>Inventory Status</span>
                                    <Package size={18} />
                                </div>
                                <div className="stat-value">94.2%</div>
                                <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.875rem' }}>
                                    <Activity size={14} /> Healthy
                                </div>
                            </div>
                        </section>

                        {/* Charts Section */}
                        <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                            <div className="glass-card" style={{ padding: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                                    <h3 style={{ margin: 0 }}>Revenue Analytics</h3>
                                    <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.875rem' }}>View Report</button>
                                </div>
                                <div style={{ height: '300px' }}>
                                    <Line data={chartData} options={chartOptions} />
                                </div>
                            </div>

                            <div className="glass-card" style={{ padding: '24px' }}>
                                <h3 style={{ margin: '0 0 24px 0' }}>Recent Activity</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {[1, 2, 3, 4].map(idx => (
                                        <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)' }}></div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '0.875rem' }}>Order #PO-2024-{idx}01 confirmed</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>2 hours ago</div>
                                            </div>
                                            <ArrowUpRight size={14} color="#94a3b8" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </main>
        </div>
    );
};

export default App;
