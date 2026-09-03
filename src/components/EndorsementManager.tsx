import React, { useCallback, useState, useEffect } from 'react';
import { 
  Award, 
  CheckCircle, 
  ShieldCheck, 
  Plus, 
  FileText, 
  UserCheck, 
  Trash2, 
  Printer, 
  Building2, 
  BadgeCheck, 
  FileCheck, 
  X, 
  Search, 
  Filter,
  DollarSign,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppState } from '../context/AppStateContext';
import { notifyAdminActionCountsChanged } from '../hooks/useAdminActionCounts';
import cordovaSeal from '../assets/images/Municipality_of_Cordova_Official_Seal.png';

type EndorsementType = 
  | 'Barangay Service Endorsement';

type EndorsementStatus =
  | 'Pending Leader Review'
  | 'Purok Leader Endorsed'
  | 'Barangay Approved'
  | 'Rejected by Purok Leader'
  | 'Rejected by Barangay Captain'
  | 'Withdrawn';

interface EndorsementRequest {
  databaseId: number;
  id: string;
  householdName: string;
  purok: string;
  barangay?: string;
  address?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  requesterAccountCode?: string;
  endorsedBy?: string;
  approvedBy?: string;
  type: EndorsementType;
  requestedService: string;
  date: string;
  description: string;
  status: EndorsementStatus;
  rawStatus:
    | 'pending_leader_review'
    | 'leader_endorsed'
    | 'leader_rejected'
    | 'approved'
    | 'admin_rejected'
    | 'withdrawn';
  adminMemo?: string;
  leaderMemo?: string;
  issuedAt?: string;
  certificateNumber?: string;
  verificationCode?: string;
  outstandingPaymentCount: number;
}

interface EndorsementManagerProps {
  role:
    | 'household'
    | 'leader'
    | 'admin';
}

function getToken() {
  return (
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    sessionStorage.getItem('authToken') ||
    ''
  );
}

async function endorsementApi(
  endpoint = '',
  options: RequestInit = {},
) {
  const token = getToken();
  const response = await fetch(
    `/api/endorsements${endpoint}`,
    {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...(options.headers || {}),
      },
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || 'Endorsement request failed.',
    );
  }

  return data;
}

