import { apiFetch } from "../services/http";
import {
  Check,
  CheckCircle2,
  Clock,
  LocateFixed,
  MapPin,
  MessageSquareWarning,
  Navigation,
  QrCode,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { notifyAdminActionCountsChanged } from "../hooks/useAdminActionCounts";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";
import RecordActions from "./RecordActions";
import QrCollection from "./QrCollection";
import { useEffect, useMemo, useState } from "react";

interface CollectorDashboardProps {
  setCurrentScreen: (screen: any) => void;
}

type ComplaintStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "resolved"
  | "cancelled";

type AssignedComplaint = {
  id: number;
  reporter_name: string;
  purok_name?: string | null;
  barangay_name?: string | null;
  complaint_type: string;
  description: string;
  phone?: string | null;
  status: ComplaintStatus;
  created_at: string;
};

type ScannedCollectionRow = {
  id: number;
  resident_id: number;
  household_name: string;
  bin_code: string;
  purok_name: string;
  segregation: "segregated" | "not_segregated";
  collection_status: "collected" | "not_collected";
  collected_at: string;
  decision_action?: string | null;
};

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function apiRequest(url: string, options: RequestInit = {}) {
  const token = getToken();

  const response = await apiFetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

function statusLabel(value?: string | null): string {
  return String(value || "pending")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function isSameManilaDay(value?: string | null): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(parsed) === fmt.format(new Date());
}

export default function CollectorDashboard({
  setCurrentScreen,
}: CollectorDashboardProps) {
  const [scans, setScans] = useState<ScannedCollectionRow[]>([]);
  const [complaints, setComplaints] = useState<AssignedComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingComplaintId, setUpdatingComplaintId] = useState<number | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [scanPage, setScanPage] = useState(1);
  const [scanPageSize, setScanPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [complaintPage, setComplaintPage] = useState(1);
  const [complaintPageSize, setComplaintPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [tracking, setTracking] = useState(
    () => localStorage.getItem("sg_collector_location_sharing") === "true",
  );
  const [locationStatus, setLocationStatus] = useState(() =>
    localStorage.getItem("sg_collector_location_sharing") === "true"
      ? "Live location sharing is on. Waiting for the next GPS update."
      : "Location sharing is off.",
  );
  const [lastLocationUpdate, setLastLocationUpdate] = useState<string | null>(
    null,
  );

  const startLocationTracking = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("This browser does not support GPS location.");
      return;
    }

    localStorage.setItem("sg_collector_location_sharing", "true");
    setTracking(true);
    setLocationStatus(
      "Live location sharing is on. It stays active while you scan bins in the purok.",
    );
    window.dispatchEvent(new Event("collector-location-sharing-change"));
  };

  const stopLocationTracking = async () => {
    localStorage.removeItem("sg_collector_location_sharing");
    setTracking(false);
    setLocationStatus("Location sharing is off.");
    window.dispatchEvent(new Event("collector-location-sharing-change"));
  };

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const [scansResult, complaintResult] = await Promise.allSettled([
        apiRequest("/api/sgms/collections"),
        apiRequest("/api/complaints"),
      ]);

      if (scansResult.status === "fulfilled") {
        setScans(
          Array.isArray(scansResult.value.collections)
            ? scansResult.value.collections
            : [],
        );
      }

      if (complaintResult.status === "fulfilled") {
        setComplaints(
          Array.isArray(complaintResult.value.complaints)
            ? complaintResult.value.complaints
            : [],
        );
      }

      if (
        scansResult.status === "rejected" &&
        complaintResult.status === "rejected"
      ) {
        setErrorMessage(
          scansResult.reason instanceof Error
            ? scansResult.reason.message
            : "Unable to load collector data.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const onLocationUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{
        accuracy?: number;
        timestamp?: number;
      }>;

      setTracking(true);
      setLastLocationUpdate(
        new Date(customEvent.detail?.timestamp || Date.now()).toISOString(),
      );

      const accuracy = Number(customEvent.detail?.accuracy);
      setLocationStatus(
        Number.isFinite(accuracy)
          ? `Live location is being shared. Accuracy: about ${Math.round(
              accuracy,
            )} meters.`
          : "Live location is being shared.",
      );
    };

    const onLocationRejected = (event: Event) => {
      const customEvent = event as CustomEvent<{
        errorMessage?: string;
        accuracy?: number;
        maximumAccuracy?: number;
      }>;
      if (customEvent.detail?.errorMessage) {
        setLocationStatus(
          `GPS unavailable: ${customEvent.detail.errorMessage}. Check browser location permission.`,
        );
      } else if (Number.isFinite(customEvent.detail?.accuracy)) {
        setLocationStatus(
          `GPS signal is weak (${Math.round(
            Number(customEvent.detail.accuracy),
          )}m). Move outdoors for a clearer fix.`,
        );
      }
    };

    window.addEventListener("collector-location-update", onLocationUpdate);
    window.addEventListener("collector-location-rejected", onLocationRejected);
    return () => {
      window.removeEventListener("collector-location-update", onLocationUpdate);
      window.removeEventListener(
        "collector-location-rejected",
        onLocationRejected,
      );
    };
  }, []);

  const todayScans = useMemo(
    () => scans.filter((scan) => isSameManilaDay(scan.collected_at)),
    [scans],
  );

  const segregatedTodayCount = useMemo(
    () => todayScans.filter((scan) => scan.segregation === "segregated").length,
    [todayScans],
  );

  const notSegregatedTodayCount = useMemo(
    () =>
      todayScans.filter((scan) => scan.segregation === "not_segregated").length,
    [todayScans],
  );

  const activeComplaints = useMemo(
    () =>
      complaints.filter(
        (complaint) => !["resolved", "cancelled"].includes(complaint.status),
      ),
    [complaints],
  );

  const scanPageCount = Math.max(1, Math.ceil(scans.length / scanPageSize));
  const safeScanPage = Math.min(scanPage, scanPageCount);
  const paginatedScans = useMemo(() => {
    const start = (safeScanPage - 1) * scanPageSize;
    return scans.slice(start, start + scanPageSize);
  }, [scans, safeScanPage, scanPageSize]);

  const complaintPageCount = Math.max(
    1,
    Math.ceil(activeComplaints.length / complaintPageSize),
  );
  const safeComplaintPage = Math.min(complaintPage, complaintPageCount);
  const paginatedComplaints = useMemo(() => {
    const start = (safeComplaintPage - 1) * complaintPageSize;
    return activeComplaints.slice(start, start + complaintPageSize);
  }, [activeComplaints, safeComplaintPage, complaintPageSize]);

  const updateComplaintStatus = async (
    complaint: AssignedComplaint,
    status: "in_progress" | "completed",
  ) => {
    setUpdatingComplaintId(complaint.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await apiRequest(`/api/complaints/${complaint.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });

      setSuccessMessage(result.message || "Complaint task updated.");
      await loadData();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update complaint task.",
      );
    } finally {
      setUpdatingComplaintId(null);
    }
  };

  const archiveOwnComplaint = async (complaint: AssignedComplaint) => {
    setUpdatingComplaintId(complaint.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await apiRequest(
        `/api/complaints/${complaint.id}/archive-mine`,
        { method: "POST", body: "{}" },
      );

      setSuccessMessage(
        result.message || "Complaint removed from your list.",
      );
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to remove the complaint from your list.",
      );
    } finally {
      setUpdatingComplaintId(null);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Field Operations
          </p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            Garbage Collector Dashboard
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">
            Head straight to the purok, scan household QR codes, and mark ✓ Segregated or ✗ Not Segregated.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => setCurrentScreen("route-map")}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800"
          >
            <Navigation className="h-4 w-4" />
            Route Map
          </button>
        </div>
      </header>

      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {errorMessage}
        </div>
      )}

      {/* Direct QR Scanner Modal Hero */}
      <QrCollection onSaved={loadData} />

      {/* Summary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Scanned Today
              </p>
              <p className="mt-1.5 text-3xl font-black text-slate-900">
                {todayScans.length}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <QrCode className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                ✓ Segregated Today
              </p>
              <p className="mt-1.5 text-3xl font-black text-emerald-700">
                {segregatedTodayCount}
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <Check className="h-6 w-6 stroke-[3]" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                ✗ Not Segregated Today
              </p>
              <p className="mt-1.5 text-3xl font-black text-rose-700">
                {notSegregatedTodayCount}
              </p>
            </div>
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-700">
              <X className="h-6 w-6 stroke-[3]" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                Assigned Complaints
              </p>
              <p className="mt-1.5 text-3xl font-black text-amber-700">
                {activeComplaints.length}
              </p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
              <MessageSquareWarning className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Live GPS Sharing */}
      <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`rounded-2xl p-3 ${
                tracking
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              <LocateFixed
                className={`h-6 w-6 ${tracking ? "animate-pulse" : ""}`}
              />
            </div>

            <div>
              <h2 className="font-black text-slate-900">
                Collector Live Location
              </h2>
              <p className="mt-1 text-sm text-slate-600">{locationStatus}</p>
              <p className="mt-1 text-xs text-slate-400">
                Only the Barangay Captain and Purok Leader can view this location.
              </p>
              {lastLocationUpdate && (
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  Last sent: {formatDate(lastLocationUpdate)}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              tracking ? void stopLocationTracking() : startLocationTracking()
            }
            className={`rounded-xl px-5 py-3 text-sm font-black text-white transition ${
              tracking
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-emerald-700 hover:bg-emerald-800"
            }`}
          >
            {tracking ? "Stop Sharing Location" : "Start Sharing Location"}
          </button>
        </div>
      </section>

      {/* Recent QR Scan Results */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <QrCode className="h-5 w-5 text-emerald-700" />
              Recent Household QR Scans
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Every scan is immediately visible to the Purok Leader in Purok Members &amp; Activity Log.
            </p>
          </div>
          <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
            {scans.length} total scans
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {paginatedScans.map((scan) => (
            <article
              key={scan.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    scan.segregation === "segregated"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {scan.segregation === "segregated" ? (
                    <Check className="h-5 w-5 stroke-[3]" />
                  ) : (
                    <X className="h-5 w-5 stroke-[3]" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-slate-900">
                      {scan.household_name}
                    </h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                      QR {scan.bin_code}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                        scan.segregation === "segregated"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {scan.segregation === "segregated"
                        ? "✓ Segregated"
                        : "✗ Not Segregated"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {scan.purok_name} · {formatDate(scan.collected_at)}
                  </p>
                </div>
              </div>

              <div className="text-xs font-bold sm:text-right">
                {scan.segregation === "not_segregated" ? (
                  scan.decision_action ? (
                    <span className="inline-flex rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase text-slate-700">
                      Leader: {scan.decision_action}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-800">
                      Sent to Purok Leader
                    </span>
                  )
                ) : (
                  <span className="inline-flex rounded-xl bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700">
                    Policy Followed
                  </span>
                )}
              </div>
            </article>
          ))}

          {!loading && scans.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <QrCode className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="font-black text-slate-700">No QR scans recorded yet</p>
              <p className="mt-1 text-xs">
                Click &ldquo;Open QR Scanner&rdquo; above when you arrive at a purok.
              </p>
            </div>
          )}

          {loading && (
            <div className="p-10 text-center text-slate-500">
              <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading scan history...
            </div>
          )}
        </div>

        {!loading && scans.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination
              page={safeScanPage}
              pageSize={scanPageSize}
              totalItems={scans.length}
              onPageChange={setScanPage}
              onPageSizeChange={(nextPageSize) => {
                setScanPageSize(nextPageSize);
                setScanPage(1);
              }}
              compact
              itemLabel="scans"
            />
          </div>
        )}
      </section>

      {/* Assigned Resident Complaints */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <MessageSquareWarning className="h-5 w-5 text-amber-400" />
              Assigned Resident Complaints
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              Only complaints assigned to your collector account appear here.
            </p>
          </div>

          <span className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-black">
            {activeComplaints.length} active
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {paginatedComplaints.map((complaint) => {
            const busy = updatingComplaintId === complaint.id;

            return (
              <article
                key={complaint.id}
                className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                    <MessageSquareWarning className="h-6 w-6" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-slate-900">
                        CMP-{complaint.id} — {complaint.complaint_type}
                      </h3>
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase text-blue-700">
                        {statusLabel(complaint.status)}
                      </span>
                    </div>

                    <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                      <MapPin className="h-4 w-4" />
                      {[complaint.purok_name, complaint.barangay_name]
                        .filter(Boolean)
                        .join(", ") || "No area"}
                    </p>

                    <p className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                      <User className="h-3.5 w-3.5" />
                      Reporter: {complaint.reporter_name}
                    </p>

                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(complaint.created_at)}
                    </p>

                    <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                      {complaint.description}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {complaint.status === "assigned" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void updateComplaintStatus(complaint, "in_progress")
                      }
                      className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                    >
                      Start Task
                    </button>
                  )}

                  {complaint.status === "in_progress" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void updateComplaintStatus(complaint, "completed")
                      }
                      className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark Completed
                    </button>
                  )}

                  {complaint.status === "completed" && (
                    <span className="rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black uppercase text-emerald-700">
                      Awaiting Captain Verification
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setCurrentScreen("complaints")}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700"
                  >
                    Open Details
                  </button>

                  {complaint.status === "completed" && (
                    <RecordActions
                      label={`complaint ${complaint.id}`}
                      disabled={busy}
                      onArchive={() => void archiveOwnComplaint(complaint)}
                    />
                  )}
                </div>
              </article>
            );
          })}

          {!loading && activeComplaints.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              <p className="font-black text-slate-700">No assigned complaints</p>
              <p className="mt-1 text-xs">
                Barangay Captain assignments will appear here automatically.
              </p>
            </div>
          )}

          {loading && (
            <div className="p-10 text-center text-slate-500">
              <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading assigned complaints...
            </div>
          )}
        </div>

        {!loading && activeComplaints.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination
              page={safeComplaintPage}
              pageSize={complaintPageSize}
              totalItems={activeComplaints.length}
              onPageChange={setComplaintPage}
              onPageSizeChange={(nextPageSize) => {
                setComplaintPageSize(nextPageSize);
                setComplaintPage(1);
              }}
              compact
              itemLabel="assigned complaints"
            />
          </div>
        )}
      </section>
    </div>
  );
}
