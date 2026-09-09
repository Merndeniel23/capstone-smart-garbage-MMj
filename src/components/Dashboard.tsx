import { PAYMENT_CATEGORY_LABELS, type PaymentCategoryOption } from "../../shared/paymentCategories";
import React, { useCallback, useEffect, useState } from 'react';
import { 
  AlertTriangle, 
  CreditCard, 
  History, 
  Calendar as CalendarIcon, 
  MessageSquare, 
  Clock, 
  MapPin, 
  CheckCircle, 
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiRequest } from '../services/api';

interface DashboardProps {
  setCurrentScreen?: (screen: any) => void;
}

type CurrentUser = {
  id: number;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
  full_name: string;
  email: string;
  role: string;
  phone: string | null;
  address: string | null;
};

type CollectionSchedule = {
  id: number;
  barangay_id: number;
  barangay_name: string;
  day_of_week: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  is_active: number | boolean;
};

type ComplaintRecord = {
  id: number;
  complaint_type: string;
  description: string;
  phone: string | null;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'resolved' | 'cancelled';
  reporter_name: string;
  purok_name: string | null;
  assigned_collector_name?: string | null;
  resolution_remark?: string | null;
  created_at: string;
};

type PaymentRecord = {
  id: number;
  transaction_code: string;
  category: 'weekly_fee' | 'special_heavy_trash' | 'hazardous_disposal';
  billing_period: string;
  amount: number | string;
  payment_method: 'gcash' | 'maya' | 'over_the_counter';
  payment_reference: string;
  status: 'pending_leader_verification' | 'rejected_by_leader' | 'pending_remittance' | 'pending_admin_confirmation' | 'discrepancy' | 'completed';
  created_at: string;
};

type DashboardComplaint = {
  id: number;
  type: string;
  purok: string;
  description: string;
  creator: string;
  phone: string;
  date: string;
  status: string;
  rawStatus: ComplaintRecord['status'];
  assignedTo?: string;
  resolutionRemark?: string;
};



const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (value: string | null) => {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Time to be announced';
  if (!end) return formatTime(start);
  return `${formatTime(start)} - ${formatTime(end)}`;
};

const titleCaseStatus = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const complaintStatusLabel = (status: ComplaintRecord['status']) => {
  if (status === 'pending') return 'Pending Review';
  return titleCaseStatus(status);
};

const paymentCategoryLabel = (category: PaymentRecord['category']) =>
  PAYMENT_CATEGORY_LABELS[category] || titleCaseStatus(category);

const paymentMethodLabel = (method: PaymentRecord['payment_method']) => {
  if (method === 'gcash') return 'GCash';
  if (method === 'maya') return 'Maya';
  return 'Over-the-Counter';
};

const imageToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    reject(new Error('Please select a PNG, JPEG, or WebP image.'));
    return;
  }

  if (file.size > 3_500_000) {
    reject(new Error('Receipt image must be smaller than 3.5 MB.'));
    return;
  }

  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Unable to read the receipt image.'));
  reader.readAsDataURL(file);
});