function formatDate(value: unknown) {
  const date = new Date(String(value || ''));

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function displayStatus(
  value: EndorsementRequest['rawStatus'],
): EndorsementStatus {
  switch (value) {
    case 'leader_endorsed':
      return 'Purok Leader Endorsed';
    case 'leader_rejected':
      return 'Rejected by Purok Leader';
    case 'approved':
      return 'Barangay Approved';
    case 'admin_rejected':
      return 'Rejected by Barangay Captain';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return 'Pending Leader Review';
  }
}

function mapEndorsement(row: any): EndorsementRequest {
  const rawStatus = String(
    row.status || 'pending_leader_review',
  ) as EndorsementRequest['rawStatus'];

  return {
    databaseId: Number(row.id),
    id: String(row.request_code || `END-${row.id}`),
    householdName: String(
      row.requester_name_snapshot || '',
    ),
    purok: String(row.purok_name_snapshot || ''),
    barangay: String(
      row.barangay_name_snapshot || '',
    ),
    address: String(
      row.requester_address_snapshot || '',
    ),
    requesterEmail: String(
      row.requester_email_snapshot || '',
    ),
    requesterPhone:
      row.requester_phone_snapshot || undefined,
    requesterAccountCode: `RES-${row.requester_id}`,
    endorsedBy: row.leader_name_snapshot || undefined,
    approvedBy: row.admin_name_snapshot || undefined,
    type: 'Barangay Service Endorsement',
    requestedService: String(row.requested_service || ''),
    date: formatDate(row.created_at),
    description: String(row.purpose || ''),
    status: displayStatus(rawStatus),
    rawStatus,
    adminMemo: row.admin_remarks || undefined,
    leaderMemo: row.leader_remarks || undefined,
    issuedAt: row.issued_at
      ? formatDate(row.issued_at)
      : undefined,
    certificateNumber:
      row.certificate_number || undefined,
    verificationCode:
      row.verification_code || undefined,
    outstandingPaymentCount: Number(
      row.outstanding_payment_count || 0,
    ),
  };
}

export default function EndorsementManager({ role }: EndorsementManagerProps) {
  const { currentUser, userProfile } = useAppState();
  const activeUser = currentUser || userProfile;
  const activeUserData = (activeUser || {}) as any;

  const displayName =
    activeUserData.full_name ||
    activeUserData.name ||
    'Household';

  const displayZone =
    activeUserData.communalZone || '';

  const getPurokName = (zoneStr: string) => {
    if (!zoneStr) return '';

    const match = zoneStr.match(/Purok\s*\d+/i);

    return match
      ? match[0]
      : zoneStr.split(',')[0]?.trim() || '';
  };

  const getBarangayName = (zoneStr: string) => {
    if (!zoneStr) return '';

    const parts = zoneStr
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.length > 1
      ? parts.slice(1).join(', ')
      : '';
  };

  const initialPurok =
    activeUserData.purok_name ||
    activeUserData.purok ||
    getPurokName(displayZone);

  const initialBarangay =
    activeUserData.barangay_name ||
    activeUserData.barangay ||
    getBarangayName(displayZone);

  const initialAddress =
    activeUserData.address || '';

  const initialEmail =
    activeUserData.email || '';

  const initialPhone =
    activeUserData.phone || '';

  const initialAccountCode =
    activeUserData.householdId ||
    activeUserData.account_code ||
    activeUserData.user_code ||
    '';

  const [endorsements, setEndorsements] =
    useState<EndorsementRequest[]>([]);

  const [householdName, setHouseholdName] =
    useState(displayName);

  const [purok, setPurok] =
    useState(initialPurok);

  const [barangay, setBarangay] =
    useState(initialBarangay);

  const [registeredAddress, setRegisteredAddress] =
    useState(initialAddress);

  const [requesterEmail, setRequesterEmail] =
    useState(initialEmail);

  const [requesterPhone, setRequesterPhone] =
    useState(initialPhone);

  const [requesterAccountCode, setRequesterAccountCode] =
    useState(initialAccountCode);

  const [profileLoading, setProfileLoading] =
    useState(role === 'household');

  const selectedType: EndorsementType =
    'Barangay Service Endorsement';
  const [requestedService, setRequestedService] = useState('');
  const [desc, setDesc] = useState('');
  const [notification, setNotification] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Admin-specific processing states
  const [selectedRequest, setSelectedRequest] = useState<EndorsementRequest | null>(null);
  const [adminMemoInput, setAdminMemoInput] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending_leader' | 'leader_endorsed' | 'approved'>('all');
  
  // Printing/release document modal reference
  const [activeCertificate, setActiveCertificate] = useState<EndorsementRequest | null>(null);

  const loadEndorsements = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setRecordsLoading(true);
      }

      try {
        const data = await endorsementApi();
        const viewer = data.viewer || {};

        setEndorsements(
          Array.isArray(data.endorsements)
            ? data.endorsements.map(mapEndorsement)
            : [],
        );

        setHouseholdName(
          String(viewer.full_name || displayName),
        );
        setPurok(
          String(viewer.purok_name || initialPurok),
        );
        setBarangay(
          String(
            viewer.barangay_name || initialBarangay,
          ),
        );
        setRegisteredAddress(
          String(viewer.address || initialAddress),
        );
        setRequesterEmail(
          String(viewer.email || initialEmail),
        );
        setRequesterPhone(
          String(viewer.phone || initialPhone),
        );
        setRequesterAccountCode(
          String(
            viewer.account_code || initialAccountCode,
          ),
        );
        setErrorMessage('');
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load endorsements.',
        );
      } finally {
        setRecordsLoading(false);
        setProfileLoading(false);
      }
    },
    [
      displayName,
      initialAddress,
      initialAccountCode,
      initialBarangay,
      initialEmail,
      initialPhone,
      initialPurok,
    ],
  );

  useEffect(() => {
    void loadEndorsements();
  }, [loadEndorsements]);

  const showNotification = (message: string) => {
    setNotification(message);
    window.setTimeout(() => setNotification(''), 4000);
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!purok || !barangay) {
      alert(
        'Your registered Barangay and Purok are required. Please complete your Profile address first.',
      );
      return;
    }

    if (requestedService.trim().length < 2) {
      alert('Please specify the barangay service or document you need.');
      return;
    }

    if (desc.trim().length < 10) {
      alert('Please describe your request justification using at least 10 characters.');
      return;
    }

    setActionLoading(true);
    setErrorMessage('');

    try {
      const data = await endorsementApi('', {
        method: 'POST',
        body: JSON.stringify({
          requestType: selectedType,
          requestedService: requestedService.trim(),
          purpose: desc.trim(),
        }),
      });

      setDesc('');
      setRequestedService('');
      showNotification(data.message);
      notifyAdminActionCountsChanged();
      await loadEndorsements(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to submit the endorsement.',
      );
    } finally {
      setActionLoading(false);
    }
  };

  const reviewRequest = async (
    request: EndorsementRequest,
    reviewer: 'leader' | 'admin',
    action: 'endorse' | 'approve' | 'reject',
  ) => {
    setActionLoading(true);
    setErrorMessage('');

    try {
      const data = await endorsementApi(
        `/${request.databaseId}/${reviewer}-review`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action,
            remarks: adminMemoInput.trim(),
          }),
        },
      );

      showNotification(data.message);
      notifyAdminActionCountsChanged();
      setSelectedRequest(null);
      setAdminMemoInput('');
      await loadEndorsements(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to review the endorsement.',
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeaderEndorse = (
    request: EndorsementRequest,
  ) => {
    void reviewRequest(request, 'leader', 'endorse');
  };

  const handleAdminApprove = (
    request: EndorsementRequest,
  ) => {
    if (request.outstandingPaymentCount > 0) {
      setErrorMessage(
        'This request cannot be released until the resident has no unresolved payment records.',
      );
      return;
    }

    void reviewRequest(request, 'admin', 'approve');
  };

  const handleReject = (
    request: EndorsementRequest,
    reviewer: 'leader' | 'admin',
  ) => {
    if (adminMemoInput.trim().length < 5) {
      setErrorMessage(
        'Enter a short review reason before rejecting the request.',
      );
      return;
    }

    void reviewRequest(request, reviewer, 'reject');
  };

  const handleDelete = async (
    request: EndorsementRequest,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    if (
      !window.confirm(
        `Withdraw request ${request.id}? The audit record will be retained.`,
      )
    ) {
      return;
    }

    setActionLoading(true);
    setErrorMessage('');

    try {
      const data = await endorsementApi(
        `/${request.databaseId}`,
        { method: 'DELETE' },
      );

      showNotification(data.message);
      notifyAdminActionCountsChanged();
      await loadEndorsements(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to withdraw the request.',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Helper label styles
  const getTypeBadgeStyles = (type: EndorsementType) => {
    switch (type) {
      case 'Barangay Service Endorsement':
        return 'bg-blue-50 text-blue-700 border border-blue-100';
      default:
        return 'bg-slate-50 text-slate-700 border border-slate-100';
    }
  };

  // Format description preview
  const getSubtextFromType = (type: EndorsementType) => {
    switch (type) {
      case 'Barangay Service Endorsement':
        return 'Endorsement for a requested barangay service or document';
    }
  };

  const filteredEndorsements = endorsements.filter((item) => {
    if (activeTab === 'pending_leader') return item.status === 'Pending Leader Review';
    if (activeTab === 'leader_endorsed') return item.status === 'Purok Leader Endorsed';
    if (activeTab === 'approved') return item.status === 'Barangay Approved';

    return true;
  });

  const approvedDocs = filteredEndorsements.filter(item => item.status === 'Barangay Approved');
  const endorsedDocs = filteredEndorsements.filter(item => item.status === 'Purok Leader Endorsed');
  const certificateBarangayName =
    activeCertificate?.barangay ||
    barangay ||
    'Registered Barangay';
  const certificateApproverName =
    activeCertificate?.approvedBy ||
    'Awaiting Barangay Captain';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20 md:pb-0">
      <style>{`
        /* Official certificate should always look like real paper,
           even while the dashboard itself is in dark mode. */
        html.sg-dark #barangay-endorsement-print-area,
        html.sg-dark #barangay-endorsement-print-area.endorsement-paper {
          background: #ffffff !important;
          color: #0f172a !important;
          color-scheme: light !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-950"],
        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-900"],
        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-850"],
        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-800"] {
          color: #0f172a !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-700"],
        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-600"] {
          color: #334155 !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-500"] {
          color: #64748b !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-400"] {
          color: #94a3b8 !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="text-slate-300"] {
          color: #cbd5e1 !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="border-slate-950"],
        html.sg-dark #barangay-endorsement-print-area [class~="border-slate-900"],
        html.sg-dark #barangay-endorsement-print-area [class~="border-slate-800"] {
          border-color: #1e293b !important;
        }

        html.sg-dark #barangay-endorsement-print-area [class~="border-slate-300"],
        html.sg-dark #barangay-endorsement-print-area [class~="border-slate-200"] {
          border-color: #cbd5e1 !important;
        }

        html.sg-dark #barangay-endorsement-print-area .endorsement-watermark {
          color: rgba(100, 116, 139, 0.28) !important;
        }

        @media print {
          #barangay-endorsement-print-area,
          #barangay-endorsement-print-area * {
            color-scheme: light !important;
          }

          #barangay-endorsement-print-area {
            background: #ffffff !important;
            color: #0f172a !important;
          }
        }
      `}</style>
      
      {/* Header Panel */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest mb-1">
            <Building2 className="w-4 h-4 text-emerald-600" />
            Barangay Service Endorsement Center
          </div>
          <h1 className="text-3xl font-extrabold text-[#1E293B] tracking-tight">Endorsement Panel</h1>
          <p className="text-slate-500 text-sm">
            {role === 'household' ? 'Request an endorsement for a barangay document, permit, assistance, or other service' :
             role === 'leader' ? 'Review resident requests and endorse eligible barangay service requests' :
             'Verify payment compliance and release approved barangay service endorsements'}
          </p>
        </div>
        
        {/* Toggle details info */}
        <div className="hidden md:flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl text-xs font-bold text-slate-600">
          <span className="px-3 py-1 bg-white rounded-xl shadow-xs text-[#059669]">Portal Live</span>
          <span className="px-2">Role: <span className="uppercase text-slate-800">{role}</span></span>
        </div>
      </header>

      {/* Real-time Toast Notifications */}
      {notification && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-6 py-4 rounded-[1.5rem] flex items-center gap-3 shadow-md animate-bounce">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-sm font-bold">{notification}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-6 py-4 rounded-[1.5rem] flex items-center gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span className="text-sm font-bold">{errorMessage}</span>
        </div>
      )}

      {/* Main Multi-Grid Dashboard Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: 
            - If HOUSEHOLD: Show Request Form
            - If ADMIN or LEADER: Show "Received & Issuance Processor Panel" for high-fidelity review of household applications */}
        <div className="lg:col-span-5 space-y-6">
          
          {role === 'household' ? (
            /* HOUSEHOLD: REQUEST FORM */
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-50 pb-4">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800">Endorsement Application</h2>
                  <p className="text-[11px] text-slate-400 font-medium">Tell us what you need from the barangay. Requests with unresolved payments cannot be released.</p>
                </div>
              </div>

              <form onSubmit={handleRequest} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-slate-500 font-extrabold text-[10px] uppercase tracking-wider block font-bold">
                    Resident Name
                  </label>

                  <input
                    type="text"
                    readOnly
                    value={householdName}
                    className="w-full px-4 py-3.5 bg-slate-100 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 cursor-not-allowed"
                  />
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                        Registered Service Area
                      </p>

                      <p className="mt-1 text-sm font-black text-slate-800">
                        {profileLoading
                          ? 'Loading your registered address...'
                          : purok && barangay
                            ? `${purok}, ${barangay}`
                            : 'Profile area not yet configured'}
                      </p>

                      {registeredAddress && (
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {registeredAddress}
                        </p>
                      )}
                    </div>

                    <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black uppercase text-emerald-700">
                      Automatic
                    </span>
                  </div>

                  <p className="mt-3 text-[10px] font-semibold leading-relaxed text-emerald-700/80">
                    Barangay and Purok are taken automatically from your saved Profile address and cannot be changed in this request.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-slate-500 font-extrabold text-[10px] uppercase tracking-wider block font-bold">Barangay Service or Document Needed</label>
                  </div>
                  <input
                    type="text"
                    value={requestedService}
                    onChange={(e) => setRequestedService(e.target.value)}
                    placeholder="Example: certificate, permit, assistance, or document release"
                    maxLength={255}
                    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-slate-500 font-extrabold text-[10px] uppercase tracking-wider block font-bold">Request Details or Purpose</label>
                    <span className="text-[10px] text-emerald-600 font-bold">Describe why you need this endorsement</span>
                  </div>
                  <textarea 
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Explain why you need the service or document and include any useful details."
                    rows={4}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all font-medium leading-relaxed"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    profileLoading ||
                    actionLoading ||
                    !purok ||
                    !barangay
                  }
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all text-white font-extrabold rounded-2xl text-xs shadow-xl shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {profileLoading
                    ? 'Loading Registered Area...'
                    : actionLoading
                      ? 'Submitting Request...'
                      : 'Submit Official Request Form'}
                </button>
              </form>
            </div>
          ) : (
            /* ADMIN or LEADER: RECEIVED PROCESSING WORKSTATION */
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-50 pb-4">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <BadgeCheck className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800">Received Request Processor</h2>
                  <p className="text-[11px] text-slate-400 font-medium">Review resident details and release approved barangay service endorsements</p>
                </div>
              </div>

              {selectedRequest ? (
                <div className="space-y-5 animate-in fade-in duration-300">
                  
                  {/* Selected applicant card detail */}
                  <div className="p-4 bg-slate-50/70 border border-slate-100 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9px] text-slate-400 font-black">{selectedRequest.id}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase text-white bg-slate-800`}>
                        {selectedRequest.purok}
                        {selectedRequest.barangay
                          ? `, ${selectedRequest.barangay}`
                          : ''}
                      </span>
                    </div>

                    <div>
                      <h4 className="font-black text-slate-800 text-sm">{selectedRequest.householdName}</h4>
                      <p className="text-[10px] text-slate-400 font-bold">{selectedRequest.type}</p>
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-slate-100 text-xs text-slate-500 leading-relaxed">
                      <strong className="text-slate-700">Requested service:</strong>{' '}
                      {selectedRequest.requestedService || 'Barangay service or document'}
                      <br />
                      <span className="italic">"{selectedRequest.description}"</span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                      <span>Submitted: {selectedRequest.date}</span>
                      <span>•</span>
                       <span>Status: <strong className="text-indigo-600 underline font-bold">{selectedRequest.status}</strong></span>
                     </div>
                      {role === 'admin' && selectedRequest.outstandingPaymentCount > 0 && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-black leading-relaxed text-rose-700">
                          Release blocked: this resident has {selectedRequest.outstandingPaymentCount} unresolved payment record{selectedRequest.outstandingPaymentCount === 1 ? '' : 's'}. Confirm the payment in the Payments panel before releasing this endorsement.
                        </div>
                      )}
                    </div>

                   {/* Operational workflow form based on status & role */}
                  <div className="space-y-4">
                    
                    {role === 'leader' && selectedRequest.status === 'Pending Leader Review' && (
                      <div className="space-y-3 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                        <p className="text-xs text-emerald-800 font-medium leading-relaxed">
                          As <strong className="text-emerald-700">Purok Leader</strong>, verify that this resident and the requested barangay service information are valid before endorsing the request to the Barangay Captain.
                        </p>
                        <textarea
                          value={adminMemoInput}
                          onChange={(e) => setAdminMemoInput(e.target.value)}
                          placeholder="Optional endorsement note; a reason is required when rejecting."
                          rows={3}
                          className="w-full p-3 bg-white border border-emerald-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={actionLoading}
                            onClick={() => {
                              handleLeaderEndorse(selectedRequest);
                            }}
                            className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md shadow-emerald-700/10 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <UserCheck className="w-4 h-4" />
                            Endorse to Captain
                          </button>
                          <button
                            disabled={actionLoading}
                            onClick={() => handleReject(selectedRequest, 'leader')}
                            className="px-4 py-3 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {role === 'admin' && selectedRequest.status === 'Purok Leader Endorsed' && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-slate-500 font-extrabold text-[10px] uppercase tracking-wider block font-bold">Barangay Captain Verification Memo (Optional)</label>
                          <textarea
                            value={adminMemoInput}
                            onChange={(e) => setAdminMemoInput(e.target.value)}
                            placeholder="Add release notes or payment-compliance remarks."
                            rows={3}
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={actionLoading || selectedRequest.outstandingPaymentCount > 0}
                            onClick={() => handleAdminApprove(selectedRequest)}
                            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-lg shadow-indigo-600/10 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <ShieldCheck className="w-4 h-4" />
                            {selectedRequest.outstandingPaymentCount > 0 ? 'Resolve Payment First' : 'Approve & Release Endorsement'}
                          </button>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleReject(selectedRequest, 'admin')}
                            className="px-4 py-3 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {role === 'admin' && selectedRequest.status === 'Pending Leader Review' && (
                      <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 flex gap-2 items-start text-[10px] text-amber-800 font-medium leading-relaxed">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <span>This request must be endorsed by its assigned Purok Leader before Barangay Captain review.</span>
                      </div>
                    )}

                  </div>

                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-[2rem] space-y-2">
                  <FileCheck className="w-10 h-10 text-slate-300 mx-auto" />
                  <h4 className="font-bold text-slate-700 text-xs">No Request Selected</h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                     Select any resident request from the active queue on the right to review its details and workflow status.
                  </p>
                </div>
              )}

            </div>
          )}


        </div>

        {/* RIGHT COLUMN: ACTIVE APPLICATIONS / ENDORSEMENT STACK */}
        <div className="lg:col-span-7 space-y-4">
          
          {role === 'household' && approvedDocs.length > 0 && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-[2.5rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-in zoom-in-95 duration-300">
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-700 block flex items-center gap-1.5 font-sans">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-ping" />
                  Barangay Service Approved!
                </span>
                <p className="text-sm font-extrabold text-slate-800">
                  Your requested barangay service endorsement is ready!
                </p>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Signed and officially issued by Barangay Captain <strong>{approvedDocs[0].approvedBy}</strong>. You can view, download, or print it now.
                </p>
              </div>
              <button 
                onClick={() => {
                  setActiveCertificate(approvedDocs[0]);
                }}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-md shadow-emerald-500/15 flex items-center gap-1.5 self-start sm:self-auto shrink-0 font-sans"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>View & Print</span>
              </button>
            </div>
          )}

          {role === 'household' && approvedDocs.length === 0 && endorsedDocs.length > 0 && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-[2.5rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-in zoom-in-95 duration-300">
              <div className="space-y-1 flex-1">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-700 block flex items-center gap-1.5 font-sans">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                  Purok Endorsement Active
                </span>
                <p className="text-sm font-extrabold text-slate-800">
                  Your Purok leader signature is verified!
                </p>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Endorsed by your Purok Leader. The request is awaiting Barangay Captain review before release.
                </p>
              </div>
              <button 
                onClick={() => {
                  setActiveCertificate(endorsedDocs[0]);
                }}
                className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 active:scale-95 transition-all text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-md shadow-indigo-500/15 flex items-center gap-1.5 self-start sm:self-auto shrink-0 font-sans"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Preview Draft</span>
              </button>
            </div>
          )}
          
          {/* Filtering tabs */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <h2 className="text-lg font-black text-slate-800">
              {role === 'household'
                ? 'Your Applications'
                : role === 'leader'
                  ? 'Assigned Purok Submissions'
                  : role === 'admin'
                    ? 'Barangay Submissions'
                  : 'Barangay Submissions'}
            </h2>
            
            <div className="flex p-0.5 bg-slate-100 rounded-xl max-w-fit overflow-x-auto">
              <button 
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                  activeTab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                All
              </button>
              <button 
                onClick={() => setActiveTab('pending_leader')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                  activeTab === 'pending_leader' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Pending
              </button>
              <button 
                onClick={() => setActiveTab('leader_endorsed')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                  activeTab === 'leader_endorsed' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Endorsed
              </button>
              <button 
                onClick={() => setActiveTab('approved')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                  activeTab === 'approved' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Signed
              </button>
            </div>
          </div>

          {/* Endorsement list rendering */}
          <div className="space-y-4">
            {recordsLoading && (
              <div className="bg-white border border-slate-100 p-8 text-center rounded-[2rem] text-sm font-bold text-slate-400">
                Loading endorsement registry...
              </div>
            )}

            {filteredEndorsements.map((item) => (
              <div 
                key={item.id} 
                onClick={() => {
                  if (role !== 'household') {
                    setSelectedRequest(item);
                    setAdminMemoInput(item.adminMemo || '');
                  }
                }}
                className={`p-6 rounded-3xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 select-none ${
                  selectedRequest?.id === item.id 
                    ? 'bg-slate-50 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/20' 
                    : 'bg-white border-slate-100 shadow-xs hover:border-slate-200 hover:shadow'
                } ${role !== 'household' ? 'cursor-pointer' : ''}`}
              >
                <div className="space-y-3 flex-1">
                  
                  {/* Badge Row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] text-slate-400 font-extrabold">{item.id}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${getTypeBadgeStyles(item.type)}`}>
                      {item.type}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">{item.date}</span>
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                      {item.purok}
                      {item.barangay
                        ? `, ${item.barangay}`
                        : ''}
                    </span>
                  </div>

                  <div>
                    <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                      {item.householdName}
                      {item.status === 'Barangay Approved' && (
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                    </h4>
                    <p className="text-xs text-slate-400 line-clamp-1 mb-1 font-medium">{getSubtextFromType(item.type)}</p>
                    <p className="text-xs font-bold text-slate-600">Requested: {item.requestedService || 'Barangay service or document'}</p>
                    <p className="text-xs text-slate-500 leading-relaxed italic">"{item.description}"</p>
                  </div>

                  {role === 'admin' && item.outstandingPaymentCount > 0 && (
                    <p className="mt-2 text-[10px] font-black uppercase text-rose-600">
                      {item.outstandingPaymentCount} unresolved payment record{item.outstandingPaymentCount === 1 ? '' : 's'} — release blocked
                    </p>
                  )}

                  {item.adminMemo && (
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px] text-slate-500">
                      <span className="font-black text-slate-700 uppercase block mb-0.5">Municipal Registry Memo:</span>
                      {item.adminMemo}
                    </div>
                  )}
                </div>

                {/* Status Column */}
                <div className="flex flex-col items-end gap-2 shrink-0 border-t border-slate-50 pt-3 md:border-0 md:pt-0">
                  <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider block text-center border ${
                    item.status === 'Barangay Approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                    item.status === 'Purok Leader Endorsed' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
                    'bg-amber-50 text-amber-600 border-amber-100'
                  }`}>
                    {item.status}
                  </span>

                  <div className="flex items-center gap-1">
                    
                    {role !== 'household' && item.status === 'Pending Leader Review' && (
                      <span className="text-[9px] text-slate-400 italic">Reviewing...</span>
                    )}

                    {/* View Certificate Button when Approved or Endorsed */}
                    {(item.status === 'Barangay Approved' || item.status === 'Purok Leader Endorsed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCertificate(item);
                        }}
                        className={`px-2.5 py-1 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                          item.status === 'Barangay Approved' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-indigo-500 hover:bg-indigo-600'
                        }`}
                      >
                        <Printer className="w-3 h-3" />
                        {item.status === 'Barangay Approved' ? 'View Approved Endorsement' : 'Preview Endorsement'}
                      </button>
                    )}

                    {role === 'household' && item.status === 'Pending Leader Review' && (
                      <button
                        disabled={actionLoading}
                        onClick={(e) => void handleDelete(item, e)}
                        className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all disabled:opacity-50"
                        title="Withdraw request"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    )}
                  </div>
                </div>

              </div>
            ))}

            {!recordsLoading && filteredEndorsements.length === 0 && (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-12 text-center rounded-[2.5rem]">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="font-extrabold text-slate-500 text-sm">No Barangay Service Requests</p>
                <p className="text-slate-400 text-xs mt-1">Submit your first barangay service request above.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* OFFICIAL DIGITAL CERTIFICATE PREVIEW MODAL */}
      <AnimatePresence>
        {activeCertificate && (
          <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-50 overflow-y-auto py-4 px-2 md:py-10 md:px-4 flex justify-center items-start print:p-0 print:bg-white print:absolute print:inset-0">
            
            {/* FLOATING ESCAPE QUICK-CLOSE BUTTON */}
            <button
              onClick={() => setActiveCertificate(null)}
              className="fixed top-4 right-4 z-[60] bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black text-xs uppercase tracking-widest px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-1.5 cursor-pointer transition-all border border-rose-500 hover:scale-105 print:hidden"
            >
              <X className="w-4 h-4 text-white" />
              <span>← Close / Return</span>
            </button>

            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-50 w-full max-w-5xl rounded-[2.5rem] shadow-2xl overflow-hidden relative border border-slate-200 flex flex-col lg:flex-row my-4 md:my-8 print:my-0 print:border-0 print:shadow-none print:bg-white print:rounded-none"
            >
              
              {/* LEFT COLUMN: INTERACTIVE FORM CONTROLS (Hidden on print) */}
              <div className={`lg:w-[360px] border-b lg:border-b-0 lg:border-r p-6 flex flex-col shrink-0 gap-4 print:hidden ${
                role === 'household' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-800'
              }`}>
                {role === 'household' ? (
                  <>
                    <div className="border-b border-slate-800 pb-4">
                      <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-[10px] uppercase tracking-wider mb-1 font-sans">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                        <span>{activeCertificate.status === 'Barangay Approved' ? 'OFFICIAL REQUEST APPROVED' : 'ENDORSEMENT PROGRESS'}</span>
                      </div>
                      <h3 className="font-extrabold text-base text-slate-100 uppercase tracking-tight flex items-center gap-1.5 font-sans">
                        <Award className="w-5 h-5 text-emerald-400 shrink-0" />
                        Barangay Service Endorsement
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-1 font-medium leading-relaxed">
                        {activeCertificate.status === 'Barangay Approved'
                          ? 'Your barangay service endorsement has been approved and released by the Barangay Captain.'
                          : 'Your request has been endorsed by your Purok Leader and is waiting for Barangay Captain review.'}
                      </p>
                    </div>

                    <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                      <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-black">Certificate / Request Number</span>
                        <div className="font-mono text-[9.5px] text-emerald-400 break-all bg-black/40 p-2.5 rounded-lg border border-emerald-950/40 font-bold select-all">
                          {activeCertificate.certificateNumber || activeCertificate.id}
                        </div>
                        {activeCertificate.verificationCode && (
                          <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-black">Public Verification Code</span>
                            <div className="font-mono text-[9px] text-sky-300 break-all select-all">
                              {activeCertificate.verificationCode}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-350 font-medium font-sans">
                          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 font-sans" />
                          <span>Secured barangay registry record</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="text-[9.5px] uppercase tracking-wider text-slate-400 font-black block">Printing Instructions</span>
                        <ul className="text-slate-350 text-[11px] space-y-1.5 list-disc pl-4 leading-relaxed font-normal">
                          <li>You can print or download this endorsement by clicking the button below or pressing <kbd className="px-1 py-0.5 bg-slate-950 text-white rounded text-[9px] border border-slate-850 font-mono">Ctrl + P</kbd> on your computer.</li>
                          <li>Keep the approved copy and present it when claiming the requested barangay service or document.</li>
                          <li>Verify an approved copy through <code>/api/endorsements/verify/&lt;verification-code&gt;</code>.</li>
                        </ul>
                      </div>

                      <div className={`p-3 rounded-xl border text-[10px] leading-relaxed font-semibold ${
                        activeCertificate.status === 'Barangay Approved'
                          ? 'bg-emerald-950/25 border-emerald-800/25 text-emerald-400' 
                          : 'bg-amber-950/25 border-amber-800/25 text-amber-400'
                      }`}>
                        {activeCertificate.status === 'Barangay Approved'
                          ? '✓ Verified Status Genuine: Fully signed & issued successfully.' 
                          : '⌛ Status: Awaiting Barangay Captain review.'}
                      </div>
                    </div>

                    {activeCertificate.status === 'Barangay Approved' ? (
                      <button
                        onClick={() => window.print()}
                        className="w-full mt-auto py-3 bg-[#05BC8F] hover:bg-[#049a75] active:scale-95 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none font-sans"
                      >
                        <Printer className="w-4.5 h-4.5" />
                        Print Approved Certificate
                      </button>
                    ) : (
                      <div className="mt-auto rounded-xl border border-amber-800/30 bg-amber-950/20 p-3 text-center text-[10px] font-bold text-amber-300">
                        Preview only — waiting for Barangay Captain approval.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-emerald-600">
                        <FileCheck className="h-4 w-4" />
                        Verified Request Data
                      </div>

                      <h3 className="mt-1 text-base font-black text-slate-800">
                        Certificate Review
                      </h3>

                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        Resident identity, credentials, and service area are locked to the submitted request snapshot. The certificate always follows whoever actually submitted the request.
                      </p>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-1">
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          Requesting Resident
                        </p>

                        <p className="mt-1 text-sm font-black text-slate-800">
                          {activeCertificate.householdName}
                        </p>

                        <div className="mt-2 space-y-1 text-[10px] font-medium text-slate-500">
                          {activeCertificate.requesterAccountCode && (
                            <p>
                              Account Code: <strong>{activeCertificate.requesterAccountCode}</strong>
                            </p>
                          )}

                          {activeCertificate.requesterEmail && (
                            <p>
                              Email: {activeCertificate.requesterEmail}
                            </p>
                          )}

                          {activeCertificate.requesterPhone && (
                            <p>
                              Contact: {activeCertificate.requesterPhone}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                        <p className="text-[9px] font-black uppercase tracking-wider text-emerald-700">
                          Registered Service Area
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-800">
                          {activeCertificate.purok}
                          {activeCertificate.barangay
                            ? `, ${activeCertificate.barangay}`
                            : ''}
                        </p>

                        {activeCertificate.address && (
                          <p className="mt-1 text-[11px] font-medium text-slate-500">
                            {activeCertificate.address}
                          </p>
                        )}
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          Endorsement Purpose
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                          {activeCertificate.description}
                        </p>
                      </div>

                      <div className={`rounded-2xl border p-4 ${
                        activeCertificate.status === 'Barangay Approved'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : activeCertificate.status === 'Purok Leader Endorsed'
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        <p className="text-[9px] font-black uppercase tracking-wider opacity-70">
                          Current Status
                        </p>
                        <p className="mt-1 text-xs font-black uppercase">
                          {activeCertificate.status}
                        </p>
                      </div>

                      {activeCertificate.adminMemo && (
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                            Barangay Verification Memo
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-slate-600">
                            {activeCertificate.adminMemo}
                          </p>
                        </div>
                      )}
                    </div>

                    {activeCertificate.status === 'Barangay Approved' ? (
                      <button
                        onClick={() => window.print()}
                        className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-extrabold uppercase tracking-wider text-white transition hover:bg-emerald-700"
                      >
                        <Printer className="h-4 w-4" />
                        Print Approved Certificate
                      </button>
                    ) : (
                      <div className="mt-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-[10px] font-bold text-amber-700">
                        Preview only — official printing is enabled after Barangay Captain approval.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* RIGHT COLUMN: HIGH FIDELITY PAPER BLUEPRINT REPRESENTATION */}
              <div
                className="endorsement-paper flex-1 bg-white p-6 md:p-14 flex flex-col justify-between shadow-xs print:p-0 print:shadow-none print:w-full print:block"
                id="barangay-endorsement-print-area"
              >
                
                {/* DOUBLE BORDER LETTERHEAD ORNAMENT (Matches the Philippine traditional stationery model) */}
                <div className="border border-double border-slate-800/80 p-8 md:p-12 h-full flex flex-col justify-between space-y-10 min-h-[750px] print:border-0 print:p-0 relative">
                  
                  {/* Subtle watermarking diagonal text */}
                  {activeCertificate?.status !== 'Barangay Approved' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden z-0">
                      <span className="endorsement-watermark text-slate-200/40 text-4xl sm:text-6xl font-sans font-black tracking-widest uppercase -rotate-12 select-none whitespace-nowrap">
                        PENDING FINAL APPROVAL
                      </span>
                    </div>
                  )}
                  
                  {/* LETTERHEAD SECTION */}
                  <div className="space-y-8">
                    <div className="flex items-center justify-center gap-6 border-b border-slate-300 pb-6 relative">
                      
                      <img
                        src={cordovaSeal}
                        alt="Municipality of Cordova Official Seal"
                        className="h-20 w-20 shrink-0 select-none object-contain hidden sm:block print:block"
                      />

                      <div className="text-center font-sans">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Republic of the Philippines</p>
                        <p className="text-xs text-slate-600 font-semibold leading-tight">Smart Garbage Monitoring System</p>
                        <p className="text-sm font-extrabold text-slate-900 uppercase tracking-wider mt-0.5">BARANGAY {certificateBarangayName.toUpperCase()}</p>
                      </div>

                      {/* Spacer offset for symmetry if logo is displayed */}
                      <div className="w-20 h-20 hidden sm:block print:block opacity-0" aria-hidden="true" />
                    </div>

                    {/* DECREE OFFICINA STAMP & TITLE */}
                    <div className="text-center space-y-4">
                      <h2 className="text-slate-850 font-sans font-extrabold tracking-widest text-sm uppercase underline decoration-2 underline-offset-4">
                        OFFICE OF THE PUNONG BARANGAY
                      </h2>
                      <h1 className="text-2xl md:text-3xl font-sans font-black tracking-widest text-slate-950 uppercase pt-4">
                        BARANGAY SERVICE ENDORSEMENT
                      </h1>
                    </div>
                  </div>

                  {/* VERIFIED RESIDENT BLOCK */}
                  <div className="space-y-1 text-slate-900 font-sans text-xs md:text-sm text-left max-w-lg">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Certified Resident
                    </p>
                    <p className="font-extrabold text-slate-950">
                      {activeCertificate.householdName}
                    </p>

                    {activeCertificate.requesterAccountCode && (
                      <p className="text-slate-600 font-normal">
                        Account Code: {activeCertificate.requesterAccountCode}
                      </p>
                    )}

                    <p className="text-slate-700 font-normal">
                      {activeCertificate.purok}
                      {activeCertificate.barangay
                        ? `, Barangay ${activeCertificate.barangay}`
                        : ''}
                    </p>

                    {activeCertificate.address && (
                      <p className="text-slate-600 font-normal">
                        Address: {activeCertificate.address}
                      </p>
                    )}

                    {activeCertificate.requesterEmail && (
                      <p className="text-slate-600 font-normal">
                        Email: {activeCertificate.requesterEmail}
                      </p>
                    )}

                    {activeCertificate.requesterPhone && (
                      <p className="text-slate-600 font-normal">
                        Contact: {activeCertificate.requesterPhone}
                      </p>
                    )}
                  </div>

                  {/* CERTIFICATION TEXT BODY */}
                  <div className="font-serif text-slate-950 text-xs md:text-sm text-justify leading-relaxed space-y-6 md:space-y-8 px-1 max-w-xl mx-auto">
                    <p className="indent-8">
                      THIS IS TO CERTIFY that <strong className="font-sans font-extrabold text-slate-950 border-b border-slate-900/60 pb-0.5 px-0.5">{activeCertificate.householdName}</strong>
                      {activeCertificate.requesterAccountCode
                        ? ` (Account ${activeCertificate.requesterAccountCode})`
                        : ''} is the registered resident who submitted this request under <strong>{activeCertificate.purok}</strong>
                      {activeCertificate.barangay
                        ? `, Barangay ${activeCertificate.barangay}`
                        : ''}. The identity and service-area details shown in this endorsement are copied from the resident's registered account and are not editable from the request form.
                    </p>

                    <p className="indent-8">
                      The resident submitted an endorsement request for the following barangay service or document: <strong className="font-sans font-bold text-slate-950">{activeCertificate.requestedService || 'Barangay service or document'}</strong>. Request details: <strong className="font-sans font-bold text-slate-950">“{activeCertificate.description}”</strong>
                    </p>

                    <p className="indent-8">
                      The request has been reviewed through the Smart Garbage Monitoring System. The Purok Leader endorsement confirms the resident and service-area information shown above. Final issuance is subject to Barangay Captain approval.
                    </p>

                    {activeCertificate.adminMemo && (
                      <p className="indent-8">
                        Barangay verification note: <strong>{activeCertificate.adminMemo}</strong>
                      </p>
                    )}

                    <p className="indent-8">
                      Issued/recorded on <span className="font-sans font-bold">{activeCertificate.issuedAt || activeCertificate.date}</span> at Barangay {activeCertificate.barangay || certificateBarangayName}.
                    </p>

                    {activeCertificate.certificateNumber && activeCertificate.verificationCode && (
                      <p className="border-t border-slate-200 pt-3 text-[10px] font-sans text-slate-600">
                        Certificate No. <strong>{activeCertificate.certificateNumber}</strong><br />
                        Verification Code: <strong className="font-mono">{activeCertificate.verificationCode}</strong>
                      </p>
                    )}
                  </div>

                  {/* ENDORSER SIGNATURE CARD */}
                  <div className="flex flex-col sm:flex-row justify-between items-end pt-12 px-4 md:px-12 text-center font-sans tracking-tight gap-6 z-10">
                    {/* Left: Purok Leader signature (which has been completed during endorsement) */}
                    <div className="space-y-1.5 min-w-[180px] text-left">
                      <p className="text-[11px] text-slate-500 italic font-medium font-sans">Certified & Endorsed by:</p>
                      <div className="pt-2">
                        <span className="text-[11px] text-indigo-600 font-serif font-black italic block leading-none">Verified Purok Leader</span>
                        <strong className="text-xs text-slate-900 font-bold block border-b border-slate-350 pb-0.5">
                          {activeCertificate.endorsedBy ||
                            'Awaiting Purok Leader'}
                        </strong>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider font-sans">
                          Purok Leader / Verifier
                        </span>
                      </div>
                    </div>

                    {/* Right: Chairman signature (only visible/stamped when fully approved) */}
                    <div className="space-y-1.5 min-w-[220px] text-center">
                      <p className="text-[11px] text-slate-500 italic font-medium font-sans">Approved & Issued by:</p>
                      <div className="pt-2">
                        {activeCertificate?.status === 'Barangay Approved' ? (
                          <>
                            <span className="text-xs text-emerald-600 font-serif font-bold italic block leading-none">✓ Official Digitally Signed</span>
                            <strong className="text-xs md:text-sm text-slate-950 font-extrabold tracking-wide uppercase block border-b-2 border-slate-950 pb-0.5">
                              HON. {certificateApproverName.toUpperCase()}
                            </strong>
                            <span className="text-[10px] md:text-xs font-black uppercase tracking-wider text-slate-500 block font-sans">
                              Barangay Captain
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-amber-600 font-serif font-medium italic block leading-none">⌛ Awaiting Admin Review</span>
                            <strong className="text-xs md:text-sm text-slate-400 font-bold tracking-wide uppercase block border-b-2 border-slate-200 pb-0.5">
                              HON. {certificateApproverName.toUpperCase()}
                            </strong>
                            <span className="text-[10px] md:text-xs font-black uppercase tracking-wider text-slate-300 block font-sans">
                              Barangay Captain
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

              </div>
              
              {/* MOBILE BOTTOM OVERLAY COMMANDBAR */}
              <div className="bg-slate-900 px-6 py-4 flex justify-between items-center shrink-0 lg:hidden print:hidden border-t border-slate-850">
                <button
                  onClick={() => setActiveCertificate(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black rounded-lg transition-all"
                >
                  ✕ Close
                </button>
                {activeCertificate.status === 'Barangay Approved' ? (
                  <button
                    onClick={() => window.print()}
                    className="px-5 py-2.5 bg-[#05BC8F] hover:bg-[#049a75] text-white text-xs font-black rounded-lg shadow-md transition-all flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Certificate
                  </button>
                ) : (
                  <span className="text-[10px] font-bold uppercase text-amber-300">
                    Awaiting final approval
                  </span>
                )}
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
