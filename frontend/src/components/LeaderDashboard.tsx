import { apiFetch } from "../services/http";
import {
  AlertTriangle,
  Award,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  MessageSquareWarning,
  QrCode,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface LeaderDashboardProps {
  setCurrentScreen: (screen: any) => void;
}

interface ProfileUser {
  id: number;
  full_name: string;
  role: string;
  barangay_name: string | null;
  purok_name: string | null;
  purok_id: number | null;
}

interface Complaint {
  id: number;
  complaint_type: string;
  reporter_name: string;
  description: string;
  status: "pending" | "assigned" | "in_progress" | "completed" | "resolved" | "cancelled";
  purok_name: string | null;
  barangay_name: string | null;
  assigned_collector_name: string | null;
  created_at: string;
}

interface CollectionScan {
  id: number;
  bin_code: string;
  household_id: number;
  household_name: string;
  purok_name?: string;
  collector_name: string;
  segregation: "segregated" | "not_segregated";
  collection_status: "collected" | "not_collected";
  collected_at: string;
  decision_action?: "warning" | "fine" | "suspension" | null;
}

interface PaymentRecord {
  id: number;
  status: string;
}

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = getToken();

  if (!token) {
    throw new Error("Login session is missing. Please log in again.");
  }

  const response = await apiFetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

function formatDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value: string) {
  if (value === "resolved") return "bg-emerald-100 text-emerald-700";
  if (value === "completed") return "bg-cyan-100 text-cyan-700";
  if (value === "assigned") return "bg-blue-100 text-blue-700";
  if (value === "in_progress") return "bg-indigo-100 text-indigo-700";
  return "bg-amber-100 text-amber-700";
}

const DASHBOARD_PREVIEW_LIMIT = 5;

