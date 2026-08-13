import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield, Users, Activity, Map, CheckCircle, CreditCard, LoaderCircle, XCircle, Trash2, MessageSquare, UserRoundCheck, BarChart3, RefreshCw } from 'lucide-react';

interface PendingCollector {
  id: number;
  purok_id: number | null;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  status: string;
  created_at: string;
}

interface DashboardSummary {
  residents: number;
  collectors: number;
  purokLeaders: number;
  garbageBins: number;
  pendingComplaints: number;
}

interface AnalyticsItem {
  role?: string;
  status?: string;
  month_key?: string;
  month_label?: string;
  total: number | string;
  completed?: number | string;
}

interface DashboardAnalytics {
  usersByRole: AnalyticsItem[];
  complaintsPerMonth: AnalyticsItem[];
  registrationsPerMonth: AnalyticsItem[];
  binsByStatus: AnalyticsItem[];
  collectionsPerMonth: AnalyticsItem[];
  complaintsByStatus: AnalyticsItem[];
}

interface AdminDashboardProps {
  setCurrentScreen: (screen: any) => void;
}

export default function AdminDashboard({ setCurrentScreen }: AdminDashboardProps) {
  const [pendingCollectors, setPendingCollectors] = useState<PendingCollector[]>([]);
  const [collectorLoading, setCollectorLoading] = useState(true);
  const [collectorError, setCollectorError] = useState('');
  const [collectorMessage, setCollectorMessage] = useState('');
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const [summary, setSummary] = useState<DashboardSummary>({
    residents: 0,
    collectors: 0,
    purokLeaders: 0,
    garbageBins: 0,
    pendingComplaints: 0,
  });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');

  const [analytics, setAnalytics] = useState<DashboardAnalytics>({
    usersByRole: [],
    complaintsPerMonth: [],
    registrationsPerMonth: [],
    binsByStatus: [],
    collectionsPerMonth: [],
    complaintsByStatus: [],
  });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');

  const loadDashboardSummary = useCallback(async () => {
    const token =
      localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    if (!token) {
      setSummaryError('Admin session not found. Please sign in again.');
      setSummaryLoading(false);
      return;
    }

    try {
      setSummaryLoading(true);
      setSummaryError('');

      const response = await fetch('/api/admin/dashboard-summary', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || 'Unable to load dashboard summary.',
        );
      }

      setSummary({
        residents: Number(data?.summary?.residents || 0),
        collectors: Number(data?.summary?.collectors || 0),
        purokLeaders: Number(data?.summary?.purokLeaders || 0),
        garbageBins: Number(data?.summary?.garbageBins || 0),
        pendingComplaints: Number(data?.summary?.pendingComplaints || 0),
      });
    } catch (error) {
      console.error('Dashboard summary fetch error:', error);
      setSummaryError(
        error instanceof Error
          ? error.message
          : 'Cannot connect to the server.',
      );
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    const token =
      localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    if (!token) {
      setAnalyticsError('Admin session not found. Please sign in again.');
      setAnalyticsLoading(false);
      return;
    }

    try {
      setAnalyticsLoading(true);
      setAnalyticsError('');

      const response = await fetch('/api/admin/analytics', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || 'Unable to load analytics.');
      }

      const source = data?.analytics || {};

      setAnalytics({
        usersByRole: Array.isArray(source.usersByRole)
          ? source.usersByRole
          : [],
        complaintsPerMonth: Array.isArray(source.complaintsPerMonth)
          ? source.complaintsPerMonth
          : [],
        registrationsPerMonth: Array.isArray(source.registrationsPerMonth)
          ? source.registrationsPerMonth
          : [],
        binsByStatus: Array.isArray(source.binsByStatus)
          ? source.binsByStatus
          : [],
        collectionsPerMonth: Array.isArray(source.collectionsPerMonth)
          ? source.collectionsPerMonth
          : [],
        complaintsByStatus: Array.isArray(source.complaintsByStatus)
          ? source.complaintsByStatus
          : [],
      });
    } catch (error) {
      console.error('Analytics fetch error:', error);
      setAnalyticsError(
        error instanceof Error
          ? error.message
          : 'Cannot connect to the server.',
      );
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const loadPendingCollectors = useCallback(async () => {
    const token =
      localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    if (!token) {
      setCollectorError('Admin session not found. Please sign in again.');
      setCollectorLoading(false);
      return;
    }

    try {
      setCollectorLoading(true);
      setCollectorError('');

      const response = await fetch('/api/auth/admin/pending-collectors', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        setCollectorError(data.message || 'Unable to load pending collectors.');
        return;
      }

      setPendingCollectors(
        Array.isArray(data.collectors) ? data.collectors : [],
      );
    } catch (error) {
      console.error('Pending collector fetch error:', error);
      setCollectorError('Cannot connect to the server.');
    } finally {
      setCollectorLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      loadDashboardSummary(),
      loadAnalytics(),
      loadPendingCollectors(),
    ]);
  }, [loadDashboardSummary, loadAnalytics, loadPendingCollectors]);

  const reviewCollector = async (
    collectorId: number,
    action: 'approve' | 'reject',
  ) => {
    const token =
      localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    if (!token) {
      setCollectorError('Admin session not found. Please sign in again.');
      return;
    }

    try {
      setReviewingId(collectorId);
      setCollectorError('');
      setCollectorMessage('');

      const response = await fetch(
        `/api/auth/admin/collectors/${collectorId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setCollectorError(data.message || 'Unable to review collector.');
        return;
      }

      setPendingCollectors((current) =>
        current.filter((collector) => collector.id !== collectorId),
      );
      setCollectorMessage(data.message || 'Collector registration updated.');
    } catch (error) {
      console.error('Collector review error:', error);
      setCollectorError('Cannot connect to the server.');
    } finally {
      setReviewingId(null);
    }
  };
  // Real-time local storage pull for clearance records
  const saved = typeof window !== 'undefined' ? localStorage.getItem('sg_endorsements') : null;
  const endorsements = saved ? JSON.parse(saved) : [];
  const pendingAdminSign = endorsements.filter((e: any) => e.status === 'Purok Leader Endorsed');
  const totalRequests = endorsements.length;

  // Payments verification tracking for ledger
  const savedPay = typeof window !== 'undefined' ? localStorage.getItem('sg_payment_history') : null;
  const payments = savedPay ? JSON.parse(savedPay) : [];
  const pendingPayments = payments.filter((p: any) => p.status === 'Pending Verification');

  const complaintsChart = useMemo(
    () =>
      analytics.complaintsPerMonth.map((item) => ({
        label: item.month_label || item.month_key || 'Month',
        value: Number(item.total || 0),
      })),
    [analytics.complaintsPerMonth],
  );

  const registrationsChart = useMemo(
    () =>
      analytics.registrationsPerMonth.map((item) => ({
        label: item.month_label || item.month_key || 'Month',
        value: Number(item.total || 0),
      })),
    [analytics.registrationsPerMonth],
  );

  const collectionChart = useMemo(
    () =>
      analytics.collectionsPerMonth.map((item) => ({
        label: item.month_label || item.month_key || 'Month',
        value: Number(item.total || 0),
        completed: Number(item.completed || 0),
      })),
    [analytics.collectionsPerMonth],
  );

  const maxAnalyticsValue = Math.max(
    1,
    ...complaintsChart.map((item) => item.value),
    ...registrationsChart.map((item) => item.value),
    ...collectionChart.map((item) => item.value),
  );

  const systemMetrics = [
    {
      label: 'Residents',
      value: summaryLoading ? '—' : String(summary.residents),
      trend: 'Active',
      icon: Users,
      iconClass: 'bg-blue-50 text-blue-600',
      trendClass: 'text-blue-600',
    },
    {
      label: 'Collectors',
      value: summaryLoading ? '—' : String(summary.collectors),
      trend: 'Active',
      icon: Activity,
      iconClass: 'bg-emerald-50 text-emerald-600',
      trendClass: 'text-emerald-600',
    },
    {
      label: 'Purok Leaders',
      value: summaryLoading ? '—' : String(summary.purokLeaders),
      trend: 'Assigned',
      icon: UserRoundCheck,
      iconClass: 'bg-indigo-50 text-indigo-600',
      trendClass: 'text-indigo-600',
    },
    {
      label: 'Garbage Bins',
      value: summaryLoading ? '—' : String(summary.garbageBins),
      trend: 'Registered',
      icon: Trash2,
      iconClass: 'bg-amber-50 text-amber-600',
      trendClass: 'text-amber-600',
    },
    {
      label: 'Pending Complaints',
      value: summaryLoading ? '—' : String(summary.pendingComplaints),
      trend: 'Needs Action',
      icon: MessageSquare,
      iconClass: 'bg-rose-50 text-rose-600',
      trendClass: 'text-rose-600',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 md:pb-0">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-emerald-600 font-black text-[10px] uppercase tracking-[0.2em]">
          <Shield className="w-3 h-3" />
          System Control Panel
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Barangay Dashboard</h1>
      </header>

      {summaryError && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{summaryError}</span>
          <button
            type="button"
            onClick={() => void loadDashboardSummary()}
            className="text-xs font-black uppercase tracking-wider text-rose-700 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Global Metrics Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
        {systemMetrics.map((m, i) => (
          <div key={i} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${m.iconClass}`}>
              <m.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-3xl font-black text-slate-900 leading-none">{m.value}</p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{m.label}</p>
                <p className={`text-[10px] font-black ${m.trendClass}`}>{m.trend}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Live Analytics */}
        <div className="lg:col-span-2 space-y-6">
          <div className="overflow-hidden rounded-[2.5rem] border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <div className="flex items-center gap-2 text-emerald-600">
                  <BarChart3 className="h-4 w-4" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                    Live Analytics
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-black text-slate-800">
                  System Performance
                </h2>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentScreen('reports')}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700"
                >
                  Open Reports
                </button>

                <button
                  type="button"
                  onClick={() => void loadAnalytics()}
                  className="flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>

            {analyticsError && (
              <div className="mx-6 mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 sm:mx-8">
                {analyticsError}
              </div>
            )}

            <div className="p-6 sm:p-8">
              {analyticsLoading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 rounded-[2rem] bg-slate-50 text-slate-500">
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  <span className="text-sm font-bold">Loading analytics...</span>
                </div>
              ) : (
                <div className="space-y-8">
                  <AnalyticsBarChart
                    title="Complaints per Month"
                    items={complaintsChart}
                    maxValue={maxAnalyticsValue}
                    emptyMessage="No complaint records yet."
                    barClass="bg-rose-400"
                  />

                  <AnalyticsBarChart
                    title="User Registrations per Month"
                    items={registrationsChart}
                    maxValue={maxAnalyticsValue}
                    emptyMessage="No registration records yet."
                    barClass="bg-blue-500"
                  />

                  <AnalyticsBarChart
                    title="Collection Requests per Month"
                    items={collectionChart}
                    maxValue={maxAnalyticsValue}
                    emptyMessage="No collection records yet."
                    barClass="bg-emerald-500"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <AnalyticsBreakdown
              title="Users by Role"
              items={analytics.usersByRole.map((item) => ({
                label:
                  item.role === 'purok_leader'
                    ? 'Purok Leader'
                    : item.role === 'admin'
                      ? 'Barangay Captain'
                      : item.role === 'collector'
                        ? 'Collector'
                        : 'Resident',
                value: Number(item.total || 0),
              }))}
            />

            <AnalyticsBreakdown
              title="Garbage Bins by Status"
              items={analytics.binsByStatus.map((item) => ({
                label: String(item.status || 'Unknown')
                  .replaceAll('_', ' ')
                  .replace(/\b\w/g, (letter) => letter.toUpperCase()),
                value: Number(item.total || 0),
              }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <button 
              onClick={() => setCurrentScreen('user-management')}
              className="flex flex-col items-center gap-2 rounded-2xl border border-transparent bg-white p-4 shadow-sm transition-colors hover:border-emerald-100 hover:bg-emerald-50"
            >
              <Users className="h-5 w-5 text-slate-400" />
              <span className="text-[10px] font-black uppercase text-slate-500">User Accounts</span>
            </button>

            <button 
              onClick={() => setCurrentScreen('route-map')}
              className="flex flex-col items-center gap-2 rounded-2xl border border-transparent bg-white p-4 shadow-sm transition-colors hover:border-blue-100 hover:bg-blue-50"
            >
              <Map className="h-5 w-5 text-slate-400" />
              <span className="text-[10px] font-black uppercase text-slate-500">System Map</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentScreen('reports')}
              className="flex flex-col items-center gap-2 rounded-2xl border border-transparent bg-white p-4 shadow-sm transition-colors hover:border-amber-100 hover:bg-amber-50"
            >
              <Shield className="h-5 w-5 text-slate-400" />
              <span className="text-[10px] font-black uppercase text-slate-500">Reports</span>
            </button>
          </div>
        </div>

        {/* Global Alerts Feed */}
        <div className="space-y-6">
           {/* CLEARANCE DESK INTERACTIVE CARD */}
           <div className="bg-gradient-to-br from-[#059669] to-emerald-800 p-6 rounded-[2.5rem] text-white shadow-lg space-y-4">
              <div className="flex justify-between items-start">
                <div className="p-2.5 bg-white/20 rounded-2xl">
                  <Shield className="w-5 h-5 text-emerald-300" />
                </div>
                <span className="px-2.5 py-1 bg-white/15 text-white text-[9px] font-black uppercase tracking-wider rounded-lg">
                  Main Registrar
                </span>
              </div>
              <div className="space-y-1">
                 <h3 className="text-lg font-black tracking-tight leading-none text-white">Clearance Desk Hub</h3>
                 <p className="text-[10px] text-emerald-100">Review community sanitary and residency endorsements</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3 bg-black/15 p-3 rounded-2xl text-center">
                 <div>
                    <span className="text-2xl font-black block leading-none">{pendingAdminSign.length}</span>
                    <span className="text-[8px] font-black uppercase text-emerald-200 tracking-wider">Await Sign</span>
                 </div>
                 <div className="border-l border-white/10">
                    <span className="text-2xl font-black block leading-none">{totalRequests}</span>
                    <span className="text-[8px] font-black uppercase text-emerald-200 tracking-wider">Total Recv</span>
                 </div>
              </div>

              {pendingAdminSign.length > 0 && (
                <div className="space-y-1.5 pt-1.5 border-t border-white/10">
                  <span className="text-[8px] font-black uppercase tracking-wider text-emerald-200 block">Queue Highlights</span>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {pendingAdminSign.map((req: any) => (
                      <div key={req.id} className="flex justify-between items-center text-[10px] bg-white/10 px-2.5 py-1.5 rounded-lg">
                        <span className="font-extrabold truncate max-w-[120px]">{req.householdName}</span>
                        <span className="font-mono text-[8px] bg-emerald-500/30 px-1 rounded-sm">{req.purok}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setCurrentScreen('endorsements')}
                className="w-full py-3 bg-white text-emerald-990 hover:bg-emerald-50 active:scale-95 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2 text-emerald-900"
              >
                <span>Browse Queue ({pendingAdminSign.length}) →</span>
              </button>
           </div>

           {/* ADMIN TREASURY JOURNAL AUDIT CARD */}
           <div className="bg-[#1E293B] p-6 rounded-[2.5rem] text-white shadow-lg space-y-4">
              <div className="flex justify-between items-start">
                <div className="p-2.5 bg-white/10 rounded-2xl">
                  <CreditCard className="w-5 h-5 text-emerald-400 font-extrabold" />
                </div>
                <span className="px-2.5 py-1 bg-white/10 text-white text-[9px] font-black uppercase tracking-wider rounded-lg">
                  Global Auditor
                </span>
              </div>
              <div className="space-y-1">
                 <h3 className="text-lg font-black tracking-tight leading-none text-white">Treasury Journal Desk</h3>
                 <p className="text-[10px] text-slate-350">Approve municipal-wide digital environmental receipts</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3 bg-black/20 p-3 rounded-2xl text-center">
                 <div>
                    <span className="text-2xl font-black block leading-none text-amber-400">{pendingPayments.length}</span>
                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Awaiting Audit</span>
                 </div>
                 <div className="border-l border-white/10">
                    <span className="text-2xl font-black block leading-none text-emerald-400">
                      ₱{payments.filter((p: any) => p.status === 'Paid').reduce((acc: number, curr: any) => acc + curr.amount, 0)}
                    </span>
                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Total Revenue</span>
                 </div>
              </div>

              {pendingPayments.length > 0 && (
                <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                  <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block">Pending Receipts</span>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {pendingPayments.map((p: any) => (
                      <div key={p.id} className="flex justify-between items-center text-[10px] bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/5">
                        <span className="font-extrabold truncate max-w-[120px]">{p.householdName}</span>
                        <span className="font-mono text-[8px] bg-amber-500/10 text-amber-300 px-1 rounded-sm">{p.purok}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setCurrentScreen('payments')}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2 border-none text-white"
              >
                <span>Audit Financial Ledger ({pendingPayments.length}) →</span>
              </button>
           </div>

           <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black text-slate-800">Collector Verification</h2>
              <button
                type="button"
                onClick={() => {
                  void loadPendingCollectors();
                  void loadDashboardSummary();
                  void loadAnalytics();
                }}
                className="text-[10px] font-black uppercase tracking-wider text-emerald-600 hover:text-emerald-700"
              >
                Refresh
              </button>
           </div>

           {collectorError && (
             <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[11px] font-bold text-rose-700">
               {collectorError}
             </div>
           )}

           {collectorMessage && (
             <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-[11px] font-bold text-emerald-700">
               {collectorMessage}
             </div>
           )}

           {collectorLoading ? (
             <div className="flex items-center justify-center gap-2 rounded-[2rem] border border-slate-100 bg-white p-6 text-slate-500 shadow-sm">
               <LoaderCircle className="h-4 w-4 animate-spin" />
               <span className="text-[11px] font-bold">Loading registrations...</span>
             </div>
           ) : pendingCollectors.length === 0 ? (
             <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50/60 p-6 shadow-sm">
               <div className="flex items-center gap-2 text-emerald-700">
                 <CheckCircle className="h-4 w-4" />
                 <span className="text-xs font-black">
                   No pending collector registrations
                 </span>
               </div>
             </div>
           ) : (
             <div className="space-y-4">
               {pendingCollectors.map((collector) => {
                 const isReviewing = reviewingId === collector.id;

                 return (
                   <div
                     key={collector.id}
                     className="rounded-[2rem] border border-amber-100 bg-amber-50/50 p-6 shadow-sm"
                   >
                     <div className="mb-3 flex items-start justify-between gap-3">
                       <div className="min-w-0">
                         <h4 className="truncate text-sm font-black text-slate-900">
                           {collector.full_name}
                         </h4>
                         <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">
                           {collector.email}
                         </p>
                       </div>
                       <span className="rounded-lg bg-amber-100 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-amber-700">
                         Pending
                       </span>
                     </div>

                     <div className="mb-4 space-y-1 text-[10px] text-slate-500">
                       <p>
                         Collector ID:{' '}
                         <span className="font-mono font-bold">
                           C-{String(collector.id).padStart(3, '0')}
                         </span>
                       </p>
                       <p>
                         Purok:{' '}
                         {collector.purok_id
                           ? `Purok ${collector.purok_id}`
                           : 'Not assigned'}
                       </p>
                       <p>Phone: {collector.phone || 'Not provided'}</p>
                     </div>

                     <div className="grid grid-cols-2 gap-2">
                       <button
                         type="button"
                         disabled={isReviewing}
                         onClick={() =>
                           void reviewCollector(collector.id, 'reject')
                         }
                         className="flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-white py-2 text-[9px] font-black uppercase tracking-wider text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                       >
                         <XCircle className="h-3 w-3" />
                         Reject
                       </button>

                       <button
                         type="button"
                         disabled={isReviewing}
                         onClick={() =>
                           void reviewCollector(collector.id, 'approve')
                         }
                         className="flex items-center justify-center gap-1 rounded-xl bg-amber-500 py-2 text-[9px] font-black uppercase tracking-wider text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                       >
                         {isReviewing ? (
                           <LoaderCircle className="h-3 w-3 animate-spin" />
                         ) : (
                           <CheckCircle className="h-3 w-3" />
                         )}
                         Approve
                       </button>
                     </div>
                   </div>
                 );
               })}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function AnalyticsBarChart({
  title,
  items,
  maxValue,
  emptyMessage,
  barClass,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  maxValue: number;
  emptyMessage: string;
  barClass: string;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-800">{title}</h3>
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
          Database Records
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 p-5 text-center text-xs font-bold text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="flex h-48 items-end gap-3 overflow-x-auto rounded-[1.5rem] bg-slate-50 px-4 pb-4 pt-8">
          {items.map((item) => {
            const height = Math.max(
              item.value > 0 ? 12 : 4,
              (item.value / maxValue) * 100,
            );

            return (
              <div
                key={`${title}-${item.label}`}
                className="flex min-w-[54px] flex-1 flex-col items-center justify-end"
              >
                <span className="mb-2 text-[10px] font-black text-slate-700">
                  {item.value}
                </span>

                <div
                  className={`w-full rounded-t-xl transition-all duration-500 ${barClass}`}
                  style={{ height: `${height}%` }}
                  title={`${item.label}: ${item.value}`}
                />

                <span className="mt-2 max-w-[72px] truncate text-[9px] font-bold text-slate-400">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AnalyticsBreakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-black text-slate-800">{title}</h3>

      {items.length === 0 ? (
        <p className="mt-4 text-xs font-bold text-slate-400">
          No analytics records yet.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {items.map((item) => {
            const percentage =
              total > 0 ? Math.round((item.value / total) * 100) : 0;

            return (
              <div key={`${title}-${item.label}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">
                    {item.label}
                  </span>
                  <span className="text-xs font-black text-slate-900">
                    {item.value} ({percentage}%)
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}