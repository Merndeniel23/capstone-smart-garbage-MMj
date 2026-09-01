import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield, Users, Activity, Map, CheckCircle, CreditCard, LoaderCircle, XCircle, Trash2, MessageSquare, UserRoundCheck, BarChart3, RefreshCw } from 'lucide-react';
import { apiRequest } from '../services/api';
import {
  notifyAdminActionCountsChanged,
  type AdminActionCounts,
} from '../hooks/useAdminActionCounts';

interface PendingCollector {
  id: number;
  purok_id: number | null;
  purok_name?: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface EndorsementRecord {
  id: number;
  status:
    | 'pending_leader_review'
    | 'leader_endorsed'
    | 'leader_rejected'
    | 'approved'
    | 'admin_rejected'
    | 'withdrawn';
  requester_name_snapshot: string;
  purok_name_snapshot: string;
}

type PaymentStatus =
  | 'pending_leader_verification'
  | 'rejected_by_leader'
  | 'pending_remittance'
  | 'pending_admin_confirmation'
  | 'discrepancy'
  | 'completed';

interface PaymentRecord {
  id: number;
  transaction_code: string;
  resident_name: string;
  purok_name: string;
  amount: number | string;
  status: PaymentStatus;
}

interface DashboardSummary {
  residents: number;
  collectors: number;
  purokLeaders: number;
  pendingAccounts: number;
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
  adminActionCounts: AdminActionCounts;
}

export default function AdminDashboard({
  setCurrentScreen,
  adminActionCounts,
}: AdminDashboardProps) {
  const [pendingCollectors, setPendingCollectors] = useState<PendingCollector[]>([]);
  const [collectorLoading, setCollectorLoading] = useState(true);
  const [collectorError, setCollectorError] = useState('');
  const [collectorMessage, setCollectorMessage] = useState('');
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const [summary, setSummary] = useState<DashboardSummary>({
    residents: 0,
    collectors: 0,
    purokLeaders: 0,
    pendingAccounts: 0,
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
  const [analyticsUnavailable, setAnalyticsUnavailable] = useState<string[]>([]);

  const [endorsements] = useState<EndorsementRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [operationalLoading, setOperationalLoading] = useState(true);
  const endorsementError = '';
  const [paymentError, setPaymentError] = useState('');

  const loadDashboardSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      setSummaryError('');

      const data = await apiRequest<{
        success: boolean;
        summary?: Partial<DashboardSummary>;
      }>('/admin/dashboard-summary');

      setSummary({
        residents: Number(data?.summary?.residents || 0),
        collectors: Number(data?.summary?.collectors || 0),
        purokLeaders: Number(data?.summary?.purokLeaders || 0),
        pendingAccounts: Number(data?.summary?.pendingAccounts || 0),
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
    try {
      setAnalyticsLoading(true);
      setAnalyticsError('');
      setAnalyticsUnavailable([]);

      const data = await apiRequest<{
        success: boolean;
        analytics?: Partial<DashboardAnalytics>;
        unavailableSources?: string[];
      }>('/admin/analytics');

      const source = data?.analytics || {};

      setAnalyticsUnavailable(
        Array.isArray(data.unavailableSources)
          ? data.unavailableSources
          : [],
      );

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
    try {
      setCollectorLoading(true);
      setCollectorError('');

      const data = await apiRequest<{
        success: boolean;
        users?: PendingCollector[];
      }>('/admin/users');

      setPendingCollectors(
        Array.isArray(data.users)
          ? data.users.filter(
              (user) =>
                user.role === 'collector' &&
                user.status === 'pending',
            )
          : [],
      );
    } catch (error) {
      console.error('Pending collector fetch error:', error);
      setCollectorError(
        error instanceof Error
          ? error.message
          : 'Unable to load pending collectors.',
      );
    } finally {
      setCollectorLoading(false);
    }
  }, []);

  const pendingAdminSign = useMemo(
    () =>
      endorsements.filter(
        (endorsement) => endorsement.status === 'leader_endorsed',
      ),
    [endorsements],
  );
  const totalRequests = endorsements.length;

  const loadOperationalQueues = useCallback(async () => {
    setOperationalLoading(true);
    setPaymentError('');

    try {
      const data = await apiRequest<{
        success: boolean;
        payments?: PaymentRecord[];
      }>('/payments');

      setPayments(
        Array.isArray(data.payments) ? data.payments : [],
      );
    } catch (error) {
      setPayments([]);
      setPaymentError(
        error instanceof Error
          ? error.message
          : 'Payment ledger is unavailable.',
      );
    } finally {
      setOperationalLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      loadDashboardSummary(),
      loadAnalytics(),
      loadPendingCollectors(),
      loadOperationalQueues(),
    ]);
  }, [
    loadDashboardSummary,
    loadAnalytics,
    loadPendingCollectors,
    loadOperationalQueues,
  ]);

  const reviewCollector = async (
    collectorId: number,
    action: 'approve' | 'reject',
  ) => {
    try {
      setReviewingId(collectorId);
      setCollectorError('');
      setCollectorMessage('');

      const data = await apiRequest<{
        success: boolean;
        message?: string;
      }>(`/admin/users/${collectorId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: action === 'approve' ? 'active' : 'inactive',
          }),
        });

      setPendingCollectors((current) =>
        current.filter((collector) => collector.id !== collectorId),
      );
      setCollectorMessage(data.message || 'Collector registration updated.');
      notifyAdminActionCountsChanged();
      void Promise.all([
        loadDashboardSummary(),
        loadAnalytics(),
      ]);
    } catch (error) {
      console.error('Collector review error:', error);
      setCollectorError(
        error instanceof Error
          ? error.message
          : 'Unable to review collector.',
      );
    } finally {
      setReviewingId(null);
    }
  };

  const pendingPayments = useMemo(
    () =>
      payments.filter((payment) =>
        [
          'pending_admin_confirmation',
          'discrepancy',
        ].includes(payment.status),
      ),
    [payments],
  );

  const completedRevenue = useMemo(
    () =>
      payments
        .filter((payment) => payment.status === 'completed')
        .reduce(
          (total, payment) =>
            total + Number(payment.amount || 0),
          0,
        ),
    [payments],
  );

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
      value: summaryLoading || summaryError ? '—' : String(summary.residents),
      trend: summaryError ? 'Unavailable' : 'Active',
      icon: Users,
      iconClass: 'bg-blue-50 text-blue-600',
      trendClass: summaryError ? 'text-slate-400' : 'text-blue-600',
    },
    {
      label: 'Collectors',
      value: summaryLoading || summaryError ? '—' : String(summary.collectors),
      trend: summaryError ? 'Unavailable' : 'Active',
      icon: Activity,
      iconClass: 'bg-emerald-50 text-emerald-600',
      trendClass: summaryError ? 'text-slate-400' : 'text-emerald-600',
    },
    {
      label: 'Purok Leaders',
      value: summaryLoading || summaryError ? '—' : String(summary.purokLeaders),
      trend: summaryError ? 'Unavailable' : 'Assigned',
      icon: UserRoundCheck,
      iconClass: 'bg-indigo-50 text-indigo-600',
      trendClass: summaryError ? 'text-slate-400' : 'text-indigo-600',
    },
    {
      label: 'Garbage Bins',
      value: summaryLoading || summaryError ? '—' : String(summary.garbageBins),
      trend: summaryError ? 'Unavailable' : 'Registered',
      icon: Trash2,
      iconClass: 'bg-amber-50 text-amber-600',
      trendClass: summaryError ? 'text-slate-400' : 'text-amber-600',
    },
    {
      label: 'Pending Complaints',
      value: summaryLoading || summaryError ? '—' : String(summary.pendingComplaints),
      trend: summaryError ? 'Unavailable' : 'Needs Action',
      icon: MessageSquare,
      iconClass: 'bg-rose-50 text-rose-600',
      trendClass: summaryError ? 'text-slate-400' : 'text-rose-600',
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

      {!summaryLoading &&
        !summaryError &&
        (adminActionCounts.pendingAccounts > 0 ||
          adminActionCounts.pendingComplaints > 0 ||
          adminActionCounts.pendingPayments > 0 ||
          adminActionCounts.pendingEndorsements > 0) && (
          <section
            aria-live="polite"
            className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 shadow-sm"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
                  Admin attention needed
                </p>
                <h2 className="mt-1 text-lg font-black text-slate-900">
                  Items are waiting for review
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                {adminActionCounts.pendingAccounts > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentScreen('user-management')}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-black text-amber-800 shadow-sm ring-1 ring-amber-200"
                  >
                    {adminActionCounts.pendingAccounts} account{adminActionCounts.pendingAccounts === 1 ? '' : 's'} to approve
                  </button>
                )}

                {adminActionCounts.pendingComplaints > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentScreen('complaints')}
                    className="rounded-xl bg-amber-700 px-4 py-2 text-xs font-black text-white shadow-sm"
                  >
                    {adminActionCounts.pendingComplaints} complaint{adminActionCounts.pendingComplaints === 1 ? '' : 's'} to review
                  </button>
                )}

                {adminActionCounts.pendingPayments > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentScreen('payments')}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-black text-amber-800 shadow-sm ring-1 ring-amber-200"
                  >
                    {adminActionCounts.pendingPayments} payment{adminActionCounts.pendingPayments === 1 ? '' : 's'} to audit
                  </button>
                )}

                {adminActionCounts.pendingEndorsements > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentScreen('endorsements')}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-black text-amber-800 shadow-sm ring-1 ring-amber-200"
                  >
                    {adminActionCounts.pendingEndorsements} endorsement{adminActionCounts.pendingEndorsements === 1 ? '' : 's'} to review
                  </button>
                )}
              </div>
            </div>
          </section>
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
                    emptyMessage={
                      analyticsUnavailable.includes('complaintsPerMonth')
                        ? 'Complaint analytics are currently unavailable.'
                        : 'No complaint records yet.'
                    }
                    barClass="bg-rose-400"
                  />

                  <AnalyticsBarChart
                    title="User Registrations per Month"
                    items={registrationsChart}
                    maxValue={maxAnalyticsValue}
                    emptyMessage={
                      analyticsUnavailable.includes('registrationsPerMonth')
                        ? 'Registration analytics are currently unavailable.'
                        : 'No registration records yet.'
                    }
                    barClass="bg-blue-500"
                  />

                  <AnalyticsBarChart
                    title="Collection Requests per Month"
                    items={collectionChart}
                    maxValue={maxAnalyticsValue}
                    emptyMessage={
                      analyticsUnavailable.includes('collectionsPerMonth')
                        ? 'Collection analytics are currently unavailable.'
                        : 'No collection records yet.'
                    }
                    barClass="bg-emerald-500"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <AnalyticsBreakdown
              title="Users by Role"
              emptyMessage={
                analyticsUnavailable.includes('usersByRole')
                  ? 'User-role analytics are currently unavailable.'
                  : 'No user records yet.'
              }
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
              emptyMessage={
                analyticsUnavailable.includes('binsByStatus')
                  ? 'Bin-status analytics are currently unavailable.'
                  : 'No garbage-bin records yet.'
              }
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
           {false && (
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
                    <span className="text-2xl font-black block leading-none">
                      {operationalLoading || endorsementError
                        ? '—'
                        : pendingAdminSign.length}
                    </span>
                    <span className="text-[8px] font-black uppercase text-emerald-200 tracking-wider">Await Sign</span>
                 </div>
                 <div className="border-l border-white/10">
                    <span className="text-2xl font-black block leading-none">
                      {operationalLoading || endorsementError
                        ? '—'
                        : totalRequests}
                    </span>
                    <span className="text-[8px] font-black uppercase text-emerald-200 tracking-wider">Loaded Records</span>
                 </div>
              </div>

              {operationalLoading && (
                <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[10px] font-bold text-emerald-100">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Loading clearance queue...
                </div>
              )}

              {endorsementError && (
                <div className="rounded-xl border border-white/15 bg-black/15 px-3 py-2 text-[10px] font-bold text-emerald-50">
                  Clearance data unavailable: {endorsementError}
                </div>
              )}

              {!operationalLoading && !endorsementError && pendingAdminSign.length > 0 && (
                <div className="space-y-1.5 pt-1.5 border-t border-white/10">
                  <span className="text-[8px] font-black uppercase tracking-wider text-emerald-200 block">Queue Highlights</span>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {pendingAdminSign.map((req) => (
                      <div key={req.id} className="flex justify-between items-center text-[10px] bg-white/10 px-2.5 py-1.5 rounded-lg">
                        <span className="font-extrabold truncate max-w-[120px]">{req.requester_name_snapshot}</span>
                        <span className="font-mono text-[8px] bg-emerald-500/30 px-1 rounded-sm">{req.purok_name_snapshot}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setCurrentScreen('endorsements')}
                className="w-full py-3 bg-white text-emerald-990 hover:bg-emerald-50 active:scale-95 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2 text-emerald-900"
              >
                <span>
                  Browse Queue ({operationalLoading || endorsementError ? '—' : pendingAdminSign.length}) →
                </span>
              </button>
           </div>
           )}

           {/* ADMIN TREASURY JOURNAL AUDIT CARD */}
           <div className="bg-[#1E293B] p-6 rounded-[2.5rem] text-white shadow-lg space-y-4">
              <div className="flex justify-between items-start">
                <div className="p-2.5 bg-white/10 rounded-2xl">
                  <CreditCard className="w-5 h-5 text-emerald-400 font-extrabold" />
                </div>
                <span className="px-2.5 py-1 bg-white/10 text-white text-[9px] font-black uppercase tracking-wider rounded-lg">
                  Barangay Auditor
                </span>
              </div>
              <div className="space-y-1">
                 <h3 className="text-lg font-black tracking-tight leading-none text-white">Treasury Journal Desk</h3>
                 <p className="text-[10px] text-slate-300">Review barangay payment remittances from the official ledger</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3 bg-black/20 p-3 rounded-2xl text-center">
                 <div>
                    <span className="text-2xl font-black block leading-none text-amber-400">
                      {operationalLoading || paymentError
                        ? '—'
                        : pendingPayments.length}
                    </span>
                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Awaiting Audit</span>
                 </div>
                 <div className="border-l border-white/10">
                    <span className="text-2xl font-black block leading-none text-emerald-400">
                      {operationalLoading || paymentError
                        ? '—'
                        : `₱${completedRevenue.toLocaleString('en-PH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`}
                    </span>
                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Total Revenue</span>
                 </div>
              </div>

              {operationalLoading && (
                <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[10px] font-bold text-slate-300">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Loading payment ledger...
                </div>
              )}

              {paymentError && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-bold text-slate-200">
                  Payment data unavailable: {paymentError}
                </div>
              )}

              {!operationalLoading && !paymentError && pendingPayments.length > 0 && (
                <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                  <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block">Pending Receipts</span>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {pendingPayments.map((payment) => (
                      <div key={payment.id} className="flex justify-between items-center text-[10px] bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/5">
                        <span className="font-extrabold truncate max-w-[120px]">{payment.resident_name}</span>
                        <span className="font-mono text-[8px] bg-amber-500/10 text-amber-300 px-1 rounded-sm">{payment.purok_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setCurrentScreen('payments')}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2 border-none text-white"
              >
                <span>
                  Audit Financial Ledger ({operationalLoading || paymentError ? '—' : pendingPayments.length}) →
                </span>
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
                  void loadOperationalQueues();
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
                         {collector.purok_name ||
                           (collector.purok_id
                             ? `Purok ${collector.purok_id}`
                             : 'Not assigned')}
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
  emptyMessage = 'No analytics records yet.',
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  emptyMessage?: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-black text-slate-800">{title}</h3>

      {items.length === 0 ? (
        <p className="mt-4 text-xs font-bold text-slate-400">
          {emptyMessage}
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