export default function LeaderDashboard({ setCurrentScreen }: LeaderDashboardProps) {
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [collections, setCollections] = useState<CollectionScan[]>([]);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [householdsCount, setHouseholdsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [profileRes, complaintRes, collectionsRes, paymentsRes, membersRes] =
        await Promise.allSettled([
          apiRequest("/auth/me"),
          apiRequest("/complaints"),
          apiRequest("/sgms/collections"),
          apiRequest("/payments"),
          apiRequest("/admin/purok-members"),
        ]);

      if (profileRes.status === "rejected") {
        throw profileRes.reason;
      }

      setProfile(profileRes.value.user || null);
      setComplaints(
        complaintRes.status === "fulfilled" && Array.isArray(complaintRes.value.complaints)
          ? complaintRes.value.complaints
          : [],
      );
      setCollections(
        collectionsRes.status === "fulfilled" && Array.isArray(collectionsRes.value.collections)
          ? collectionsRes.value.collections
          : membersRes.status === "fulfilled" && Array.isArray(membersRes.value.collections)
            ? membersRes.value.collections
            : [],
      );

      if (paymentsRes.status === "fulfilled" && Array.isArray(paymentsRes.value.payments)) {
        const pending = (paymentsRes.value.payments as PaymentRecord[]).filter(
          (row) => row.status === "pending_leader_verification" || row.status === "pending",
        ).length;
        setPendingPaymentsCount(pending);
      } else if (
        membersRes.status === "fulfilled" &&
        Array.isArray(membersRes.value.pendingPayments)
      ) {
        setPendingPaymentsCount(membersRes.value.pendingPayments.length);
      } else {
        setPendingPaymentsCount(0);
      }

      if (membersRes.status === "fulfilled" && Array.isArray(membersRes.value.users)) {
        setHouseholdsCount(
          membersRes.value.users.filter((u: any) => u.role === "resident").length,
        );
      } else {
        setHouseholdsCount(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Purok Leader dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const segregatedCount = useMemo(
    () => collections.filter((row) => row.segregation === "segregated").length,
    [collections],
  );

  const pendingDecisions = useMemo(
    () =>
      collections.filter(
        (row) => row.segregation === "not_segregated" && !row.decision_action,
      ),
    [collections],
  );

  const activeComplaints = useMemo(
    () => complaints.filter((complaint) => !["resolved", "cancelled"].includes(complaint.status)),
    [complaints],
  );

  const latestScans = useMemo(() => collections.slice(0, 6), [collections]);
  const activeComplaintPreview = activeComplaints.slice(0, DASHBOARD_PREVIEW_LIMIT);
  const totalLeaderActions = pendingDecisions.length + pendingPaymentsCount;

  return (
    <div className="sg-page space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            LGU Purok Operations
          </p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            Purok Leader Dashboard
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Managing{" "}
            <span className="font-bold text-slate-700">
              {profile?.purok_name || "Unassigned Purok"}
            </span>
            {profile?.barangay_name ? `, ${profile.barangay_name}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentScreen("members-list")}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-emerald-800"
          >
            <Users className="h-4 w-4" />
            Open Purok Members &amp; Activity Log
            {totalLeaderActions > 0 && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-emerald-800">
                {totalLeaderActions}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {totalLeaderActions > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-100 p-2.5 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">
                Action Needed in Purok Members
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {pendingDecisions.length > 0 && (
                  <span className="font-bold text-rose-700">
                    {pendingDecisions.length} ✗ Not Segregated scan
                    {pendingDecisions.length === 1 ? "" : "s"} waiting for your decision
                  </span>
                )}
                {pendingDecisions.length > 0 && pendingPaymentsCount > 0 ? " · " : ""}
                {pendingPaymentsCount > 0 && (
                  <span className="font-bold text-amber-800">
                    {pendingPaymentsCount} resident payment
                    {pendingPaymentsCount === 1 ? "" : "s"} waiting for verification
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCurrentScreen("members-list")}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-slate-800"
          >
            Review Now
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Purok Households"
          value={householdsCount}
          icon={Users}
          tone="slate"
        />
        <SummaryCard
          label="✓ Segregated Scans"
          value={segregatedCount}
          icon={CheckCircle2}
          tone="emerald"
        />
        <SummaryCard
          label="✗ Needs Decision"
          value={pendingDecisions.length}
          icon={XCircle}
          tone={pendingDecisions.length > 0 ? "rose" : "slate"}
        />
        <SummaryCard
          label="Verify Payments"
          value={pendingPaymentsCount}
          icon={Wallet}
          tone={pendingPaymentsCount > 0 ? "amber" : "slate"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Latest Collector QR Scans (Activity Log)
                </h2>
                <p className="text-xs text-slate-500">
                  Live results from the Collector&apos;s household QR scanner (✓ Segregated / ✗ Not Segregated).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentScreen("members-list")}
                className="self-start rounded-xl bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-emerald-800 sm:self-auto"
              >
                Open Activity Log &amp; History
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              {loading ? (
                <div className="p-8 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
                  <p className="mt-2 text-xs font-bold text-slate-500">
                    Loading QR scan activity...
                  </p>
                </div>
              ) : latestScans.length === 0 ? (
                <div className="p-8 text-center">
                  <QrCode className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-2 font-black text-slate-700">No QR scans recorded yet</p>
                  <p className="mt-1 text-xs text-slate-500">
                    When the Collector scans household QR codes in your purok, results will appear here immediately.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {latestScans.map((scan) => {
                    const isSegregated = scan.segregation === "segregated";
                    const needsDecision = !isSegregated && !scan.decision_action;
                    return (
                      <article
                        key={scan.id}
                        className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${
                          needsDecision ? "bg-rose-50/40" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                                isSegregated
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {isSegregated ? "✓ Segregated" : "✗ Not Segregated"}
                            </span>
                            <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
                              {scan.bin_code}
                            </span>
                            <h3 className="font-black text-slate-900">{scan.household_name}</h3>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Scanned by <span className="font-semibold text-slate-700">{scan.collector_name}</span> ·{" "}
                            {formatDate(scan.collected_at)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 sm:shrink-0">
                          {needsDecision ? (
                            <button
                              type="button"
                              onClick={() => setCurrentScreen("members-list")}
                              className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white shadow-xs transition hover:bg-rose-700"
                            >
                              Decide Action →
                            </button>
                          ) : scan.decision_action ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase text-slate-700">
                              {scan.decision_action === "fine"
                                ? "Fine Issued"
                                : scan.decision_action === "suspension"
                                  ? "Suspended"
                                  : "Warning Issued"}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-emerald-700">Compliant</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Complaints in My Purok</h2>
                <p className="text-xs text-slate-500">
                  Showing the latest {Math.min(activeComplaints.length, DASHBOARD_PREVIEW_LIMIT)} of{" "}
                  {activeComplaints.length} active records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentScreen("complaints")}
                className="self-start rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white sm:self-auto"
              >
                Open Complaints
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              {loading ? (
                <div className="p-8 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
                  <p className="mt-2 text-xs font-bold text-slate-500">Loading complaints...</p>
                </div>
              ) : activeComplaints.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" />
                  <p className="mt-2 font-black text-slate-700">No active complaints</p>
                  <p className="mt-1 text-xs text-slate-500">
                    New resident complaints from your purok will appear here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {activeComplaintPreview.map((complaint) => (
                    <article key={complaint.id} className="p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-black text-slate-900">{complaint.complaint_type}</h3>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(
                                complaint.status,
                              )}`}
                            >
                              {statusLabel(complaint.status)}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
                            {complaint.description}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {complaint.reporter_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {[complaint.purok_name, complaint.barangay_name].filter(Boolean).join(", ")}
                            </span>
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-400 sm:text-right">
                          {formatDate(complaint.created_at)}
                          {complaint.assigned_collector_name && (
                            <p className="mt-1 font-bold text-blue-600">
                              Assigned to {complaint.assigned_collector_name}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-900">Quick Actions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Jump directly to purok management tools
            </p>
            <div className="mt-3 space-y-2">
              <QuickAction
                label="Purok Members & Activity Log"
                subtitle="Verify payments, QR results & history"
                badge={totalLeaderActions}
                icon={Users}
                onClick={() => setCurrentScreen("members-list")}
              />
              <QuickAction
                label="Households & Bin QRs"
                subtitle="Generate or print household QR labels"
                icon={Building2}
                onClick={() => setCurrentScreen("households")}
              />
              <QuickAction
                label="Collection Schedule"
                subtitle="Check scheduled pickup days"
                icon={Calendar}
                onClick={() => setCurrentScreen("schedule")}
              />
              <QuickAction
                label="Resident Endorsements"
                subtitle="Review & release endorsements"
                icon={Award}
                onClick={() => setCurrentScreen("endorsements")}
              />
              <QuickAction
                label="View Complaints"
                subtitle="Monitor resident reports"
                badge={activeComplaints.length}
                icon={MessageSquareWarning}
                onClick={() => setCurrentScreen("complaints")}
              />
              <QuickAction
                label="Communal Garbage Bins"
                subtitle="Manage purok bin stations"
                icon={Trash2}
                onClick={() => setCurrentScreen("garbage-bins")}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: number;
  icon: any;
  tone?: "slate" | "emerald" | "rose" | "amber";
}) {
  const toneStyles = {
    slate: "border-slate-100 bg-white text-slate-900",
    emerald: "border-emerald-100 bg-white text-slate-900",
    rose: "border-rose-200 bg-rose-50/60 text-rose-900",
    amber: "border-amber-200 bg-amber-50/60 text-amber-900",
  }[tone];

  const iconStyles = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
    amber: "bg-amber-100 text-amber-700",
  }[tone];

  return (
    <div
      className={`w-full rounded-2xl border p-4 text-left shadow-sm select-none ${toneStyles}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-1.5 text-2xl font-black">{value}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${iconStyles}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  label,
  subtitle,
  badge,
  icon: Icon,
  onClick,
}: {
  label: string;
  subtitle?: string;
  badge?: number;
  icon: any;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="rounded-xl bg-white p-2 text-emerald-700 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-800">{label}</p>
          {subtitle && <p className="truncate text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {badge && badge > 0 ? (
        <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
          {badge}
        </span>
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      )}
    </button>
  );
}
