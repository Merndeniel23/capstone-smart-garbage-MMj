import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  Eye,
  History,
  Loader2,
  Mail,
  MapPin,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  User,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { apiRequest } from "../services/api";
import { notifyAdminActionCountsChanged } from "../hooks/useAdminActionCounts";
import ConfirmDialog from "./ConfirmDialog";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";
import MobileDetailSheet from "./MobileDetailSheet";

export type PurokMembersTab = "members" | "activity" | "payments" | "history";

type DirectoryStatus = "active" | "pending" | "inactive";

type DirectoryMember = {
  id: number;
  name: string;
  email: string;
  phone: string;
  communalZone: string;
  address: string;
  householdId: string;
  status: DirectoryStatus;
  canDelete: boolean;
  profilePhoto?: string | null;
  currentMonthContribution: number;
  previousMonthContribution: number;
  previousMonthComplete: boolean;
  barangay?: string;
  purok?: string;
  createdAt?: string;
};

type DatabaseUser = {
  id: number | string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  role?: string | null;
  status?: string | null;
  can_delete?: boolean;
  barangay_id?: number | null;
  barangay_name?: string | null;
  purok_id?: number | null;
  purok_name?: string | null;
  profile_photo?: string | null;
  current_month_contribution?: number | string | null;
  previous_month_contribution?: number | string | null;
  previous_month_complete?: number | boolean | null;
  created_at?: string | null;
};

type CurrentUser = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
};

type CollectorScanRecord = {
  id: number;
  resident_id: number;
  household_name: string;
  bin_code: string;
  purok_name?: string;
  collector_name: string;
  segregation: "segregated" | "not_segregated";
  collection_status: string;
  not_collected_reason?: string | null;
  collected_at: string;
  decision_action?: string | null;
};

type ResidentPaymentRecord = {
  id: number;
  transaction_code: string;
  resident_id: number;
  resident_name?: string;
  amount: number | string;
  category: string;
  billing_period?: string | null;
  payment_method: string;
  payment_reference?: string | null;
  receipt_proof?: string | null;
  status: string;
  leader_name?: string | null;
  leader_verified_at?: string | null;
  leader_remarks?: string | null;
  created_at: string;
};

type ViolationRecord = {
  id: number;
  collection_id?: number | null;
  resident_id: number;
  household_name: string;
  bin_code?: string | null;
  action: "warning" | "fine" | "suspension" | string;
  fine_amount?: number | string | null;
  suspension_scope?: string | null;
  suspension_until?: string | null;
  reason: string;
  issued_by_name: string;
  issued_at: string;
  review_decision?: string | null;
  review_reason?: string | null;
};

type ActivityLogRow = {
  id: number;
  actor_name: string;
  actor_role: string;
  resident_id?: number | null;
  action: string;
  entity_type: string;
  entity_id: number;
  details?: any;
  occurred_at: string;
};

const ACTIVITY_LABELS: Record<string, string> = {
  collection_segregated: "QR Scan: ✓ Segregated",
  collection_not_segregated: "QR Scan: ✗ Not Segregated",
  collection_recorded: "QR Bin Scanned",
  violation_warning_issued: "Warning Issued",
  violation_fine_issued: "Fine Issued (Pay Violation)",
  violation_suspension_issued: "Suspension Issued",
  violation_reviewed: "Violation Reviewed by Captain",
  payment_received_verified: "Payment Verified",
  manual_payment_verified: "Payment Verified",
  manual_payment_rejected: "Payment Rejected",
  endorsement_released: "Endorsement Released",
  endorsement_approved: "Endorsement Approved",
  endorsement_rejected: "Endorsement Rejected",
  household_registered: "Household Registered",
  household_updated: "Household Updated",
  bin_qr_registered: "Household QR Generated",
  record_archived: "Record Archived",
  record_restored: "Record Restored",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Barangay Captain",
  purok_leader: "Purok Leader",
  collector: "Collector",
  resident: "Resident",
  system: "System",
};

function formatManilaDateTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function formatActivityDetails(row: ActivityLogRow) {
  let details = row.details;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  return (
    [
      details?.binCode && `QR ${details.binCode}`,
      details?.household,
      details?.fineAmount && `₱${Number(details.fineAmount).toFixed(2)}`,
      details?.reason,
      details?.remarks,
    ]
      .filter(Boolean)
      .join(" · ") || `${row.entity_type} #${row.entity_id}`
  );
}

function formatDecisionLabel(row: ViolationRecord) {
  if (row.action === "fine") {
    return `Fine · ₱${Number(row.fine_amount || 0).toFixed(2)}`;
  }
  if (row.action === "suspension") {
    return `Suspended (${
      row.suspension_scope === "account" ? "Account" : "Collection"
    })${
      row.suspension_until
        ? ` until ${formatManilaDateTime(row.suspension_until)}`
        : ""
    }`;
  }
  return "Warning";
}

function normalizePurok(value?: string | null) {
  const match = String(value || "").match(/purok\s*\S+/i);
  return match ? match[0].replace(/\s+/g, " ") : String(value || "").trim();
}

function formatJoinedDate(value?: string) {
  if (!value) return "Registration date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(status?: DirectoryStatus) {
  if (status === "inactive") return "Inactive";
  if (status === "pending") return "Pending";
  return "Active";
}

function statusClasses(status?: DirectoryStatus) {
  if (status === "inactive") return "bg-rose-50 text-rose-600";
  if (status === "pending") return "bg-amber-50 text-amber-600";
  return "bg-emerald-50 text-emerald-600";
}

function mapDatabaseUser(user: DatabaseUser): DirectoryMember {
  return {
    id: Number(user.id),
    name: String(user.full_name || "Unnamed user"),
    email: String(user.email || ""),
    canDelete: Boolean(user.can_delete),
    phone: String(user.phone || ""),
    communalZone: [user.purok_name, user.barangay_name]
      .filter(Boolean)
      .join(", "),
    address: String(user.address || ""),
    householdId:
      user.role === "resident"
        ? `HH-${String(user.id).padStart(4, "0")}`
        : `USR-${String(user.id).padStart(4, "0")}`,
    barangay: user.barangay_name || undefined,
    purok: user.purok_name || undefined,
    status:
      user.status === "inactive"
        ? "inactive"
        : user.status === "pending"
          ? "pending"
          : "active",
    profilePhoto: user.profile_photo || null,
    currentMonthContribution: Number(user.current_month_contribution || 0),
    previousMonthContribution: Number(user.previous_month_contribution || 0),
    previousMonthComplete: Boolean(Number(user.previous_month_complete)),
    createdAt: user.created_at || undefined,
  };
}

function QuickDecisionForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: {
    action: "warning" | "fine" | "suspension";
    fineAmount?: number;
    suspensionDays?: number;
    suspensionScope?: "collection" | "account";
    reason: string;
  }) => Promise<boolean>;
}) {
  const [action, setAction] = useState<"warning" | "fine" | "suspension">(
    "warning",
  );
  const [fineAmount, setFineAmount] = useState("");
  const [days, setDays] = useState("7");
  const [scope, setScope] = useState<"collection" | "account">("collection");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["warning", "Warning"],
            ["fine", "Fine (Pay Violation)"],
            ["suspension", "Suspend"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => {
              setAction(val);
              setError("");
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs font-black transition ${
              action === val
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {action === "fine" && (
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={fineAmount}
          onChange={(e) => setFineAmount(e.target.value)}
          placeholder="Violation fine amount in PHP (e.g. 100)"
          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
        />
      )}

      {action === "suspension" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="number"
            min="1"
            max="3650"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="Suspension days"
            className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
          />
          <select
            value={scope}
            onChange={(e) =>
              setScope(e.target.value as "collection" | "account")
            }
            className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
          >
            <option value="collection">Suspend Garbage Collection</option>
            <option value="account">Suspend Account Access</option>
          </select>
        </div>
      )}

      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. Mixed waste / unsegregated household bin)..."
        className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
      />

      {error && <p className="text-xs font-bold text-rose-700">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!reason.trim()) {
            setError("Please enter the reason for this decision.");
            return;
          }
          if (action === "fine" && !(Number(fineAmount) > 0)) {
            setError("Enter a valid fine amount in PHP.");
            return;
          }
          if (
            action === "suspension" &&
            !(
              Number.isInteger(Number(days)) &&
              Number(days) >= 1 &&
              Number(days) <= 3650
            )
          ) {
            setError("Enter suspension days from 1 to 3650.");
            return;
          }
          setError("");
          const ok = await onSubmit({
            action,
            fineAmount: action === "fine" ? Number(fineAmount) : undefined,
            suspensionDays: action === "suspension" ? Number(days) : undefined,
            suspensionScope: action === "suspension" ? scope : undefined,
            reason: reason.trim(),
          });
          if (ok) {
            setReason("");
            setFineAmount("");
            setAction("warning");
          }
        }}
        className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-800 disabled:opacity-50"
      >
        {busy ? "Saving..." : "Save Leader Decision"}
      </button>
    </div>
  );
}

