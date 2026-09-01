import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  markAdminActionNotificationsRead,
  notifyAdminActionCountsChanged,
} from "../hooks/useAdminActionCounts";

type AppRole =
  | "household"
  | "collector"
  | "leader"
  | "admin"
  | "super_admin";

type ComplaintStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "resolved"
  | "cancelled";

interface ComplaintMessage {
  id: number;
  complaint_id: number;
  sender_id: number;
  sender_name: string;
  sender_role: string;
  message: string;
  created_at: string;
}

interface Complaint {
  id: number;
  reported_by: number;
  reporter_name: string;
  reporter_email: string;
  purok_id: number;
  purok_name: string | null;
  barangay_id: number | null;
  barangay_name: string | null;
  complaint_type: string;
  description: string;
  phone: string | null;
  photo_url: string | null;
  status: ComplaintStatus;
  assigned_collector_id: number | null;
  assigned_collector_name: string | null;
  resolution_remark: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  messages: ComplaintMessage[];
}

interface Collector {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  barangay_id: number | null;
  barangay_name: string | null;
  status: string;
}

interface CurrentUser {
  id: number;
  purok_id: number | null;
  purok_name: string | null;
  barangay_name: string | null;
  full_name: string;
  email: string;
  role: string;
  phone: string | null;
}

interface ComplaintsPanelProps {
  role: AppRole;
}

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}

