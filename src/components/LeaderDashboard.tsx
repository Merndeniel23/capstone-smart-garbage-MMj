import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  MessageSquareWarning,
  RefreshCw,
  Trash2,
  Users,
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

interface Inspection {
  id: number;
  status: string;
  inspected_at: string;
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

  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [profileData, complaintData, inspectionData] = await Promise.all([
        apiRequest("/auth/me"),
        apiRequest("/complaints"),
        apiRequest("/inspections"),
      ]);

      setProfile(profileData.user || null);
      setComplaints(Array.isArray(complaintData.complaints) ? complaintData.complaints : []);
      setInspections(
        Array.isArray(inspectionData.inspections)
          ? inspectionData.inspections
          : Array.isArray(inspectionData)
            ? inspectionData
            : [],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Purok Leader dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeComplaints = useMemo(
    () => complaints.filter((complaint) => !["resolved", "cancelled"].includes(complaint.status)),
    [complaints],
  );

  const resolvedComplaints = useMemo(
    () => complaints.filter((complaint) => complaint.status === "resolved"),
    [complaints],
  );

  const urgentInspections = useMemo(
    () => inspections.filter((inspection) => ["full", "overflowing", "damaged"].includes(String(inspection.status || "").toLowerCase())),
    [inspections],
  );
  const activeComplaintPreview = activeComplaints.slice(0, DASHBOARD_PREVIEW_LIMIT);

  return (
    <div className="sg-page space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">LGU Purok Operations</p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Purok Leader Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Managing <span className="font-bold text-slate-700">{profile?.purok_name || "Unassigned Purok"}</span>
            {profile?.barangay_name ? `, ${profile.barangay_name}` : ""}
          </p>
        </div>

        <button type="button" onClick={loadData} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active Complaints" value={activeComplaints.length} icon={MessageSquareWarning} />
        <SummaryCard label="Resolved Complaints" value={resolvedComplaints.length} icon={CheckCircle2} />
        <SummaryCard label="Total Inspections" value={inspections.length} icon={ClipboardList} />
        <SummaryCard label="Urgent Bin Conditions" value={urgentInspections.length} icon={AlertCircle} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">Complaints in My Purok</h2>
              <p className="text-xs text-slate-500">Showing the latest {Math.min(activeComplaints.length, DASHBOARD_PREVIEW_LIMIT)} of {activeComplaints.length} active records.</p>
            </div>
            <button type="button" onClick={() => setCurrentScreen("complaints")} className="self-start rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white sm:self-auto">
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
                <p className="mt-1 text-xs text-slate-500">New resident complaints from your purok will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeComplaintPreview.map((complaint) => (
                  <article key={complaint.id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-slate-900">{complaint.complaint_type}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(complaint.status)}`}>
                            {statusLabel(complaint.status)}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">{complaint.description}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{complaint.reporter_name}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[complaint.purok_name, complaint.barangay_name].filter(Boolean).join(", ")}</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400 sm:text-right">
                        {formatDate(complaint.created_at)}
                        {complaint.assigned_collector_name && <p className="mt-1 font-bold text-blue-600">Assigned to {complaint.assigned_collector_name}</p>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-900">Quick Actions</h2>
            <div className="mt-3 space-y-2">
              <QuickAction label="Manage Garbage Bins" icon={Trash2} onClick={() => setCurrentScreen("garbage-bins")} />
              <QuickAction label="Record Bin Inspection" icon={ClipboardList} onClick={() => setCurrentScreen("bin-inspections")} />
              <QuickAction label="View Complaints" icon={MessageSquareWarning} onClick={() => setCurrentScreen("complaints")} />
              <QuickAction label="Open Route Map" icon={MapPin} onClick={() => setCurrentScreen("route-map")} />
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Logged-in Purok Leader</p>
            <h3 className="mt-2 text-xl font-black">{profile?.full_name || "Purok Leader"}</h3>
            <p className="mt-1 text-sm text-slate-300">{profile?.purok_name || "No purok"} · {profile?.barangay_name || "No barangay"}</p>
            <p className="mt-4 text-xs leading-relaxed text-slate-400">Complaints, inspections, and bin records shown here are now loaded from the real backend rather than AppState dummy data.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-1.5 text-2xl font-black text-slate-900">{value}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Icon className="h-5 w-5" /></div>
      </div>
    </div>
  );
}

function QuickAction({ label, icon: Icon, onClick }: { label: string; icon: any; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-left transition hover:bg-slate-100">
      <div className="rounded-xl bg-white p-2 text-emerald-700 shadow-sm"><Icon className="h-5 w-5" /></div>
      <span className="text-sm font-black text-slate-800">{label}</span>
    </button>
  );
}