export default function MembersList({
  initialTab = "members",
}: {
  initialTab?: PurokMembersTab;
}) {
  const [activeTab, setActiveTab] = useState<PurokMembersTab>(initialTab);
  const [memberQuickFilter, setMemberQuickFilter] = useState<
    "all" | "needs_action" | "segregated" | "not_segregated" | "pending_payment"
  >("all");
  const [scanFilter, setScanFilter] = useState<
    "all" | "not_segregated" | "segregated"
  >("all");
  const [historySubTab, setHistorySubTab] = useState<
    "all" | "scans" | "violations" | "payments"
  >("all");
  const [historySearch, setHistorySearch] = useState("");
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(
    null,
  );

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [databaseMembers, setDatabaseMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  // Mobile-only: the first member is auto-selected for desktop, so the sheet
  // opens only when the leader actually taps a household.
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DirectoryMember | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deletingRef = useRef(false);

  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [collectorScans, setCollectorScans] = useState<CollectorScanRecord[]>(
    [],
  );
  const [residentPayments, setResidentPayments] = useState<
    ResidentPaymentRecord[]
  >([]);
  const [paymentHistory, setPaymentHistory] = useState<ResidentPaymentRecord[]>(
    [],
  );
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);

  const [verifyingPaymentId, setVerifyingPaymentId] = useState<number | null>(
    null,
  );
  const [paymentRemarks, setPaymentRemarks] = useState<Record<number, string>>(
    {},
  );
  const [submittingViolation, setSubmittingViolation] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const canManageUsers =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const isPurokLeader = currentUser?.role === "purok_leader";

  const leaderPurok = useMemo(
    () => normalizePurok(currentUser?.purok_name),
    [currentUser?.purok_name],
  );

  const loadDatabaseMembers = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setActionMessage(null);
    }

    try {
      const profileData = await apiRequest<{
        success: boolean;
        user?: CurrentUser;
      }>("/auth/me");

      const profile = profileData.user;
      if (!profile) {
        throw new Error("The signed-in account could not be loaded.");
      }

      const canViewDirectory =
        profile.role === "admin" ||
        profile.role === "super_admin" ||
        profile.role === "purok_leader";

      if (!canViewDirectory) {
        throw new Error("Administrator or Purok Leader access is required.");
      }

      setCurrentUser(profile);

      const endpoint =
        profile.role === "purok_leader"
          ? "/admin/purok-members"
          : "/admin/users";

      const [
        usersRes,
        scansRes,
        paymentsRes,
        payHistoryRes,
        violationsRes,
        activityRes,
      ] = await Promise.allSettled([
        apiRequest<{
          success: boolean;
          users?: DatabaseUser[];
          collections?: CollectorScanRecord[];
          pendingPayments?: ResidentPaymentRecord[];
        }>(endpoint),
        apiRequest<{ collections?: CollectorScanRecord[] }>("/sgms/collections"),
        apiRequest<{ payments?: ResidentPaymentRecord[] }>("/payments"),
        apiRequest<{ payments?: ResidentPaymentRecord[] }>(
          "/sgms/payment-history",
        ),
        apiRequest<{ violations?: ViolationRecord[] }>("/sgms/violations"),
        apiRequest<{ activities?: ActivityLogRow[] }>("/sgms/activity"),
      ]);

      if (usersRes.status === "rejected") {
        throw usersRes.reason;
      }

      const data = usersRes.value;
      const rows = Array.isArray(data.users) ? data.users : [];
      const mappedMembers = rows
        .filter((user) => user.role === "resident")
        .map(mapDatabaseUser);

      setDatabaseMembers(mappedMembers);

      const loadedScans =
        scansRes.status === "fulfilled" &&
        Array.isArray(scansRes.value.collections)
          ? scansRes.value.collections
          : Array.isArray(data.collections)
            ? data.collections
            : [];
      setCollectorScans(loadedScans);

      const loadedPayments =
        paymentsRes.status === "fulfilled" &&
        Array.isArray(paymentsRes.value.payments)
          ? paymentsRes.value.payments
          : Array.isArray(data.pendingPayments)
            ? data.pendingPayments
            : [];
      setResidentPayments(loadedPayments);

      setPaymentHistory(
        payHistoryRes.status === "fulfilled" &&
          Array.isArray(payHistoryRes.value.payments)
          ? payHistoryRes.value.payments
          : loadedPayments,
      );

      setViolations(
        violationsRes.status === "fulfilled" &&
          Array.isArray(violationsRes.value.violations)
          ? violationsRes.value.violations
          : [],
      );

      setActivityLogs(
        activityRes.status === "fulfilled" &&
          Array.isArray(activityRes.value.activities)
          ? activityRes.value.activities
          : [],
      );

      setSelectedMemberId((prev) => {
        if (prev && mappedMembers.some((m) => m.id === prev)) return prev;
        return mappedMembers[0]?.id ?? null;
      });

      return true;
    } catch (error) {
      if (!silent) {
        setDatabaseMembers([]);
      }
      setActionMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Unable to load records.",
      });
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDatabaseMembers();
  }, [loadDatabaseMembers]);

  const scansByResident = useMemo(() => {
    const map = new Map<number, CollectorScanRecord[]>();
    for (const scan of collectorScans) {
      const residentId = Number(scan.resident_id);
      if (!map.has(residentId)) map.set(residentId, []);
      map.get(residentId)!.push(scan);
    }
    return map;
  }, [collectorScans]);

  const violationsByResident = useMemo(() => {
    const map = new Map<number, ViolationRecord[]>();
    for (const v of violations) {
      const residentId = Number(v.resident_id);
      if (!map.has(residentId)) map.set(residentId, []);
      map.get(residentId)!.push(v);
    }
    return map;
  }, [violations]);

  const paymentsHistoryByResident = useMemo(() => {
    const map = new Map<number, ResidentPaymentRecord[]>();
    for (const p of paymentHistory) {
      const residentId = Number(p.resident_id);
      if (!map.has(residentId)) map.set(residentId, []);
      map.get(residentId)!.push(p);
    }
    return map;
  }, [paymentHistory]);

  const pendingPayments = useMemo(
    () =>
      residentPayments.filter(
        (payment) =>
          payment.status === "pending_leader_verification" ||
          payment.status === "pending",
      ),
    [residentPayments],
  );

  const pendingPaymentsByResident = useMemo(() => {
    const map = new Map<number, ResidentPaymentRecord[]>();
    for (const payment of pendingPayments) {
      const residentId = Number(payment.resident_id);
      if (!map.has(residentId)) map.set(residentId, []);
      map.get(residentId)!.push(payment);
    }
    return map;
  }, [pendingPayments]);

  const undecidedNotSegregatedScans = useMemo(
    () =>
      collectorScans.filter(
        (scan) => scan.segregation === "not_segregated" && !scan.decision_action,
      ),
    [collectorScans],
  );

  const segregatedScanCount = useMemo(
    () =>
      collectorScans.filter((scan) => scan.segregation === "segregated").length,
    [collectorScans],
  );

  const members = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return databaseMembers
      .filter((member) => {
        const mScans = scansByResident.get(member.id) || [];
        const latest = mScans[0] || null;
        const hasUndecided = mScans.some(
          (s) => s.segregation === "not_segregated" && !s.decision_action,
        );
        const hasPendingPay =
          (pendingPaymentsByResident.get(member.id) || []).length > 0;

        if (memberQuickFilter === "needs_action") {
          return hasUndecided || hasPendingPay;
        }
        if (memberQuickFilter === "segregated") {
          return latest?.segregation === "segregated";
        }
        if (memberQuickFilter === "not_segregated") {
          return latest?.segregation === "not_segregated";
        }
        if (memberQuickFilter === "pending_payment") {
          return hasPendingPay;
        }
        return true;
      })
      .filter((member) => {
        if (!normalizedSearch) return true;
        return [
          member.name,
          member.email,
          member.phone,
          member.householdId,
          member.address,
          member.purok,
          member.barangay,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedSearch),
          );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    databaseMembers,
    memberQuickFilter,
    pendingPaymentsByResident,
    scansByResident,
    searchTerm,
  ]);

  const memberPageCount = Math.max(1, Math.ceil(members.length / memberPageSize));
  const visibleMembers = useMemo(() => {
    const safePage = Math.min(memberPage, memberPageCount);
    const start = (safePage - 1) * memberPageSize;
    return members.slice(start, start + memberPageSize);
  }, [members, memberPage, memberPageCount, memberPageSize]);

  useEffect(() => {
    setMemberPage(1);
  }, [searchTerm, memberQuickFilter]);

  const selectedMember =
    databaseMembers.find((member) => member.id === selectedMemberId) || null;

  const filteredScans = useMemo(() => {
    if (scanFilter === "all") return collectorScans;
    return collectorScans.filter((scan) => scan.segregation === scanFilter);
  }, [collectorScans, scanFilter]);

  const filteredHistoryActivities = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return activityLogs;
    return activityLogs.filter((row) =>
      [
        row.actor_name,
        ACTIVITY_LABELS[row.action] || row.action,
        formatActivityDetails(row),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [activityLogs, historySearch]);

  const filteredHistoryScans = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return collectorScans;
    return collectorScans.filter((row) =>
      [row.household_name, row.bin_code, row.collector_name, row.purok_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [collectorScans, historySearch]);

  const filteredHistoryViolations = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return violations;
    return violations.filter((row) =>
      [row.household_name, row.bin_code, row.action, row.reason, row.issued_by_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [violations, historySearch]);

  const filteredHistoryPayments = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return paymentHistory;
    return paymentHistory.filter((row) =>
      [
        row.resident_name,
        row.transaction_code,
        row.category,
        row.payment_method,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [paymentHistory, historySearch]);

  const handleVerifyPayment = async (
    payment: ResidentPaymentRecord,
    action: "approve" | "reject",
  ) => {
    if (verifyingPaymentId !== null) return;
    setVerifyingPaymentId(payment.id);
    setActionMessage(null);
    try {
      const remarks =
        (paymentRemarks[payment.id] || "").trim() ||
        (action === "approve"
          ? "Payment received and verified by Purok Leader."
          : "Payment rejected by Purok Leader.");
      const result = await apiRequest<{ message?: string }>(
        `/payments/${payment.id}/leader-verify`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, remarks }),
        },
      );
      notifyAdminActionCountsChanged();
      await loadDatabaseMembers(true);
      setActionMessage({
        type: "success",
        text:
          result.message ||
          (action === "approve"
            ? "Payment verified and saved to History."
            : "Payment rejected."),
      });
    } catch (error) {
      setActionMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Unable to verify payment.",
      });
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  const submitViolationDecision = async (params: {
    residentId?: number;
    collectionId?: number;
    action: "warning" | "fine" | "suspension";
    fineAmount?: number;
    suspensionDays?: number;
    suspensionScope?: "collection" | "account";
    reason: string;
  }): Promise<boolean> => {
    if (submittingViolation) return false;
    setSubmittingViolation(true);
    setActionMessage(null);
    try {
      const payload: Record<string, unknown> = {
        action: params.action,
        reason: params.reason,
      };
      if (params.collectionId) {
        payload.collectionId = params.collectionId;
      } else if (params.residentId) {
        payload.residentId = params.residentId;
      }
      if (params.action === "fine") {
        payload.fineAmount = params.fineAmount;
      }
      if (params.action === "suspension") {
        payload.suspensionDays = params.suspensionDays;
        payload.suspensionScope = params.suspensionScope;
      }
      const result = await apiRequest<{ message?: string }>("/sgms/violations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      notifyAdminActionCountsChanged();
      await loadDatabaseMembers(true);
      setActionMessage({
        type: "success",
        text:
          result.message ||
          "Leader decision recorded and saved to History.",
      });
      return true;
    } catch (error) {
      setActionMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to record violation decision.",
      });
      return false;
    } finally {
      setSubmittingViolation(false);
    }
  };

  const handleDeleteMember = async (member: DirectoryMember) => {
    if (deletingRef.current || !member.canDelete || currentUser?.id === member.id)
      return;
    deletingRef.current = true;
    setDeletingId(member.id);
    setActionMessage(null);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `/admin/users/${member.id}`,
        { method: "DELETE" },
      );
      setSelectedMemberId(null);
      setDatabaseMembers((prev) => prev.filter((item) => item.id !== member.id));
      notifyAdminActionCountsChanged();
      await loadDatabaseMembers(true);
      setActionMessage({
        type: "success",
        text: data.message || "User deleted successfully.",
      });
      setDeleteConfirmation(null);
    } catch (error) {
      setActionMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to delete user.",
      });
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            {isPurokLeader
              ? `${leaderPurok || "My Purok"} · Unified Operations`
              : "Household Directory & Activity"}
          </span>
          <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">
            Purok Members &amp; Activity Log
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">
            Verify resident payments, review Collector QR scans (✓ Segregated / ✗ Not Segregated), issue violation decisions, and view full history in one place.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDatabaseMembers()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-60 md:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {actionMessage && (
        <div
          role={actionMessage.type === "error" ? "alert" : "status"}
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            actionMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* 4 Actionable KPI Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            setActiveTab("members");
            setMemberQuickFilter("all");
          }}
          className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-xs transition hover:border-emerald-300"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Purok Households
            </p>
            <Users className="h-5 w-5 text-slate-400" />
          </div>
          <p className="mt-2 text-3xl font-black text-slate-900">
            {loading ? "—" : databaseMembers.length}
          </p>
          <p className="mt-1 text-[11px] font-bold text-slate-500">
            Registered households
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("activity");
            setScanFilter("segregated");
          }}
          className="rounded-3xl border border-emerald-200 bg-white p-5 text-left shadow-xs transition hover:border-emerald-400"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
              ✓ Segregated Scans
            </p>
            <Check className="h-5 w-5 stroke-[3] text-emerald-600" />
          </div>
          <p className="mt-2 text-3xl font-black text-emerald-700">
            {loading ? "—" : segregatedScanCount}
          </p>
          <p className="mt-1 text-[11px] font-bold text-emerald-700/80">
            Followed segregation policy
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("activity");
            setScanFilter("not_segregated");
          }}
          className="rounded-3xl border border-rose-200 bg-white p-5 text-left shadow-xs transition hover:border-rose-400"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">
              ✗ Not Segregated
            </p>
            <X className="h-5 w-5 stroke-[3] text-rose-600" />
          </div>
          <p className="mt-2 text-3xl font-black text-rose-700">
            {loading ? "—" : undecidedNotSegregatedScans.length}
          </p>
          <p className="mt-1 text-[11px] font-bold text-rose-700/80">
            Waiting for Leader decision
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("payments")}
          className="rounded-3xl border border-amber-200 bg-white p-5 text-left shadow-xs transition hover:border-amber-400"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">
              Verify Payments
            </p>
            <CreditCard className="h-5 w-5 text-amber-600" />
          </div>
          <p className="mt-2 text-3xl font-black text-amber-700">
            {loading ? "—" : pendingPayments.length}
          </p>
          <p className="mt-1 text-[11px] font-bold text-amber-700/80">
            Pending resident payments
          </p>
        </button>
      </section>

      {/* Main Unified Navigation Bar inside Purok Members (tabs + member filters in one card) */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex gap-1.5 overflow-x-auto p-2">
        {(
          [
            {
              id: "members" as PurokMembersTab,
              label: "Purok Members",
              icon: Users,
              badge: 0,
            },
            {
              id: "activity" as PurokMembersTab,
              label: "Activity Log (QR Scan Results)",
              icon: QrCode,
              badge: undecidedNotSegregatedScans.length,
            },
            {
              id: "payments" as PurokMembersTab,
              label: "Verify Payments",
              icon: CreditCard,
              badge: pendingPayments.length,
            },
            {
              id: "history" as PurokMembersTab,
              label: "Full History",
              icon: History,
              badge: 0,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                active
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {tab.badge > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    active
                      ? "bg-white text-emerald-800"
                      : "bg-rose-600 text-white"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {activeTab === "members" && (
          <div className="flex flex-col gap-3 border-t border-slate-100 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5" aria-label="Member filters">
              {(
                [
                  ["all", "All Members"],
                  ["needs_action", "Needs Action"],
                  ["segregated", "✓ Segregated"],
                  ["not_segregated", "✗ Not Segregated"],
                  ["pending_payment", "Pending Payment"],
                ] as const
              ).map(([filterKey, label]) => (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setMemberQuickFilter(filterKey)}
                  aria-pressed={memberQuickFilter === filterKey}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    memberQuickFilter === filterKey
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search household, ID, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-xs font-medium focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
      )}
      </div>

      {/* TAB 1: PUROK MEMBERS DIRECTORY + UNIFIED SIDE DRAWER */}
      {activeTab === "members" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="space-y-3 xl:col-span-2">
              {!loading && members.length > 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white px-4 pb-3 shadow-xs">
                  <Pagination
                    page={memberPage}
                    pageSize={memberPageSize}
                    totalItems={members.length}
                    itemLabel="members"
                    compact
                    onPageChange={setMemberPage}
                    onPageSizeChange={(next) => {
                      setMemberPageSize(next);
                      setMemberPage(1);
                    }}
                  />
                </div>
              )}

              {loading ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-slate-100 bg-white">
                  <div className="text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
                    <p className="mt-3 text-xs font-bold text-slate-500">
                      Loading purok households...
                    </p>
                  </div>
                </div>
              ) : members.length > 0 ? (
                visibleMembers.map((member) => {
                  const isSelected = selectedMemberId === member.id;
                  const memberScans = scansByResident.get(member.id) || [];
                  const latestScan = memberScans[0] || null;
                  const hasUndecided = memberScans.some(
                    (s) =>
                      s.segregation === "not_segregated" && !s.decision_action,
                  );
                  const memberPendingPays =
                    pendingPaymentsByResident.get(member.id) || [];

                  return (
                    <motion.button
                      type="button"
                      key={member.id}
                      whileHover={{ scale: 1.003 }}
                      onClick={() => {
                        setSelectedMemberId(member.id);
                        setMemberSheetOpen(true);
                      }}
                      className={`flex w-full flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition sm:flex-row sm:items-center ${
                        isSelected
                          ? "border-emerald-600 ring-2 ring-emerald-500/15"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-emerald-50">
                        {member.profilePhoto ? (
                          <img
                            src={member.profilePhoto}
                            alt={member.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="h-5 w-5 text-emerald-700" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-black text-slate-900">
                            {member.name}
                          </h3>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                            {member.householdId}
                          </span>

                          {latestScan && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                                latestScan.segregation === "segregated"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {latestScan.segregation === "segregated"
                                ? "✓ Segregated"
                                : "✗ Not Segregated"}
                            </span>
                          )}

                          {hasUndecided && (
                            <span className="inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                              Needs Decision
                            </span>
                          )}

                          {memberPendingPays.length > 0 && (
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-800">
                              Verify Payment ({memberPendingPays.length})
                            </span>
                          )}
                        </div>

                        <p className="mt-1 truncate text-xs text-slate-500">
                          {member.address || member.purok || "No address"} ·{" "}
                          {member.phone || "No phone"}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${statusClasses(
                            member.status,
                          )}`}
                        >
                          {statusLabel(member.status)}
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700">
                          Manage →
                        </span>
                      </div>
                    </motion.button>
                  );
                })
              ) : (
                <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-10 text-center">
                  <UserRoundCheck className="mx-auto h-10 w-10 text-slate-300" />
                  <h3 className="mt-3 font-black text-slate-700">
                    No matching households
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Try changing the filter or search query above.
                  </p>
                </div>
              )}
            </div>

            {/* Right Column: Selected Household All-in-One Card
                (below lg: a slide-up sheet opened by tapping a household) */}
            <MobileDetailSheet
              open={memberSheetOpen && Boolean(selectedMember)}
              onClose={() => setMemberSheetOpen(false)}
              title={selectedMember ? `${selectedMember.name} · ${selectedMember.householdId}` : "Household"}
              className="xl:col-span-1"
            >
              <AnimatePresence mode="wait">
                {selectedMember ? (
                  <motion.aside
                    key={selectedMember.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="bg-slate-900 p-5 text-white">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-emerald-500/20">
                          {selectedMember.profilePhoto ? (
                            <img
                              src={selectedMember.profilePhoto}
                              alt={selectedMember.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <User className="h-6 w-6 text-emerald-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-black">
                            {selectedMember.name}
                          </h3>
                          <p className="text-[11px] font-bold text-emerald-300">
                            {selectedMember.householdId} ·{" "}
                            {selectedMember.purok || leaderPurok}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 p-5">
                      {/* 1. Collector QR Scan Status & Violation Decision */}
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <QrCode className="h-4 w-4 text-emerald-700" />
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                              Collector QR Scan Result
                            </h4>
                          </div>
                        </div>

                        {(() => {
                          const scans =
                            scansByResident.get(selectedMember.id) || [];
                          const latest = scans[0] || null;
                          const undecided = scans.find(
                            (s) =>
                              s.segregation === "not_segregated" &&
                              !s.decision_action,
                          );

                          return (
                            <>
                              {latest ? (
                                <div
                                  className={`rounded-2xl border p-3.5 ${
                                    latest.segregation === "segregated"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                      : "border-rose-200 bg-rose-50 text-rose-900"
                                  }`}
                                >
                                  <p className="text-xs font-black">
                                    {latest.segregation === "segregated"
                                      ? "✓ Segregated (Policy Followed)"
                                      : "✗ Not Segregated (Policy Violated)"}{" "}
                                    · QR {latest.bin_code}
                                  </p>
                                  <p className="mt-1 text-[11px] font-medium opacity-80">
                                    Scanned by {latest.collector_name} ·{" "}
                                    {formatManilaDateTime(latest.collected_at)}
                                  </p>
                                  {latest.decision_action && (
                                    <p className="mt-1.5 inline-flex rounded-lg bg-white/80 px-2 py-0.5 text-[10px] font-black uppercase">
                                      Leader Decision: {latest.decision_action}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500">
                                  No Collector QR scans recorded for this household yet.
                                </p>
                              )}

                              {isPurokLeader && (
                                <div className="space-y-2 border-t border-slate-200 pt-3">
                                  <p className="text-[11px] font-black text-slate-700">
                                    {undecided
                                      ? `Action Needed for ✗ Not Segregated Scan (QR ${undecided.bin_code}):`
                                      : "Issue Warning, Fine (Pay Violation), or Suspend:"}
                                  </p>
                                  <QuickDecisionForm
                                    busy={submittingViolation}
                                    onSubmit={(vals) =>
                                      submitViolationDecision({
                                        ...vals,
                                        collectionId: undecided?.id,
                                        residentId: selectedMember.id,
                                      })
                                    }
                                  />
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* 2. Verify Resident Payment */}
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-emerald-700" />
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                              Verify Payment
                            </h4>
                          </div>
                          <span className="text-[11px] font-black text-emerald-700">
                            This Month: ₱
                            {selectedMember.currentMonthContribution.toFixed(2)}
                          </span>
                        </div>

                        {(() => {
                          const pendingList =
                            pendingPaymentsByResident.get(selectedMember.id) ||
                            [];
                          if (pendingList.length === 0) {
                            return (
                              <p className="text-xs text-slate-500">
                                No pending payments waiting for verification.
                              </p>
                            );
                          }
                          return (
                            <div className="space-y-3">
                              {pendingList.map((payment) => (
                                <div
                                  key={payment.id}
                                  className="space-y-2 rounded-xl border border-amber-200 bg-white p-3"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-black text-slate-900">
                                      ₱{Number(payment.amount).toFixed(2)} ·{" "}
                                      {payment.category.replaceAll("_", " ")}
                                    </span>
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                                      {payment.payment_method}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500">
                                    Ref: {payment.transaction_code} ·{" "}
                                    {payment.billing_period || "Current period"}
                                  </p>
                                  {payment.receipt_proof && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReceiptPreviewUrl(
                                          payment.receipt_proof || null,
                                        )
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 hover:underline"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      View Receipt Proof
                                    </button>
                                  )}
                                  <input
                                    type="text"
                                    value={paymentRemarks[payment.id] || ""}
                                    onChange={(e) =>
                                      setPaymentRemarks((prev) => ({
                                        ...prev,
                                        [payment.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Verification remarks (optional)"
                                    className="w-full rounded-lg border border-slate-200 p-2 text-xs"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      disabled={verifyingPaymentId !== null}
                                      onClick={() =>
                                        void handleVerifyPayment(
                                          payment,
                                          "approve",
                                        )
                                      }
                                      className="flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      Verify Paid
                                    </button>
                                    <button
                                      type="button"
                                      disabled={verifyingPaymentId !== null}
                                      onClick={() =>
                                        void handleVerifyPayment(
                                          payment,
                                          "reject",
                                        )
                                      }
                                      className="flex items-center justify-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      Reject
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* 3. Household History Summary (Scans, Violations, Payments) */}
                      <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <History className="h-4 w-4 text-emerald-700" />
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                              Household History
                            </h4>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setHistorySearch(selectedMember.name);
                              setActiveTab("history");
                            }}
                            className="text-[11px] font-black text-emerald-700 hover:underline"
                          >
                            Full log →
                          </button>
                        </div>

                        {(() => {
                          const mScans = (
                            scansByResident.get(selectedMember.id) || []
                          ).slice(0, 3);
                          const mViolations = (
                            violationsByResident.get(selectedMember.id) || []
                          ).slice(0, 3);
                          const mPays = (
                            paymentsHistoryByResident.get(selectedMember.id) ||
                            []
                          ).slice(0, 3);

                          if (
                            !mScans.length &&
                            !mViolations.length &&
                            !mPays.length
                          ) {
                            return (
                              <p className="text-xs text-slate-500">
                                No historical scans, violations, or payments yet.
                              </p>
                            );
                          }

                          return (
                            <div className="space-y-2 text-xs">
                              {mScans.map((s) => (
                                <div
                                  key={`s-${s.id}`}
                                  className={`rounded-xl border bg-white p-2.5 ${
                                    s.segregation === "segregated"
                                      ? "border-emerald-100"
                                      : "border-rose-100"
                                  }`}
                                >
                                  <p
                                    className={`font-black ${
                                      s.segregation === "segregated"
                                        ? "text-emerald-800"
                                        : "text-rose-800"
                                    }`}
                                  >
                                    {s.segregation === "segregated"
                                      ? "✓ Segregated"
                                      : "✗ Not Segregated"}{" "}
                                    · QR {s.bin_code}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Scanned by {s.collector_name} ·{" "}
                                    {formatManilaDateTime(s.collected_at)}
                                  </p>
                                </div>
                              ))}
                              {mViolations.map((v) => (
                                <div
                                  key={`v-${v.id}`}
                                  className="rounded-xl border border-rose-100 bg-white p-2.5"
                                >
                                  <p className="font-black text-rose-800">
                                    {formatDecisionLabel(v)}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {v.reason} · {formatManilaDateTime(v.issued_at)}
                                  </p>
                                </div>
                              ))}
                              {mPays.map((p) => (
                                <div
                                  key={`p-${p.id}`}
                                  className="rounded-xl border border-slate-200 bg-white p-2.5"
                                >
                                  <p className="font-black text-slate-800">
                                    ₱{Number(p.amount).toFixed(2)} ·{" "}
                                    {p.status.replaceAll("_", " ")}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {p.transaction_code} ·{" "}
                                    {formatManilaDateTime(p.created_at)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Contact Details */}
                      <div className="space-y-2 pt-1 text-xs">
                        <DetailRow
                          icon={Mail}
                          label="Email"
                          value={selectedMember.email}
                        />
                        <DetailRow
                          icon={Phone}
                          label="Phone"
                          value={selectedMember.phone || "Not provided"}
                        />
                        <DetailRow
                          icon={MapPin}
                          label="Address"
                          value={selectedMember.address || "Not provided"}
                        />
                        <DetailRow
                          icon={CalendarDays}
                          label="Registered"
                          value={formatJoinedDate(selectedMember.createdAt)}
                        />
                      </div>

                      {selectedMember.canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmation(selectedMember)}
                          disabled={deletingId !== null}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-rose-700 disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete User
                        </button>
                      )}
                    </div>
                  </motion.aside>
                ) : (
                  <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
                    <User className="h-10 w-10 text-slate-300" />
                    <h4 className="mt-3 font-black text-slate-600">
                      Select a Household
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      Click any household on the left to review QR scans, issue violation decisions, verify payments, and view history.
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </MobileDetailSheet>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVITY LOG (COLLECTOR QR SCAN RESULTS & VIOLATION DECISIONS) */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          {/* Action Required: Users who did NOT follow segregation policy */}
          <section className="space-y-3 rounded-3xl border border-rose-200 bg-rose-50/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-black text-rose-900">
                  ✗ Users Who Did Not Follow Policy — Leader Decision Needed (
                  {undecidedNotSegregatedScans.length})
                </h2>
                <p className="text-xs font-medium text-rose-700">
                  Collector marked these household QR scans as ✗ Not Segregated. Choose Warning, Fine (Pay Violation), or Suspend.
                </p>
              </div>
            </div>

            {undecidedNotSegregatedScans.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                <p className="mt-2 text-sm font-black text-slate-800">
                  All Collector QR scans have been reviewed!
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Any new ✗ Not Segregated scan from the Collector will appear here immediately.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {undecidedNotSegregatedScans.map((scan) => (
                  <article
                    key={scan.id}
                    className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black text-rose-800">
                          ✗ Not Segregated · QR {scan.bin_code}
                        </span>
                        <h3 className="mt-1.5 text-base font-black text-slate-900">
                          {scan.household_name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          Scanned by {scan.collector_name} ·{" "}
                          {formatManilaDateTime(scan.collected_at)}
                        </p>
                      </div>
                    </div>

                    {isPurokLeader && <QuickDecisionForm
                      busy={submittingViolation}
                      onSubmit={(vals) =>
                        submitViolationDecision({
                          ...vals,
                          collectionId: scan.id,
                          residentId: scan.resident_id,
                        })
                      }
                    />}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* All Collector QR Scan Results (✓ Segregated & ✗ Not Segregated) */}
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Collector QR Scan Feed
                </h2>
                <p className="text-xs text-slate-500">
                  Real-time log of all ✓ Segregated and ✗ Not Segregated household scans in your purok.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", `All Scans (${collectorScans.length})`],
                    [
                      "segregated",
                      `✓ Segregated (${segregatedScanCount})`,
                    ],
                    [
                      "not_segregated",
                      `✗ Not Segregated (${
                        collectorScans.length - segregatedScanCount
                      })`,
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScanFilter(key)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-black transition ${
                      scanFilter === key
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredScans.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                No Collector QR scan records match this filter yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="p-3.5">Date &amp; Time</th>
                      <th className="p-3.5">Household</th>
                      <th className="p-3.5">QR Code</th>
                      <th className="p-3.5">Collector</th>
                      <th className="p-3.5">Result</th>
                      <th className="p-3.5">Leader Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredScans.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatManilaDateTime(row.collected_at)}
                        </td>
                        <td className="p-3.5 font-black text-slate-900">
                          {row.household_name}
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-600">
                          {row.bin_code}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {row.collector_name}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                              row.segregation === "segregated"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {row.segregation === "segregated"
                              ? "✓ Segregated"
                              : "✗ Not Segregated"}
                          </span>
                        </td>
                        <td className="p-3.5 text-xs font-bold">
                          {row.decision_action ? (
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 uppercase text-slate-700">
                              {row.decision_action}
                            </span>
                          ) : row.segregation === "not_segregated" ? (
                            <span className="text-rose-700">
                              Needs Decision Above ↑
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: VERIFY PAYMENTS */}
      {activeTab === "payments" && (
        <div className="space-y-6">
          <section className="space-y-4 rounded-3xl border border-amber-200 bg-amber-50/40 p-5">
            <div>
              <h2 className="text-lg font-black text-slate-900">
                Pending Resident Payments ({pendingPayments.length})
              </h2>
              <p className="text-xs text-slate-600">
                Verify GCash, Maya, or over-the-counter payments submitted by households in your purok.
              </p>
            </div>

            {pendingPayments.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                <p className="mt-2 text-sm font-black text-slate-800">
                  No pending payments waiting for verification
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pendingPayments.map((payment) => (
                  <article
                    key={payment.id}
                    className="space-y-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-base font-black text-slate-900">
                          {payment.resident_name ||
                            `Resident #${payment.resident_id}`}
                        </p>
                        <p className="text-xs font-bold text-emerald-700">
                          ₱{Number(payment.amount).toFixed(2)} ·{" "}
                          {payment.category.replaceAll("_", " ")}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800">
                        {payment.payment_method}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500">
                      Ref: {payment.transaction_code} ·{" "}
                      {payment.billing_period || "Current period"} ·{" "}
                      {formatManilaDateTime(payment.created_at)}
                    </p>

                    {payment.receipt_proof && (
                      <button
                        type="button"
                        onClick={() =>
                          setReceiptPreviewUrl(payment.receipt_proof || null)
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Receipt Proof
                      </button>
                    )}

                    <input
                      type="text"
                      value={paymentRemarks[payment.id] || ""}
                      onChange={(e) =>
                        setPaymentRemarks((prev) => ({
                          ...prev,
                          [payment.id]: e.target.value,
                        }))
                      }
                      placeholder="Verification remarks (optional)"
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={verifyingPaymentId !== null}
                        onClick={() =>
                          void handleVerifyPayment(payment, "approve")
                        }
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        Verify Paid
                      </button>
                      <button
                        type="button"
                        disabled={verifyingPaymentId !== null}
                        onClick={() =>
                          void handleVerifyPayment(payment, "reject")
                        }
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: FULL HISTORY (ACTIVITY LOG, SCANS, VIOLATIONS, PAYMENTS) */}
      {activeTab === "history" && (
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", `All Activity (${activityLogs.length})`],
                  ["scans", `QR Scans (${collectorScans.length})`],
                  ["violations", `Violations (${violations.length})`],
                  ["payments", `Payment History (${paymentHistory.length})`],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setHistorySubTab(tabKey)}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-black transition ${
                    historySubTab === tabKey
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search household, QR, action..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-xs font-medium focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {historySubTab === "all" && (
            <div className="overflow-x-auto">
              {filteredHistoryActivities.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  No activity logs found.
                </p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="p-3.5">Date &amp; Time</th>
                      <th className="p-3.5">Actor</th>
                      <th className="p-3.5">Role</th>
                      <th className="p-3.5">Activity</th>
                      <th className="p-3.5">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredHistoryActivities.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatManilaDateTime(row.occurred_at)}
                        </td>
                        <td className="p-3.5 font-bold text-slate-900">
                          {row.actor_name}
                        </td>
                        <td className="p-3.5 text-xs text-slate-500">
                          {ROLE_LABELS[row.actor_role] || row.actor_role}
                        </td>
                        <td className="p-3.5 text-xs font-black text-emerald-800">
                          {ACTIVITY_LABELS[row.action] ||
                            row.action.replaceAll("_", " ")}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatActivityDetails(row)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {historySubTab === "scans" && (
            <div className="overflow-x-auto">
              {filteredHistoryScans.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  No QR scan records found.
                </p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="p-3.5">Date &amp; Time</th>
                      <th className="p-3.5">Household</th>
                      <th className="p-3.5">QR Code</th>
                      <th className="p-3.5">Collector</th>
                      <th className="p-3.5">Segregation</th>
                      <th className="p-3.5">Leader Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredHistoryScans.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatManilaDateTime(row.collected_at)}
                        </td>
                        <td className="p-3.5 font-black text-slate-900">
                          {row.household_name}
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-600">
                          {row.bin_code}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {row.collector_name}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                              row.segregation === "segregated"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {row.segregation === "segregated"
                              ? "✓ Segregated"
                              : "✗ Not Segregated"}
                          </span>
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-700">
                          {row.decision_action
                            ? row.decision_action.toUpperCase()
                            : row.segregation === "not_segregated"
                              ? "Pending Decision"
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {historySubTab === "violations" && (
            <div className="overflow-x-auto">
              {filteredHistoryViolations.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  No violation history records found.
                </p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="p-3.5">Date &amp; Time</th>
                      <th className="p-3.5">Household</th>
                      <th className="p-3.5">QR / Source</th>
                      <th className="p-3.5">Decision</th>
                      <th className="p-3.5">Reason</th>
                      <th className="p-3.5">Issued By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredHistoryViolations.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatManilaDateTime(row.issued_at)}
                        </td>
                        <td className="p-3.5 font-black text-slate-900">
                          {row.household_name}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {row.bin_code || "Direct Decision"}
                        </td>
                        <td className="p-3.5 text-xs font-black text-rose-800">
                          {formatDecisionLabel(row)}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {row.reason}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {row.issued_by_name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {historySubTab === "payments" && (
            <div className="overflow-x-auto">
              {filteredHistoryPayments.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  No payment history records found.
                </p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="p-3.5">Submitted</th>
                      <th className="p-3.5">Household</th>
                      <th className="p-3.5">Reference</th>
                      <th className="p-3.5">Amount</th>
                      <th className="p-3.5">Method</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredHistoryPayments.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs text-slate-600">
                          {formatManilaDateTime(row.created_at)}
                        </td>
                        <td className="p-3.5 font-black text-slate-900">
                          {row.resident_name || `Resident #${row.resident_id}`}
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-600">
                          {row.transaction_code}
                        </td>
                        <td className="p-3.5 text-xs font-black text-emerald-800">
                          ₱{Number(row.amount).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-xs uppercase text-slate-600">
                          {row.payment_method}
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-700">
                          {row.status.replaceAll("_", " ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      )}

      {/* Receipt Preview Modal */}
      {receiptPreviewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={() => setReceiptPreviewUrl(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-900">Payment Receipt Proof</h3>
              <button
                type="button"
                onClick={() => setReceiptPreviewUrl(null)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700"
              >
                Close ✕
              </button>
            </div>
            <img
              src={receiptPreviewUrl}
              alt="Payment receipt proof"
              className="max-h-[70vh] w-full rounded-2xl object-contain"
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteConfirmation)}
        title="Delete household account?"
        description={
          deleteConfirmation ? (
            <>
              <p>
                Delete {deleteConfirmation.name} ({deleteConfirmation.email})?
                This action cannot be undone.
              </p>
              {actionMessage?.type === "error" && (
                <p
                  role="alert"
                  className="mt-3 rounded-xl bg-rose-50 p-3 font-bold text-rose-700"
                >
                  {actionMessage.text}
                </p>
              )}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete account"
        destructive
        busy={deletingId === deleteConfirmation?.id}
        onCancel={() => {
          if (!deletingId) setDeleteConfirmation(null);
        }}
        onConfirm={() => {
          if (deleteConfirmation) void handleDeleteMember(deleteConfirmation);
        }}
      />
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-100 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 break-words text-xs font-bold text-slate-700">
          {value}
        </p>
      </div>
    </div>
  );
}