async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
) {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Login session is missing. Please log in again.",
    );
  }

  const response = await fetch(
    `${API_BASE}${endpoint}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || "Request failed.",
    );
  }

  return data;
}

function statusLabel(
  status: ComplaintStatus,
) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function formatDate(
  value?: string | null,
) {
  if (!value) return "No date";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function statusClass(
  status: ComplaintStatus,
) {
  switch (status) {
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "assigned":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "in_progress":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "completed":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function ComplaintsPanel({
  role,
}: ComplaintsPanelProps) {
  const [complaints, setComplaints] =
    useState<Complaint[]>([]);
  const [collectors, setCollectors] =
    useState<Collector[]>([]);
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);

  const [selectedId, setSelectedId] =
    useState<number | null>(null);

  const [activeTab, setActiveTab] =
    useState<
      "all" | "active" | "resolved"
    >("all");

  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");
  const [success, setSuccess] =
    useState("");

  const [showSubmitModal, setShowSubmitModal] =
    useState(false);

  const [newType, setNewType] =
    useState(
      "Overflowing Communal Barrel",
    );
  const [newDescription, setNewDescription] =
    useState("");
  const [newPhone, setNewPhone] =
    useState("");
  const [newPhotoUrl, setNewPhotoUrl] =
    useState("");

  const [selectedCollectorId, setSelectedCollectorId] =
    useState("");
  const [resolutionRemark, setResolutionRemark] =
    useState("");
  const [chatInput, setChatInput] =
    useState("");
  const latestLoad = useRef(0);

  const loadData = async (silent = false) => {
    const loadId = ++latestLoad.current;

    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const [complaintData, profileData] =
        await Promise.all([
          apiRequest("/complaints"),
          apiRequest("/auth/me"),
        ]);

      if (loadId !== latestLoad.current) {
        return;
      }

      setError("");

      setComplaints(
        Array.isArray(
          complaintData.complaints,
        )
          ? complaintData.complaints
          : [],
      );

      setCurrentUser(
        profileData.user || null,
      );

      if (role === "admin") {
        const collectorData =
          await apiRequest(
            "/admin/collectors",
          );

        if (loadId !== latestLoad.current) {
          return;
        }

        setCollectors(
          Array.isArray(
            collectorData.collectors,
          )
            ? collectorData.collectors
            : [],
        );
      } else {
        setCollectors([]);
      }
    } catch (err) {
      if (loadId === latestLoad.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load complaints.",
        );
      }
    } finally {
      if (loadId === latestLoad.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void markAdminActionNotificationsRead("complaints");

    void loadData();

    if (role !== "admin" && role !== "super_admin") {
      return;
    }

    const refreshComplaints = () => {
      void loadData(true);
    };

    const timer = window.setInterval(
      refreshComplaints,
      10000,
    );

    window.addEventListener("focus", refreshComplaints);

    return () => {
      latestLoad.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshComplaints);
    };
  }, [role]);

  const selectedComplaint =
    complaints.find(
      (item) => item.id === selectedId,
    ) || null;

  useEffect(() => {
    if (
      selectedComplaint
        ?.assigned_collector_id
    ) {
      setSelectedCollectorId(
        String(
          selectedComplaint
            .assigned_collector_id,
        ),
      );
    } else {
      setSelectedCollectorId("");
    }

    setResolutionRemark(
      selectedComplaint
        ?.resolution_remark || "",
    );
  }, [
    selectedComplaint?.id,
    selectedComplaint
      ?.assigned_collector_id,
  ]);

  const filteredComplaints =
    useMemo(() => {
      return complaints.filter(
        (item) => {
          if (activeTab === "active") {
            return ![
              "resolved",
              "cancelled",
            ].includes(item.status);
          }

          if (
            activeTab === "resolved"
          ) {
            return (
              item.status ===
              "resolved"
            );
          }

          return true;
        },
      );
    }, [complaints, activeTab]);

  const stats = useMemo(() => {
    return {
      pending: complaints.filter(
        (item) =>
          item.status === "pending",
      ).length,
      active: complaints.filter(
        (item) =>
          [
            "assigned",
            "in_progress",
            "completed",
          ].includes(item.status),
      ).length,
      resolved: complaints.filter(
        (item) =>
          item.status === "resolved",
      ).length,
    };
  }, [complaints]);

  const createComplaint = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    if (
      !newDescription.trim() ||
      !newPhone.trim()
    ) {
      setError(
        "Description and phone number are required.",
      );
      return;
    }

    if (!currentUser?.purok_id) {
      setError(
        "Your account has no assigned purok.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const data = await apiRequest(
        "/complaints",
        {
          method: "POST",
          body: JSON.stringify({
            complaint_type:
              newType,
            description:
              newDescription.trim(),
            phone:
              newPhone.trim(),
            photo_url:
              newPhotoUrl.trim() ||
              null,
            purok_id:
              currentUser.purok_id,
          }),
        },
      );

      setSuccess(
        data.message ||
          "Complaint submitted.",
      );

      setShowSubmitModal(false);
      setNewDescription("");
      setNewPhotoUrl("");
      setNewPhone(
        currentUser.phone || "",
      );

      await loadData();
      notifyAdminActionCountsChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to submit complaint.",
      );
    } finally {
      setSaving(false);
    }
  };

  const assignCollector = async () => {
    if (
      !selectedComplaint ||
      !selectedCollectorId
    ) {
      setError(
        "Select a Garbage Collector first.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const data = await apiRequest(
        `/complaints/${selectedComplaint.id}/assign`,
        {
          method: "PUT",
          body: JSON.stringify({
            collectorId: Number(
              selectedCollectorId,
            ),
          }),
        },
      );

      setSuccess(
        data.message ||
          "Complaint assigned.",
      );

      await loadData();
      notifyAdminActionCountsChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to assign complaint.",
      );
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (
    status:
      | "in_progress"
      | "completed",
  ) => {
    if (!selectedComplaint) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const data = await apiRequest(
        `/complaints/${selectedComplaint.id}/status`,
        {
          method: "PUT",
          body: JSON.stringify({
            status,
          }),
        },
      );

      setSuccess(
        data.message ||
          "Complaint updated.",
      );

      await loadData();
      notifyAdminActionCountsChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update complaint.",
      );
    } finally {
      setSaving(false);
    }
  };

  const resolveComplaint =
    async () => {
      if (!selectedComplaint) return;

      if (
        !resolutionRemark.trim()
      ) {
        setError(
          "Enter an official resolution remark.",
        );
        return;
      }

      setSaving(true);
      setError("");
      setSuccess("");

      try {
        const data = await apiRequest(
          `/complaints/${selectedComplaint.id}/resolve`,
          {
            method: "PUT",
            body: JSON.stringify({
              remarks:
                resolutionRemark.trim(),
            }),
          },
        );

        setSuccess(
          data.message ||
            "Complaint resolved.",
        );

        await loadData();
        notifyAdminActionCountsChanged();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to resolve complaint.",
        );
      } finally {
        setSaving(false);
      }
    };

  const sendMessage = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    if (
      !selectedComplaint ||
      !chatInput.trim()
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await apiRequest(
        `/complaints/${selectedComplaint.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message:
              chatInput.trim(),
          }),
        },
      );

      setChatInput("");
      await loadData();
      notifyAdminActionCountsChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to send message.",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelComplaint =
    async () => {
      if (!selectedComplaint) return;

      const confirmed =
        window.confirm(
          "Cancel this complaint?",
        );

      if (!confirmed) return;

      setSaving(true);
      setError("");
      setSuccess("");

      try {
        const data = await apiRequest(
          `/complaints/${selectedComplaint.id}`,
          {
            method: "DELETE",
          },
        );

        setSuccess(
          data.message ||
            "Complaint cancelled.",
        );

        setSelectedId(null);
        await loadData();
        notifyAdminActionCountsChanged();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to cancel complaint.",
        );
      } finally {
        setSaving(false);
      }
    };

  const canSubmit =
    role === "household";

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            LGU Sanitation Feedback
          </div>

          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            Complaints & Logs
          </h1>

          <p className="mt-1 text-xs text-slate-500">
            Real complaints, collector assignments, and status history from MySQL.
          </p>
        </div>

        {canSubmit && (
          <button
            type="button"
            onClick={() => {
              setShowSubmitModal(
                true,
              );
              setNewPhone(
                currentUser?.phone ||
                  "",
              );
            }}
            className="flex items-center justify-center gap-2 rounded-2xl border-none bg-amber-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md"
          >
            <Plus className="h-4 w-4" />
            Report Garbage Issue
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="Pending Review"
          value={stats.pending}
          tone="amber"
        />
        <MetricCard
          label="Under Action"
          value={stats.active}
          tone="indigo"
        />
        <MetricCard
          label="Resolved"
          value={stats.resolved}
          tone="emerald"
        />
      </div>

      <div className="flex gap-5 border-b border-slate-100">
        {[
          {
            id: "all",
            label: "All",
          },
          {
            id: "active",
            label: "Active",
          },
          {
            id: "resolved",
            label: "Resolved",
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              setActiveTab(
                tab.id as typeof activeTab,
              )
            }
            className={`border-b-4 px-1 pb-3 text-xs font-black uppercase tracking-widest ${
              activeTab === tab.id
                ? "border-amber-600 text-slate-900"
                : "border-transparent text-slate-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-5">
          {loading ? (
            <div className="rounded-[2rem] border border-slate-100 bg-white p-12 text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-amber-600" />
              <p className="mt-3 text-sm font-bold text-slate-500">
                Loading complaints...
              </p>
            </div>
          ) : filteredComplaints.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-xs font-bold text-slate-700">
                No complaints found.
              </p>
            </div>
          ) : (
            filteredComplaints.map(
              (item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setSelectedId(
                      item.id,
                    )
                  }
                  className={`w-full rounded-[1.6rem] border bg-white p-4 text-left transition ${
                    selectedId ===
                    item.id
                      ? "border-amber-500 ring-1 ring-amber-500/20"
                      : "border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-black text-slate-900">
                      {
                        item.complaint_type
                      }
                    </p>

                    <StatusBadge
                      status={item.status}
                    />
                  </div>

                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                    {item.description}
                  </p>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3 text-[10px]">
                    <span className="flex items-center gap-1 font-bold text-slate-500">
                      <User className="h-3.5 w-3.5" />
                      {
                        item.reporter_name
                      }
                    </span>

                    <span className="text-slate-400">
                      {formatDate(
                        item.created_at,
                      )}
                    </span>
                  </div>
                </button>
              ),
            )
          )}
        </div>

        <div className="lg:col-span-7">
          {!selectedComplaint ? (
            <div className="flex min-h-[430px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
              <MessageSquare className="h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-700">
                Select a complaint
              </p>
              <p className="mt-1 max-w-xs text-[11px] text-slate-500">
                Review complaint details, assignment, messages, and status.
              </p>
            </div>
          ) : (
            <div className="space-y-6 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm md:p-8">
              <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-1 font-mono text-xs font-black text-slate-600">
                    CMP-
                    {
                      selectedComplaint.id
                    }
                  </span>

                  <StatusBadge
                    status={
                      selectedComplaint.status
                    }
                  />
                </div>

                {(role === "admin" ||
                  role ===
                    "household") &&
                  ![
                    "resolved",
                    "cancelled",
                  ].includes(
                    selectedComplaint.status,
                  ) && (
                    <button
                      type="button"
                      onClick={
                        cancelComplaint
                      }
                      disabled={saving}
                      className="rounded-xl p-2 text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
              </div>

              <section className="space-y-3">
                <h2 className="text-xl font-black text-slate-900">
                  {
                    selectedComplaint.complaint_type
                  }
                </h2>

                <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {[
                      selectedComplaint.purok_name,
                      selectedComplaint.barangay_name,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>

                  <span className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4" />
                    {selectedComplaint.phone ||
                      "No phone"}
                  </span>

                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {formatDate(
                      selectedComplaint.created_at,
                    )}
                  </span>
                </div>

                <p className="whitespace-pre-line rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs font-medium leading-relaxed text-slate-700">
                  {
                    selectedComplaint.description
                  }
                </p>

                {selectedComplaint.photo_url && (
                  <img
                    src={
                      selectedComplaint.photo_url
                    }
                    alt="Complaint evidence"
                    className="max-h-64 w-full rounded-2xl border border-slate-100 object-cover"
                  />
                )}
              </section>

              {role === "admin" && (
                <section className="space-y-4 rounded-[1.8rem] border border-slate-800 bg-slate-900 p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                    Barangay Captain Console
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-[9px] font-black uppercase text-slate-400">
                      Garbage Collector
                      <div className="relative mt-2">
                        <select
                          value={
                            selectedCollectorId
                          }
                          onChange={(
                            event,
                          ) =>
                            setSelectedCollectorId(
                              event
                                .target
                                .value,
                            )
                          }
                          className="w-full appearance-none rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 pr-10 text-xs font-bold text-white"
                        >
                          <option value="">
                            Select collector
                          </option>

                          {collectors.map(
                            (
                              collector,
                            ) => (
                              <option
                                key={
                                  collector.id
                                }
                                value={
                                  collector.id
                                }
                              >
                                {
                                  collector.full_name
                                }
                                {collector.barangay_name
                                  ? ` — ${collector.barangay_name}`
                                  : ""}
                              </option>
                            ),
                          )}
                        </select>

                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-500" />
                      </div>
                    </label>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={
                          assignCollector
                        }
                        disabled={
                          saving ||
                          !selectedCollectorId
                        }
                        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        Assign Collector
                      </button>
                    </div>
                  </div>

                  <label className="block text-[9px] font-black uppercase text-slate-400">
                    Official Resolution Note
                    <input
                      type="text"
                      value={
                        resolutionRemark
                      }
                      onChange={(
                        event,
                      ) =>
                        setResolutionRemark(
                          event.target
                            .value,
                        )
                      }
                      placeholder="Describe the final verified action."
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={
                      resolveComplaint
                    }
                    disabled={
                      saving ||
                      selectedComplaint.status ===
                        "resolved"
                    }
                    className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
                  >
                    Mark Resolved
                  </button>
                </section>
              )}

              {role ===
                "collector" && (
                <section className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                    Collector Task Actions
                  </p>

                  {selectedComplaint.status ===
                    "assigned" && (
                    <button
                      type="button"
                      onClick={() =>
                        updateStatus(
                          "in_progress",
                        )
                      }
                      disabled={saving}
                      className="w-full rounded-xl bg-amber-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
                    >
                      Start Task
                    </button>
                  )}

                  {selectedComplaint.status ===
                    "in_progress" && (
                    <button
                      type="button"
                      onClick={() =>
                        updateStatus(
                          "completed",
                        )
                      }
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark Completed
                    </button>
                  )}

                  {selectedComplaint.status ===
                    "completed" && (
                    <div className="rounded-xl bg-emerald-100 px-4 py-3 text-center text-xs font-black text-emerald-700">
                      Waiting for Barangay Captain verification
                    </div>
                  )}
                </section>
              )}

              {selectedComplaint.assigned_collector_name && (
                <section className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs">
                  <p className="font-black uppercase tracking-wide text-amber-700">
                    Assigned Garbage Collector
                  </p>
                  <p className="mt-1 font-bold text-slate-700">
                    {
                      selectedComplaint.assigned_collector_name
                    }
                  </p>
                </section>
              )}

              {selectedComplaint.resolution_remark && (
                <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs">
                  <p className="font-black uppercase tracking-wide text-emerald-700">
                    Resolution
                  </p>
                  <p className="mt-1 whitespace-pre-line font-medium text-slate-700">
                    {
                      selectedComplaint.resolution_remark
                    }
                  </p>
                </section>
              )}

              <section className="space-y-3">
                <p className="border-b border-slate-100 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Action Trail & Messages (
                  {
                    selectedComplaint.messages
                      .length
                  }
                  )
                </p>

                <div className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
                  {selectedComplaint.messages.map(
                    (message) => (
                      <div
                        key={
                          message.id
                        }
                        className="rounded-2xl bg-slate-100 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black text-slate-700">
                            {
                              message.sender_name
                            }
                          </p>
                          <p className="text-[9px] text-slate-400">
                            {formatDate(
                              message.created_at,
                            )}
                          </p>
                        </div>

                        <p className="mt-1 text-slate-700">
                          {
                            message.message
                          }
                        </p>
                      </div>
                    ),
                  )}

                  {selectedComplaint.messages.length ===
                    0 && (
                    <p className="text-xs text-slate-400">
                      No messages yet.
                    </p>
                  )}
                </div>

                <form
                  onSubmit={
                    sendMessage
                  }
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={
                      chatInput
                    }
                    onChange={(
                      event,
                    ) =>
                      setChatInput(
                        event.target
                          .value,
                      )
                    }
                    placeholder="Type message..."
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800"
                  />

                  <button
                    type="submit"
                    disabled={
                      saving ||
                      !chatInput.trim()
                    }
                    className="rounded-xl bg-slate-900 p-3 text-white disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </section>
            </div>
          )}
        </div>
      </div>

      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] border border-slate-100 bg-white p-6 shadow-2xl md:p-8">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  Report Garbage Issue
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Your registered barangay and purok will be used automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowSubmitModal(
                    false,
                  )
                }
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={
                createComplaint
              }
              className="space-y-4"
            >
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                Issue Category
                <select
                  value={newType}
                  onChange={(
                    event,
                  ) =>
                    setNewType(
                      event.target
                        .value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-extrabold text-slate-800"
                >
                  <option value="Overflowing Communal Barrel">
                    Overflowing Communal Barrel
                  </option>
                  <option value="Missed Trash Pickup">
                    Missed Trash Pickup
                  </option>
                  <option value="Illegal Littering Alert">
                    Illegal Littering
                  </option>
                  <option value="Damaged Garbage Bin">
                    Damaged Garbage Bin
                  </option>
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Assigned Area
                  <input
                    type="text"
                    value={[
                      currentUser?.purok_name,
                      currentUser?.barangay_name,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    disabled
                    className="mt-2 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 p-3 text-xs font-bold text-slate-500"
                  />
                </label>

                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Contact Phone
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(
                      event,
                    ) =>
                      setNewPhone(
                        event.target
                          .value,
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800"
                  />
                </label>
              </div>

              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                Description
                <textarea
                  rows={4}
                  value={
                    newDescription
                  }
                  onChange={(
                    event,
                  ) =>
                    setNewDescription(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Describe the exact location and issue."
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800"
                />
              </label>

              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                Photo URL or Path (optional)
                <input
                  type="text"
                  value={
                    newPhotoUrl
                  }
                  onChange={(
                    event,
                  ) =>
                    setNewPhotoUrl(
                      event.target
                        .value,
                    )
                  }
                  placeholder="/uploads/evidence.jpg"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800"
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-none bg-amber-600 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Complaint
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone:
    | "amber"
    | "indigo"
    | "emerald";
}) {
  const valueClass = {
    amber: "text-amber-600",
    indigo: "text-indigo-600",
    emerald: "text-emerald-600",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-black ${valueClass}`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: ComplaintStatus;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(
        status,
      )}`}
    >
      {statusLabel(status)}
    </span>
  );
}
