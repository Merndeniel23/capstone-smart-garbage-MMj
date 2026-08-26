import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  AlertTriangle, 
  CreditCard, 
  History, 
  Calendar as CalendarIcon, 
  MessageSquare, 
  Clock, 
  MapPin, 
  Trash2, 
  CheckCircle, 
  ChevronRight, 
  UserCheck, 
  TrendingUp,
  Sparkles,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppState, ScheduleItem, ComplaintItem, PaymentItem } from '../context/AppStateContext';

interface DashboardProps {
  setCurrentScreen?: (screen: any) => void;
}

export default function Dashboard({ setCurrentScreen }: DashboardProps) {
  const { 
    userProfile, 
    currentUser,
    schedules, 
    complaints, 
    addSchedule, 
    addComplaint, 
    addPayment 
  } = useAppState();

  // Modal open states
  const [activeModal, setActiveModal] = useState<'schedule' | 'complaint' | 'payment' | 'tracker' | null>(null);
  
  // Track selected complaint for the launcher tracker modal
  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintItem | null>(null);

  // Form states - Schedule
  const [schedDate, setSchedDate] = useState('2026-10-25');
  const [schedTime, setSchedTime] = useState('09:00 AM - 11:00 AM');
  const [schedType, setSchedType] = useState('Regular Waste');
  const [schedLocation, setSchedLocation] = useState('Purok 4 communal zone');

  // Form states - Complaint
  const [complaintType, setComplaintType] = useState('Overflowing Barangay Barrel');
  const [complaintDesc, setComplaintDesc] = useState('');
  const [complaintPhone, setComplaintPhone] = useState(userProfile.contactInfo);
  const [complaintPurok, setComplaintPurok] = useState('Purok 4');

  // Form states - Payment
  const [payCategory, setPayCategory] = useState<'Weekly Fee' | 'Special Heavy Trash' | 'Hazardous Disposal'>('Weekly Fee');
  const [payAmount, setPayAmount] = useState('5');
  const [payMethod, setPayMethod] = useState('G-Cash');
  const [payRefNo, setPayRefNo] = useState('');

  // Notification banners
  const [alertText, setAlertText] = useState('');

  // Sync state values dynamically to the logged in user
  useEffect(() => {
    const activeUser = currentUser || userProfile;
    if (activeUser) {
      setSchedLocation((activeUser as any).communalZone || 'Purok 4 communal zone');
      setComplaintPhone((activeUser as any).phone || (activeUser as any).contactInfo || '');
      
      const zoneStr = (activeUser as any).communalZone || 'Purok 4 communal zone';
      const match = zoneStr.match(/Purok\s*\d+/i);
      if (match) {
        setComplaintPurok(match[0]);
      } else {
        setComplaintPurok('Purok 4');
      }
    }
  }, [currentUser, userProfile]);

  const activeUser = currentUser || userProfile;
  const displayName = activeUser.name;
  const displayZone = activeUser.communalZone || 'Purok 4 communal zone';

  // Filter schedules matching user's zone
  const filteredSchedules = schedules.filter(s => {
    const sLoc = s.location.toLowerCase();
    const uZone = displayZone.toLowerCase();
    return sLoc.includes(uZone) || uZone.includes(sLoc) || sLoc === 'all zones';
  });
  const schedulesToDisplay = filteredSchedules.length > 0 ? filteredSchedules : schedules;

  // Filter complaints created by active user
  const userComplaints = complaints.filter(c => 
    c.creator.toLowerCase() === displayName.toLowerCase()
  );

  const triggerNotification = (msg: string) => {
    setAlertText(msg);
    setTimeout(() => setAlertText(''), 4500);
  };

  const handleAction = (tab: string) => {
    if (setCurrentScreen) {
      setCurrentScreen(tab);
    }
  };

  // Submission Handlers
  const submitSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const formattedDate = new Date(schedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    addSchedule({
      date: formattedDate,
      time: schedTime,
      type: schedType,
      status: 'Pending',
      location: schedLocation
    });
    setActiveModal(null);
    triggerNotification('📅 Pickup schedule request added successfully to timeline ledger!');
  };

  const submitComplaint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintDesc.trim()) {
      alert('Please explain the issue briefly.');
      return;
    }
    addComplaint({
      type: complaintType,
      purok: complaintPurok,
      description: complaintDesc,
      creator: displayName,
      phone: complaintPhone,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'Pending Review',
    });
    setComplaintDesc('');
    setActiveModal(null);
    triggerNotification('🚨 Your sanitation complaint has been successfully dispatched to leaders!');
  };

  const submitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payRefNo.trim()) {
      alert('Please specify GCash/PayMaya transaction reference code.');
      return;
    }
    addPayment({
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      billingPeriod: payCategory === 'Weekly Fee' ? 'May 2026' : 'Ad-hoc Request',
      amount: Number(payAmount),
      method: payMethod,
      referenceNo: payRefNo.trim(),
      category: payCategory,
      status: 'Pending Verification',
      householdName: displayName,
      purok: complaintPurok || 'Purok 4',
      householdId: activeUser?.householdId
    });
    setPayRefNo('');
    setActiveModal(null);
    triggerNotification('💸 Settle request successfully submitted! Leader verification active.');
  };

  const openTracker = (c: ComplaintItem) => {
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

      {/* Interactive Quick Actions */}
      <section className="space-y-4">
        <h3 className="text-lg font-black text-slate-800 ml-1 uppercase tracking-wider text-xs">Quick Action Shortcuts</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Schedule Pickup', icon: Plus, color: 'text-emerald-500', bg: 'bg-emerald-50', action: () => setActiveModal('schedule') },
            { label: 'Report Issue', icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50', action: () => setActiveModal('complaint') },
            { label: 'Make Payment', icon: CreditCard, color: 'text-indigo-500', bg: 'bg-indigo-50', action: () => setActiveModal('payment') },
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
            Recent Upcoming Schedules
          </div>
          <div className="p-6 flex-1 flex flex-col justify-between">
            <div className="space-y-3">
              {schedulesToDisplay.slice(0, 3).map((item) => (
                <div key={item.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-800 truncate">{item.type}</p>
                      <p className="text-[10px] text-slate-450 font-bold uppercase mt-0.5">{item.date} @ {item.time}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 truncate max-w-[80px]" title={item.location}>
                      <MapPin className="w-3 h-3" />
                      {item.location}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-black border ${
                      item.status === 'Confirmed' ? 'bg-emerald-50 text-emerald-600 border-emerald-150' : 'bg-amber-50 text-amber-600 border-amber-150'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
              {schedulesToDisplay.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-slate-400 font-extrabold uppercase text-[10px]">No schedules mapped yet.</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => handleAction('schedule')}
              className="mt-4 w-full py-3 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              Configure Schedule Cycles →
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

      </div>

      {/* ALL MODALS GO HERE */}
      <AnimatePresence>
        
        {/* SCHEDULE PICKUP MODAL */}
        {activeModal === 'schedule' && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md p-6 space-y-6 shadow-2xl relative border border-slate-100"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Request Settle Pickup</h3>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitSchedule} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Choose Date</label>
                  <input 
                    type="date" 
                    value={schedDate} 
                    onChange={(e) => setSchedDate(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Select Hours Window</label>
                  <select 
                    value={schedTime} 
                    onChange={(e) => setSchedTime(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                  >
                    <option value="09:00 AM - 11:00 AM">Morning shift (09:00 AM - 11:00 AM)</option>
                    <option value="01:30 PM - 03:30 PM">Afternoon shift (01:30 PM - 03:30 PM)</option>
                    <option value="06:00 PM - 08:00 PM">Evening backup (06:00 PM - 08:00 PM)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Waste Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Regular Waste', 'Recyclable', 'Hazardous', 'Organic'].map((type) => (
                      <button
                        type="button"
                        key={type}
                        onClick={() => setSchedType(type)}
                        className={`p-3 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center transition-all cursor-pointer ${
                          schedType === type 
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-600 font-extrabold' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Hauled Target Location</label>
                  <input 
                    type="text" 
                    value={schedLocation} 
                    onChange={(e) => setSchedLocation(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold"
                    required
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/10 cursor-pointer"
                >
                  Book Pickup Cycle
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* REPORT ISSUE COMPLAINT MODAL */}
        {activeModal === 'complaint' && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md p-6 space-y-6 shadow-2xl relative border border-slate-100"
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
                  <select
                    value={complaintPurok}
                    onChange={(e) => setComplaintPurok(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                  >
                    {Array.from({ length: 9 }, (_, i) => `Purok ${i + 1}`).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
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

                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/10 cursor-pointer"
                >
                  Dispatch Incident Report
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
              className="bg-white rounded-[2.5rem] w-full max-w-md p-6 space-y-6 shadow-2xl relative border border-slate-100"
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
                      const val = e.target.value as any;
                      setPayCategory(val);
                      if (val === 'Weekly Fee') setPayAmount('5');
                      else if (val === 'Special Heavy Trash') setPayAmount('80');
                      else setPayAmount('120');
                    }}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                  >
                    <option value="Weekly Fee">Weekly Purok Maintenance Fee (₱5)</option>
                    <option value="Special Heavy Trash">Special Heavy Construction Waste (₱80)</option>
                    <option value="Hazardous Disposal">E-Waste & Electronics (₱120)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Amount Due (PHP)</label>
                  <input 
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-black text-slate-850"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Gateway channel</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['G-Cash', 'PayMaya', 'Over-the-Counter'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayMethod(m)}
                        className={`p-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center transition-all cursor-pointer ${
                          payMethod === m 
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-600 font-extrabold' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-450 font-black uppercase tracking-widest block">Deposit Reference ID</label>
                  <input 
                    type="text" 
                    placeholder="e.g. GC-981240125"
                    value={payRefNo} 
                    onChange={(e) => setPayRefNo(e.target.value)}
                    className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl text-slate-800 font-mono font-extrabold uppercase focus:ring-2 focus:ring-emerald-500/20"
                    required
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/10 cursor-pointer"
                >
                  Submit Reference Slip
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
                    ['Pending Review', 'Assigned', 'Scheduled', 'Resolved'].includes(selectedComplaint.status)
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-slate-150 text-slate-400'
                  }`}>
                    {['Pending Review'].includes(selectedComplaint.status) ? '●' : '✓'}
                  </div>
                  <div className="space-y-0.5">
                    <h5 className={`font-extrabold ${['Pending Review', 'Assigned', 'Scheduled', 'Resolved'].includes(selectedComplaint.status) ? 'text-slate-800' : 'text-slate-400'}`}>
                      Under Leader Review
                    </h5>
                    <p className="text-[10px] text-slate-400">Purok monitoring desk reviews capacity alerts and assignments.</p>
                  </div>
                </div>

                {/* Step 3: Assigned to Crew */}
                <div className="flex gap-4 relative z-10">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                    ['Assigned', 'Scheduled', 'Resolved'].includes(selectedComplaint.status)
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-slate-150 text-slate-400'
                  }`}>
                    {['Assigned', 'Scheduled'].includes(selectedComplaint.status) ? '●' : '✓'}
                  </div>
                  <div className="space-y-0.5">
                    <h5 className={`font-extrabold ${['Assigned', 'Scheduled', 'Resolved'].includes(selectedComplaint.status) ? 'text-slate-800' : 'text-slate-400'}`}>
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
                    selectedComplaint.status === 'Resolved'
                      ? 'bg-emerald-500 text-white shadow-sm' 
                      : 'bg-slate-150 text-slate-400'
                  }`}>
                    {selectedComplaint.status === 'Resolved' ? '✓' : '●'}
                  </div>
                  <div className="space-y-0.5">
                    <h5 className={`font-extrabold ${selectedComplaint.status === 'Resolved' ? 'text-slate-850' : 'text-slate-400'}`}>
                      Resolved & Certified
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
