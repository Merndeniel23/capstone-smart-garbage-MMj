
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  UserCog,
  X,
} from "lucide-react";

interface ManagedUser {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role:
  | "super_admin"
  | "admin"
  | "resident"
  | "collector"
  | "purok_leader";
  status: "active" | "inactive" | "pending" | string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
  created_at: string;
}

interface Barangay {
  id: number;
  name: string;
}

interface Purok {
  id: number;
  barangay_id: number;
  name: string;
  barangay_name: string;
}

type ManagedRole = "resident" | "collector" | "purok_leader";

const API_BASE = "http://localhost:3001/api";

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (value) => alphabet[value % alphabet.length],
  ).join("");
}

function getToken() {
  return localStorage.getItem("token") || "";
}

async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
) {
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
function sanitizePhoneInput(value: string) {
  const startsWithPlus = value.trimStart().startsWith("+");
  const digits = value.replace(/\D/g, "").slice(0, 15);

  return startsWithPlus && digits
    ? `+${digits}`
    : digits;
}

function isValidPhone(value: string) {
  return /^\+?\d{7,15}$/.test(value);
}

function roleLabel(role: ManagedUser["role"]) {
  switch (role) {
    case "super_admin":
      return "Municipal Administrator";

    case "admin":
      return "Barangay Captain";

    case "purok_leader":
      return "Purok Leader";

    case "collector":
      return "Garbage Collector";

    default:
      return "Resident";
  }
}

export default function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [puroks, setPuroks] = useState<Purok[]>([]);

  const [activeTab, setActiveTab] = useState<
    "all" | "pending" | "residents" | "collectors" | "leaders"
  >("all");

  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<ManagedRole>("resident");
  const [selectedBarangayId, setSelectedBarangayId] = useState("");
  const [selectedPurokId, setSelectedPurokId] = useState("");

  const currentRole = localStorage.getItem("sg_user_role");
  const isSuperAdmin = currentRole === "super_admin";

  const [showCaptainModal, setShowCaptainModal] = useState(false);
  const [captainFullName, setCaptainFullName] = useState("");
  const [captainEmail, setCaptainEmail] = useState("");
  const [captainRecoveryEmail, setCaptainRecoveryEmail] = useState("");
  const [captainPhone, setCaptainPhone] = useState("");
  const [captainBarangayId, setCaptainBarangayId] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState(
    generateTemporaryPassword,
  );
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);

  const refreshUsers = async (silent = true) => {
    if (silent) {
      setRefreshing(true);
    }

    try {
      const usersData = await apiRequest("/admin/users");

      setUsers(
        Array.isArray(usersData.users)
          ? usersData.users
          : [],
      );

      setLastUpdated(new Date());
    } catch (err) {
      if (!silent) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to refresh users.",
        );
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      }
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [usersData, locationsData] = await Promise.all([
        apiRequest("/admin/users"),
        apiRequest("/admin/locations"),
      ]);

      setUsers(Array.isArray(usersData.users) ? usersData.users : []);
      setBarangays(
        Array.isArray(locationsData.barangays)
          ? locationsData.barangays
          : [],
      );
      setPuroks(
        Array.isArray(locationsData.puroks)
          ? locationsData.puroks
          : [],
      );
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();

    const timer = window.setInterval(
      () => void refreshUsers(true),
      5000,
    );

    const refreshOnFocus = () => {
      void refreshUsers(true);
    };

    window.addEventListener("focus", refreshOnFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !keyword ||
        user.full_name.toLowerCase().includes(keyword) ||
        user.email.toLowerCase().includes(keyword) ||
        String(user.id).includes(keyword);

      const matchesTab =
        activeTab === "all" ||
        (activeTab === "pending" && user.status === "pending") ||
        (activeTab === "residents" && user.role === "resident") ||
        (activeTab === "collectors" && user.role === "collector") ||
        (activeTab === "leaders" && user.role === "purok_leader");

      return matchesSearch && matchesTab;
    }).sort((a, b) => {
      const pendingDifference =
        Number(b.status === "pending") -
        Number(a.status === "pending");

      if (pendingDifference !== 0) {
        return pendingDifference;
      }

      return (
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
      );
    });
  }, [users, searchTerm, activeTab]);

  const pendingCount = useMemo(
    () =>
      users.filter(
        (user) => user.status === "pending",
      ).length,
    [users],
  );

  const visiblePuroks = useMemo(() => {
    const barangayId = Number(selectedBarangayId);

    if (!barangayId) return puroks;

    return puroks.filter((purok) => purok.barangay_id === barangayId);
  }, [puroks, selectedBarangayId]);

  const openRoleModal = (user: ManagedUser) => {
    if (user.role === "admin" || user.role === "super_admin") return;

    const editableRole: ManagedRole =
      user.role === "collector"
        ? "collector"
        : user.role === "purok_leader"
          ? "purok_leader"
          : "resident";

    setSelectedUser(user);
    setSelectedRole(editableRole);
    setSelectedBarangayId(
      user.barangay_id ? String(user.barangay_id) : "",
    );
    setSelectedPurokId(user.purok_id ? String(user.purok_id) : "");
    setError("");
    setSuccessMessage("");
  };

  const closeRoleModal = () => {
    setSelectedUser(null);
    setSelectedBarangayId("");
    setSelectedPurokId("");
  };

  const handleRoleChange = (role: ManagedRole) => {
    setSelectedRole(role);

    if (role === "collector") {
      setSelectedPurokId("");
    }
  };

  const saveRole = async () => {
    if (!selectedUser) return;

    if (!selectedBarangayId) {
      setError("Please select a barangay.");
      return;
    }

    if (
      (selectedRole === "resident" || selectedRole === "purok_leader") &&
      !selectedPurokId
    ) {
      setError("Please select a purok.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const data = await apiRequest(`/admin/users/${selectedUser.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({
          role: selectedRole,
          barangayId: Number(selectedBarangayId),
          purokId: selectedPurokId ? Number(selectedPurokId) : null,
        }),
      });

      setSuccessMessage(data.message || "Role updated successfully.");
      await loadData();

      window.setTimeout(() => {
        closeRoleModal();
        setSuccessMessage("");
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update role.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (user: ManagedUser) => {
    if (user.role === "admin" || user.role === "super_admin") return;

    const nextStatus = user.status === "active" ? "inactive" : "active";

    setError("");
    setSuccessMessage("");

    try {
      const data = await apiRequest(`/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });

      setSuccessMessage(data.message || "Account status updated.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update account status.",
      );
    }
  };

  const resetCaptainForm = () => {
    setCaptainFullName("");
    setCaptainEmail("");
    setCaptainRecoveryEmail("");
    setCaptainPhone("");
    setCaptainBarangayId("");
    setTemporaryPassword(generateTemporaryPassword());
    setShowTemporaryPassword(false);
  };

  const closeCaptainModal = () => {
    if (saving) return;
    setShowCaptainModal(false);
    resetCaptainForm();
  };

  const copyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setSuccessMessage("Temporary password copied.");
    } catch {
      setError("Unable to copy the temporary password.");
    }
  };

  const createBarangayCaptain = async (event: React.FormEvent) => {
    event.preventDefault();

    const fullName = captainFullName.trim();
    const email = captainEmail.trim().toLowerCase();
    const recoveryEmail = captainRecoveryEmail.trim().toLowerCase();

    if (!fullName || !email || !captainBarangayId || !temporaryPassword) {
      setError("Full name, email, barangay, and temporary password are required.");
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid Barangay Captain email.");
      return;
    }

    if (recoveryEmail && !/^\S+@\S+\.\S+$/.test(recoveryEmail)) {
      setError("Enter a valid recovery email.");
      return;
    }

    const phone = captainPhone.trim();

    if (phone && !isValidPhone(phone)) {
      setError(
        "Enter a valid phone number using digits only (7 to 15 digits, optional + at the start).",
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const data = await apiRequest("/admin/barangay-captains", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          email,
          recoveryEmail: recoveryEmail || null,
          phone: phone || null,
          barangayId: Number(captainBarangayId),
          temporaryPassword,
          password: temporaryPassword,
        }),
      });

      setSuccessMessage(
        data.message || "Barangay Captain account created successfully.",
      );

      await loadData();
      setShowCaptainModal(false);
      resetCaptainForm();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create the Barangay Captain account.",
      );
    } finally {
      setSaving(false);
    }
  };

  const statusClass = (status: string) => {
    if (status === "active") return "bg-emerald-500";
    if (status === "inactive") return "bg-rose-500";
    return "bg-amber-500";
  };

  return (
    <>
      <style>{`
        html.sg-dark .user-management-page [class~="bg-white"],
        html.sg-dark .user-management-page [class~="bg-slate-50"],
        html.sg-dark .user-management-page [class~="bg-slate-100"] {
          background-color: #152033 !important;
        }

        html.sg-dark .user-management-page [class~="text-slate-900"],
        html.sg-dark .user-management-page [class~="text-slate-800"],
        html.sg-dark .user-management-page [class~="text-slate-700"],
        html.sg-dark .user-management-page [class~="text-slate-600"] {
          color: #e5edf7 !important;
        }

        html.sg-dark .user-management-page [class~="text-slate-500"],
        html.sg-dark .user-management-page [class~="text-slate-400"] {
          color: #a9b7ca !important;
        }

        html.sg-dark .user-management-page [class~="border-slate-100"],
        html.sg-dark .user-management-page [class~="border-slate-200"] {
          border-color: #344258 !important;
        }

        html.sg-dark .user-management-page input,
        html.sg-dark .user-management-page select,
        html.sg-dark .user-management-page textarea {
          background-color: #0f1827 !important;
          color: #f8fafc !important;
          border-color: #46556c !important;
        }

        html.sg-dark .user-management-page input::placeholder,
        html.sg-dark .user-management-page textarea::placeholder {
          color: #8fa0b6 !important;
        }

        html.sg-dark .user-management-page [class~="bg-amber-50"] {
          background-color: #2c2314 !important;
          border-color: #8a5a16 !important;
        }

        html.sg-dark .user-management-page [class~="text-amber-700"],
        html.sg-dark .user-management-page [class~="text-amber-800"] {
          color: #fbd38d !important;
        }

        html.sg-dark .user-management-page [class~="bg-emerald-50"] {
          background-color: #0e2c25 !important;
        }

        html.sg-dark .user-management-page [class~="text-emerald-700"],
        html.sg-dark .user-management-page [class~="text-emerald-800"] {
          color: #86efac !important;
        }

        html.sg-dark .user-management-page [class~="bg-rose-50"] {
          background-color: #321820 !important;
        }

        html.sg-dark .user-management-page [class~="text-rose-700"] {
          color: #fda4af !important;
        }

        html.sg-dark .user-management-page tbody tr:hover {
          background-color: #1b293e !important;
        }
      `}</style>

      <div className="user-management-page space-y-8 pb-20 md:pb-0">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600">
            <UserCog className="h-4 w-4" />
            LGU Access Control
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            User Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage Municipal, Barangay Captain, Purok Leader, Collector, and
            Resident accounts.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setSuccessMessage("");
                setTemporaryPassword(generateTemporaryPassword());
                setShowCaptainModal(true);
              }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-sm hover:bg-emerald-800"
            >
              <Plus className="h-4 w-4" />
              Create Barangay Captain
            </button>
          )}

          <div className="relative min-w-[260px] flex-1 md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, email, or ID"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <button
            type="button"
            onClick={() => void refreshUsers(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-700"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {successMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Live sync every 5 seconds
          {lastUpdated && (
            <span className="normal-case tracking-normal">
              · {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase text-amber-700"
          >
            {pendingCount} Pending Account
            {pendingCount === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <div className="flex w-fit max-w-full gap-2 overflow-x-auto rounded-2xl bg-slate-100 p-1">
        {[
          { id: "all", label: "All Users" },
          { id: "pending", label: `Pending (${pendingCount})` },
          { id: "residents", label: "Residents" },
          { id: "collectors", label: "Collectors" },
          { id: "leaders", label: "Purok Leaders" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
              activeTab === tab.id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-6 py-5">User Identity</th>
                <th className="px-6 py-5">LGU Role</th>
                <th className="px-6 py-5">Assignment</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      Loading database users...
                    </p>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-16 text-center text-sm font-bold text-slate-500"
                  >
                    No matching users found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                          <User className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {user.full_name}
                          </p>
                          <p className="text-[10px] font-medium text-slate-400">
                            {user.email} · ID {user.id}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
                        {roleLabel(user.role)}
                      </span>
                    </td>

                    <td className="px-6 py-5">
                      <p className="text-xs font-bold text-slate-700">
                        {user.barangay_name || "No barangay"}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {user.purok_name ||
                          (user.role === "collector"
                            ? "Barangay-wide assignment"
                            : "No purok assigned")}
                      </p>
                    </td>

                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${statusClass(
                            user.status,
                          )}`}
                        />
                        <span className="text-[10px] font-bold capitalize text-slate-600">
                          {user.status}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-5">
                     {user.role === "admin" || user.role === "super_admin" ? (
                        <span className="text-[10px] font-bold text-slate-400">
                          Protected account
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openRoleModal(user)}
                            className="rounded-xl p-2 text-slate-400 transition-all hover:bg-white hover:text-emerald-600 hover:shadow-md"
                            title="Change LGU role"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => toggleStatus(user)}
                            className={`rounded-xl p-2 transition-all hover:bg-white hover:shadow-md ${
                              user.status === "active"
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }`}
                            title={
                              user.status === "active"
                                ? "Deactivate account"
                                : user.status === "pending"
                                  ? "Approve and activate account"
                                  : "Activate account"
                            }
                          >
                            {user.status === "active" ? (
                              <ShieldAlert className="h-4 w-4" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>


      {showCaptainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-100 bg-white p-6 shadow-2xl md:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                  Municipal Administrator Action
                </p>
                <h2 className="text-2xl font-black text-slate-900">
                  Create Barangay Captain
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Assign one secured captain account to an active barangay.
                </p>
              </div>

              <button
                type="button"
                onClick={closeCaptainModal}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={createBarangayCaptain} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs font-bold text-slate-600">
                  Full Name *
                  <input
                    type="text"
                    value={captainFullName}
                    onChange={(event) => setCaptainFullName(event.target.value)}
                    placeholder="Barangay Captain full name"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  />
                </label>

                <label className="block text-xs font-bold text-slate-600">
                  Phone Number
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={captainPhone}
                    onChange={(event) =>
                      setCaptainPhone(
                        sanitizePhoneInput(event.target.value),
                      )
                    }
                    placeholder="+639XXXXXXXXX"
                    maxLength={16}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs font-bold text-slate-600">
                  Login Email *
                  <input
                    type="email"
                    value={captainEmail}
                    onChange={(event) => setCaptainEmail(event.target.value)}
                    placeholder="captain@barangay.gov.ph"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  />
                </label>

                <label className="block text-xs font-bold text-slate-600">
                  Recovery Email
                  <input
                    type="email"
                    value={captainRecoveryEmail}
                    onChange={(event) =>
                      setCaptainRecoveryEmail(event.target.value)
                    }
                    placeholder="recovery@gmail.com"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  />
                </label>
              </div>

              <label className="block text-xs font-bold text-slate-600">
                Assigned Barangay *
                <div className="relative mt-2">
                  <select
                    value={captainBarangayId}
                    onChange={(event) =>
                      setCaptainBarangayId(event.target.value)
                    }
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white p-3 pr-10 text-sm"
                  >
                    <option value="">Select barangay</option>
                    {barangays.map((barangay) => (
                      <option key={barangay.id} value={barangay.id}>
                        {barangay.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                </div>
              </label>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                      Temporary Password
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      Give this password securely to the Barangay Captain.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setTemporaryPassword(generateTemporaryPassword())
                    }
                    className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-amber-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Generate
                  </button>
                </div>

                <div className="mt-3 flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showTemporaryPassword ? "text" : "password"}
                      value={temporaryPassword}
                      onChange={(event) =>
                        setTemporaryPassword(event.target.value)
                      }
                      className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 pr-11 font-mono text-sm font-bold"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowTemporaryPassword((current) => !current)
                      }
                      className="absolute right-3 top-3 text-amber-700"
                    >
                      {showTemporaryPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={copyTemporaryPassword}
                    className="rounded-xl border border-amber-200 bg-white px-4 text-amber-700"
                    title="Copy temporary password"
                  >
                    <Copy className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                The new account will use the <strong>Barangay Captain</strong>{" "}
                role, become active immediately, and must change the temporary
                password after first login.
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeCaptainModal}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] border border-slate-100 bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
                  Barangay Captain Action
                </p>
                <h2 className="text-2xl font-black text-slate-900">
                  Assign LGU Role
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedUser.full_name}
                </p>
              </div>

              <button
                onClick={closeRoleModal}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-xs font-bold text-slate-600">
                LGU Role
                <div className="relative mt-2">
                  <select
                    value={selectedRole}
                    onChange={(event) =>
                      handleRoleChange(event.target.value as ManagedRole)
                    }
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white p-3 pr-10"
                  >
                    <option value="resident">Resident</option>
                    <option value="purok_leader">Purok Leader</option>
                    <option value="collector">Garbage Collector</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                </div>
              </label>

              <label className="block text-xs font-bold text-slate-600">
                Assigned Barangay
                <div className="relative mt-2">
                  <select
                    value={selectedBarangayId}
                    onChange={(event) => {
                      setSelectedBarangayId(event.target.value);
                      setSelectedPurokId("");
                    }}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white p-3 pr-10"
                  >
                    <option value="">Select barangay</option>
                    {barangays.map((barangay) => (
                      <option key={barangay.id} value={barangay.id}>
                        {barangay.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                </div>
              </label>

              {selectedRole !== "collector" && (
                <label className="block text-xs font-bold text-slate-600">
                  Assigned Purok
                  <div className="relative mt-2">
                    <select
                      value={selectedPurokId}
                      onChange={(event) => setSelectedPurokId(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-200 bg-white p-3 pr-10"
                    >
                      <option value="">Select purok</option>
                      {visiblePuroks.map((purok) => (
                        <option key={purok.id} value={purok.id}>
                          {purok.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                  </div>
                </label>
              )}

              <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
                {selectedRole === "purok_leader" &&
                  "The Purok Leader will manage the selected purok's bins, inspections, members, and complaints."}
                {selectedRole === "collector" &&
                  "The Garbage Collector will serve the selected barangay and receive assigned collection or complaint tasks."}
                {selectedRole === "resident" &&
                  "The account will return to Resident access and retain its selected residential purok."}
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={closeRoleModal}
                disabled={saving}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={saveRole}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Assignment
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}