export default function Dashboard({ setCurrentScreen }: DashboardProps) {
  const [PAYMENT_CATEGORY_OPTIONS, setCategoryOptions] = useState<PaymentCategoryOption[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [schedules, setSchedules] = useState<CollectionSchedule[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeModal, setActiveModal] = useState<'complaint' | 'payment' | 'tracker' | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<DashboardComplaint | null>(null);

  // Form states - Complaint
  const [complaintType, setComplaintType] = useState('Overflowing Barangay Barrel');
  const [complaintDesc, setComplaintDesc] = useState('');
  const [complaintPhone, setComplaintPhone] = useState('');

  // Form states - Payment
  const [payCategory, setPayCategory] = useState<PaymentRecord['category']>('weekly_fee');
  const [payAmount, setPayAmount] = useState('');
  const [payBillingPeriod, setPayBillingPeriod] = useState(() =>
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  );
  const [payMethod, setPayMethod] = useState<PaymentRecord['payment_method']>('gcash');
  const [payRefNo, setPayRefNo] = useState('');
  const [receiptProof, setReceiptProof] = useState('');
  const [receiptFileName, setReceiptFileName] = useState('');
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    setPayAmount(String(PAYMENT_CATEGORY_OPTIONS.find(item => item.value === payCategory)?.amount ?? ''));
  }, [PAYMENT_CATEGORY_OPTIONS, payCategory]);

  // Notification banners
  const [alertText, setAlertText] = useState('');

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError('');

    try {
      const [profileResult, scheduleResult, complaintResult, paymentResult] = await Promise.all([
        apiRequest<{ success: boolean; user: CurrentUser }>('/auth/me'),
        apiRequest<{ success: boolean; schedules: CollectionSchedule[] }>('/collection-schedules'),
        apiRequest<{ success: boolean; complaints: ComplaintRecord[] }>('/complaints'),
        apiRequest<{ success: boolean; payments: PaymentRecord[]; categories: PaymentCategoryOption[] }>('/payments'),
      ]);

      setCategoryOptions(paymentResult.categories);
      setCurrentUser(profileResult.user || null);
      setSchedules(Array.isArray(scheduleResult.schedules) ? scheduleResult.schedules : []);
      setComplaints(Array.isArray(complaintResult.complaints) ? complaintResult.complaints : []);
      setPayments(Array.isArray(paymentResult.payments) ? paymentResult.payments : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (currentUser?.phone) setComplaintPhone(currentUser.phone);
  }, [currentUser?.phone]);

  const displayName = currentUser?.full_name || 'Resident';
  const displayZone = [currentUser?.purok_name, currentUser?.barangay_name]
    .filter(Boolean)
    .join(', ') || 'Assigned barangay';

  const userComplaints: DashboardComplaint[] = complaints.map((complaint) => ({
    id: complaint.id,
    type: complaint.complaint_type,
    purok: complaint.purok_name || 'Assigned purok',
    description: complaint.description,
    creator: complaint.reporter_name || displayName,
    phone: complaint.phone || '',
    date: formatDate(complaint.created_at),
    status: complaintStatusLabel(complaint.status),
    rawStatus: complaint.status,
    assignedTo: complaint.assigned_collector_name || undefined,
    resolutionRemark: complaint.resolution_remark || undefined,
  }));

  const triggerNotification = (msg: string) => {
    setAlertText(msg);
    setTimeout(() => setAlertText(''), 4500);
  };

  const handleAction = (tab: string) => {
    if (setCurrentScreen) {
      setCurrentScreen(tab);
    }
  };

  const submitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintDesc.trim()) {
      setModalError('Please explain the issue briefly.');
      return;
    }

    setSubmittingComplaint(true);
    setModalError('');
    try {
      const result = await apiRequest<{ success: boolean; message: string }>('/complaints', {
        method: 'POST',
        body: JSON.stringify({
          complaint_type: complaintType,
          description: complaintDesc.trim(),
          phone: complaintPhone.trim(),
        }),
      });
      setComplaintDesc('');
      setActiveModal(null);
      triggerNotification(result.message || 'Your sanitation complaint was submitted successfully.');
      await loadDashboard(true);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Unable to submit the complaint.');
    } finally {
      setSubmittingComplaint(false);
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payRefNo.trim() || !receiptProof) {
      setModalError('Enter the payment reference and upload its receipt image.');
      return;
    }

    setSubmittingPayment(true);
    setModalError('');
    try {
      const result = await apiRequest<{ success: boolean; message: string }>('/payments', {
        method: 'POST',
        body: JSON.stringify({
          category: payCategory,
          billingPeriod: payBillingPeriod.trim(),
          amount: Number(payAmount),
          paymentMethod: payMethod,
          paymentReference: payRefNo.trim(),
          receiptProof,
        }),
      });
      setPayRefNo('');
      setReceiptProof('');
      setReceiptFileName('');
      setActiveModal(null);
      triggerNotification(result.message || 'Payment submitted for Purok Leader verification.');
      await loadDashboard(true);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Unable to submit the payment.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handleReceiptFile = async (file?: File) => {
    setModalError('');
    setReceiptProof('');
    setReceiptFileName('');
    if (!file) return;

    try {
      setReceiptProof(await imageToDataUrl(file));
      setReceiptFileName(file.name);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Unable to read the receipt image.');
    }
  };

  const openTracker = (c: DashboardComplaint) => {
    setSelectedComplaint(c);
    setActiveModal('tracker');
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-16">
      
      {/* Title */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-emerald-600 font-extrabold text-[10px] uppercase tracking-[0.2em] block mb-1">Central Hub Console</span>
          <h1 className="text-3.5xl font-black text-slate-900 tracking-tight leading-none">Dashboard</h1>
          <p className="text-slate-500 text-xs mt-1">Resident sanitation services, requests, payments, and account shortcuts.</p>
        </div>
      </header>

      {alertText && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-6 py-4 rounded-[1.8rem] flex items-center gap-3 shadow-md animate-bounce">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-xs font-black">{alertText}</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-[1.8rem] border border-rose-200 bg-rose-50 px-6 py-4 text-rose-800">
          <p className="text-xs font-black">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="mt-2 text-[10px] font-black uppercase tracking-wider underline"
          >
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-[1.8rem] border border-slate-100 bg-white px-6 py-4 text-xs font-black text-slate-500 shadow-sm">
          Loading your official barangay records...
        </div>
      )}

      {/* Interactive Quick Actions */}
      <section className="space-y-4">
        <h3 className="text-lg font-black text-slate-800 ml-1 uppercase tracking-wider text-xs">Quick Action Shortcuts</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'View Schedule', icon: CalendarIcon, color: 'text-emerald-500', bg: 'bg-emerald-50', action: () => handleAction('schedule') },
            { label: 'Report Issue', icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50', action: () => { setModalError(''); setActiveModal('complaint'); } },
            { label: 'Make Payment', icon: CreditCard, color: 'text-indigo-500', bg: 'bg-indigo-50', action: () => { setModalError(''); setActiveModal('payment'); } },
            { label: 'View History', icon: History, color: 'text-cyan-500', bg: 'bg-cyan-50', action: () => handleAction('payments') },
          ].map((action, i) => (
            <motion.button 
              key={i}
              whileHover={{ y: -4 }}
              onClick={action.action}
              className="bg-white p-6 rounded-[2.2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all flex flex-col items-center justify-center gap-4 group cursor-pointer w-full text-center focus:outline-none"
            >
              <div className={`p-4 rounded-2xl ${action.bg} transition-transform group-hover:scale-110`}>
                <action.icon className={`w-8 h-8 ${action.color}`} />
              </div>
              <span className="font-black text-slate-700 text-xs uppercase tracking-wider">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* Bottom Grid Rows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Recent Schedules Panel */}
        <div className="flex flex-col h-full bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-[#05BC8F] text-white p-5 font-black uppercase text-xs tracking-wider flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" />
            Official Weekly Collection Schedule
          </div>
          <div className="p-6 flex-1 flex flex-col justify-between">
            <div className="space-y-3">
              {schedules.slice(0, 3).map((item) => (
                <div key={item.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-800 truncate">{item.notes || 'Weekly Garbage Collection'}</p>
                      <p className="text-[10px] text-slate-450 font-bold uppercase mt-0.5">
                        Every {item.day_of_week} @ {formatTimeRange(item.start_time, item.end_time)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 truncate max-w-[100px]" title={displayZone}>
                      <MapPin className="w-3 h-3" />
                      {item.barangay_name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] uppercase font-black border bg-emerald-50 text-emerald-600 border-emerald-150">
                      Official
                    </span>
                  </div>
                </div>
              ))}
              {!loading && schedules.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-slate-400 font-extrabold uppercase text-[10px]">No active barangay schedule has been published.</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => handleAction('schedule')}
              className="mt-4 w-full py-3 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              View Shared Schedule →
            </button>
          </div>
        </div>

        {/* Recent Complaints Tracker Panel */}
        <div className="flex flex-col h-full bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-[#A18105] text-white p-5 font-black uppercase text-xs tracking-wider flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Recent Sanitation Issues
            </span>
            {setCurrentScreen && (
              <button 
                onClick={() => setCurrentScreen('complaints')}
                className="text-[10px] uppercase font-black tracking-wider hover:underline text-white/90 cursor-pointer"
              >
                Go to Logs →
              </button>
            )}
          </div>
          <div className="p-4 flex-1 flex flex-col justify-between">
            <div className="overflow-x-auto">
              {userComplaints.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-slate-400 font-extrabold uppercase text-[10px]">No sanitation issues logged.</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-widest bg-slate-50">
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Tracker</th>
                    </tr>
                  </thead>
                  <tbody className="font-semibold divide-y divide-slate-100">
                    {userComplaints.slice(0, 3).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3.5 text-slate-850 font-extrabold truncate max-w-[140px]" title={item.type}>{item.type}</td>
                        <td className="px-4 py-3.5 text-slate-500 font-mono">{item.date}</td>
                        <td className="px-4 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-black border ${
                            item.status === 'Resolved' 
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                              : 'bg-amber-50 text-amber-600 border-amber-200'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button 
                            onClick={() => openTracker(item)}
                            className="text-[9px] font-black text-amber-700 uppercase bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md transition-colors"
                          >
                            Trace →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <button 
              onClick={() => handleAction('complaints')}
              className="mt-4 w-full py-3 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              Report New Sanitation Concern →
            </button>
          </div>
        </div>

        {/* Recent Payments Panel */}
        <div className="flex flex-col h-full bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden lg:col-span-2">
          <div className="bg-indigo-600 text-white p-5 font-black uppercase text-xs tracking-wider flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Recent Payment Submissions
            </span>
            <button
              onClick={() => handleAction('payments')}
              className="text-[10px] uppercase font-black tracking-wider hover:underline text-white/90 cursor-pointer"
            >
              Full History →
            </button>
          </div>
          <div className="p-4 overflow-x-auto">
            {!loading && payments.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-slate-400 font-extrabold uppercase text-[10px]">No payment submissions yet.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-widest bg-slate-50">
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Billing Period</th>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="font-semibold divide-y divide-slate-100">
                  {payments.slice(0, 3).map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3.5 text-slate-800">
                        <span className="block font-extrabold">{paymentCategoryLabel(payment.category)}</span>
                        <span className="mt-0.5 block text-[9px] font-bold uppercase text-slate-400">
                          {paymentMethodLabel(payment.payment_method)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-500">{payment.billing_period}</td>
                      <td className="px-4 py-3.5 text-slate-500 font-mono">{formatDate(payment.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-black border ${
                          payment.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : payment.status === 'rejected_by_leader' || payment.status === 'discrepancy'
                              ? 'bg-rose-50 text-rose-600 border-rose-200'
                              : 'bg-amber-50 text-amber-600 border-amber-200'
                        }`}>
                          {titleCaseStatus(payment.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-black text-slate-800">
                        ₱{Number(payment.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

      {/* ALL MODALS GO HERE */}
      <AnimatePresence>
        
        {/* REPORT ISSUE COMPLAINT MODAL */}
        {activeModal === 'complaint' && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl relative border border-slate-100"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Report Sanitation Concern</h3>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitComplaint} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Issue Classification</label>
                  <select 
                    value={complaintType} 
                    onChange={(e) => setComplaintType(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                  >
                    <option value="Overflowing Barangay Barrel">Overflowing Barangay Barrel</option>
                    <option value="Missed Trash Pickup">Missed Trash Pickup</option>
                    <option value="Illegal Littering Alert">Illegal Littering Alert</option>
                    <option value="Odor or Spill Disaster">Severe Odor or Liquid Spills</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Assigned Sector</label>
                  <div className="w-full p-3.5 bg-slate-100 border border-slate-200 rounded-2xl text-slate-700 font-extrabold">
                    {currentUser?.purok_name || 'No purok assigned'}
                  </div>
                  <p className="text-[10px] text-slate-400">Reports are securely assigned from your account profile.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Household Contact No</label>
                  <input 
                    type="text" 
                    value={complaintPhone} 
                    onChange={(e) => setComplaintPhone(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-850 font-extrabold"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Description & Details</label>
                  <textarea 
                    rows={4}
                    placeholder="Specify exact street corner, landmarks or trash barrel color clearly..."
                    value={complaintDesc} 
                    onChange={(e) => setComplaintDesc(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-medium"
                    required
                  />
                </div>

                {modalError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold text-rose-700">
                    {modalError}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={submittingComplaint || !currentUser?.purok_id}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submittingComplaint ? 'Submitting Report...' : 'Dispatch Incident Report'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* MAKE PAYMENT MODAL */}
        {activeModal === 'payment' && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl relative border border-slate-100"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Declare Settle Receipt</h3>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitPayment} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Billing Category</label>
                  <select 
                    value={payCategory}
                    onChange={(e) => {
                      const value = e.target.value as PaymentRecord['category'];
                      const option = PAYMENT_CATEGORY_OPTIONS.find((item) => item.value === value);
                      setPayCategory(value);
                      if (option) setPayAmount(String(option.amount));
                    }}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                  >
                    {PAYMENT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} (₱{option.amount})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Billing Period</label>
                  <input
                    type="text"
                    value={payBillingPeriod}
                    onChange={(e) => setPayBillingPeriod(e.target.value)}
                    placeholder="e.g. August 2026"
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-850"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Amount Due (PHP)</label>
                  <input 
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-black text-slate-850"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Gateway channel</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'gcash', label: 'GCash' },
                      { value: 'maya', label: 'Maya' },
                      { value: 'over_the_counter', label: 'Over-the-Counter' },
                    ] as const).map((method) => (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setPayMethod(method.value)}
                        className={`p-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center transition-all cursor-pointer ${
                          payMethod === method.value
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-600 font-extrabold' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">
                    {payMethod === 'over_the_counter' ? 'Official Receipt Number' : 'Payment Reference Number'}
                  </label>
                  <input 
                    type="text" 
                    placeholder={payMethod === 'over_the_counter' ? 'e.g. OR-2026-00125' : 'e.g. GC-981240125'}
                    value={payRefNo} 
                    onChange={(e) => setPayRefNo(e.target.value)}
                    className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl text-slate-800 font-mono font-extrabold uppercase focus:ring-2 focus:ring-emerald-500/20"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">
                    {payMethod === 'over_the_counter' ? 'Signed Official Receipt' : 'Payment Screenshot'}
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3.5 text-slate-600 hover:border-emerald-400 hover:bg-emerald-50/40">
                    <span className="truncate font-bold">
                      {receiptFileName || 'Choose PNG, JPEG, or WebP image'}
                    </span>
                    <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[9px] font-black uppercase text-emerald-700 shadow-sm">
                      Browse
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => void handleReceiptFile(event.target.files?.[0])}
                    />
                  </label>
                  <p className="text-[10px] text-slate-400">A receipt image under 3.5 MB is required for verification.</p>
                </div>

                {modalError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold text-rose-700">
                    {modalError}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={submittingPayment || !receiptProof}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submittingPayment ? 'Submitting Payment...' : 'Submit Reference Slip'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* PROGRESS TRACKER TIMELINE MODAL */}
        {activeModal === 'tracker' && selectedComplaint && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-lg p-6 space-y-6 shadow-2xl relative border border-slate-100 text-xs"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-amber-600 font-extrabold text-[9px] uppercase tracking-widest">Barangay Dispatch Tracer</span>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight leading-none mt-1">Complaint Timeline Progress</h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">ID: {selectedComplaint.id}</p>
                </div>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Core Timeline Graphics */}
              <div className="space-y-6 pl-3 py-2 relative">
                
                {/* Connecting lines */}
                <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-slate-100" />

                {/* Step 1: Logged */}
                <div className="flex gap-4 relative z-10">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] shadow-sm shrink-0">
                    ✓
                  </div>
                  <div className="space-y-0.5">
                    <h5 className="font-extrabold text-slate-800">Complaint Logged</h5>
                    <p className="text-[10px] text-slate-400">Filed on {selectedComplaint.date} by {selectedComplaint.creator}</p>
                    <p className="text-slate-500 italic mt-0.5">"{selectedComplaint.description}"</p>
                  </div>
                </div>

                  {/* Step 2: Under Review */}
                  <div className="flex gap-4 relative z-10">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                      selectedComplaint.rawStatus !== 'cancelled'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-150 text-slate-400'
                    }`}>
                      {selectedComplaint.rawStatus === 'pending' ? '●' : '✓'}
                    </div>
                    <div className="space-y-0.5">
                      <h5 className={`font-extrabold ${selectedComplaint.rawStatus !== 'cancelled' ? 'text-slate-800' : 'text-slate-400'}`}>
                        Under Leader Review
                    </h5>
                    <p className="text-[10px] text-slate-400">Purok monitoring desk reviews capacity alerts and assignments.</p>
                  </div>
                </div>

                  {/* Step 3: Assigned to Crew */}
                  <div className="flex gap-4 relative z-10">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                      ['assigned', 'in_progress', 'completed', 'resolved'].includes(selectedComplaint.rawStatus)
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-150 text-slate-400'
                    }`}>
                      {['assigned', 'in_progress'].includes(selectedComplaint.rawStatus) ? '●' : '✓'}
                    </div>
                    <div className="space-y-0.5">
                      <h5 className={`font-extrabold ${['assigned', 'in_progress', 'completed', 'resolved'].includes(selectedComplaint.rawStatus) ? 'text-slate-800' : 'text-slate-400'}`}>
                        Assigned to Sanitation Crew
                    </h5>
                    <p className="text-[10px] text-slate-400">
                      {selectedComplaint.assignedTo 
                        ? `Dispatched route coverage to [${selectedComplaint.assignedTo}]`
                        : 'Awaiting crew roster slot allocation.'}
                    </p>
                  </div>
                </div>

                  {/* Step 4: Resolved */}
                  <div className="flex gap-4 relative z-10">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                      ['completed', 'resolved'].includes(selectedComplaint.rawStatus)
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-slate-150 text-slate-400'
                    }`}>
                      {['completed', 'resolved'].includes(selectedComplaint.rawStatus) ? '✓' : '●'}
                    </div>
                    <div className="space-y-0.5">
                      <h5 className={`font-extrabold ${['completed', 'resolved'].includes(selectedComplaint.rawStatus) ? 'text-slate-850' : 'text-slate-400'}`}>
                        Completed / Resolved
                    </h5>
                    <p className="text-[10px] text-slate-400">Site cleared, bin optimized, and completion stamp verified.</p>
                    {selectedComplaint.resolutionRemark && (
                      <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl text-[10px] text-emerald-800 font-medium mt-1">
                        <strong className="block font-black text-emerald-950 uppercase text-[8px] tracking-wider mb-0.5">RESOLUTION SUMMARY:</strong>
                        {selectedComplaint.resolutionRemark}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              <div className="bg-slate-50 p-4 border border-slate-150 rounded-2xl flex items-start gap-2.5">
                <Info className="w-4 h-4 text-slate-450 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-550 leading-relaxed font-semibold">
                  This timeline records collection updates and physical bin inspections submitted by Purok Leaders.
                </p>
              </div>

              <button 
                onClick={() => setActiveModal(null)}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold uppercase tracking-widest rounded-xl cursor-pointer"
              >
                Close Progress Tracer
              </button>
            </motion.div>
          </div>
        )}

      </AnimatePresence>

    </div>
  );
}
