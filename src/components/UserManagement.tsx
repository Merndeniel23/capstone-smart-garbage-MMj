
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
import {
  markAdminActionNotificationsRead,
  notifyAdminActionCountsChanged,
} from "../hooks/useAdminActionCounts";
import ConfirmDialog from "./ConfirmDialog";
import FeedbackToast from "./FeedbackToast";
import Pagination, {
  DEFAULT_PAGE_SIZE,
} from "./Pagination";

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
  email_verified: number | boolean;
  approval_ready: number | boolean;
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

const API_BASE = "/api";

function generateTemporaryPassword() {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%&*",
  ];
  const alphabet = groups.join("");
  const randomIndex = (length: number) => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % length;
  };
  const characters = groups.map(
    (group) => group[randomIndex(group.length)],
  );

  while (characters.length < 14) {
    characters.push(alphabet[randomIndex(alphabet.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }

  return characters.join("");
}

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
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
      return "Collector";

    default:
      return "Resident";
  }
}

function isPendingApproval(user: ManagedUser) {
  return (
    user.status === "pending" &&
    Boolean(Number(user.approval_ready))
  );
}

function canAdminModifyAccount(user: ManagedUser) {
  if (user.role !== "resident" || user.status === "active") {
    return true;
  }

  if (user.status === "pending") {
    return isPendingApproval(user);
  }

  return Boolean(Number(user.email_verified));
}

export default function UserManagement({ initialRoleFilter = "all", initialStatusFilter = "all", initialCreateCaptain = false, onViewHouseholds, onRoleFilterChange }: {
  initialRoleFilter?: string;
  initialStatusFilter?: string;
  initialCreateCaptain?: boolean;
  onViewHouseholds?: () => void;
  onRoleFilterChange?: (role: string) => void;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [puroks, setPuroks] = useState<Purok[]>([]);

  const [activeTab, setActiveTab] = useState<
    "all" | "pending" | "residents" | "collectors" | "leaders"
  >("all");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState(initialRoleFilter);
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [sortBy, setSortBy] = useState("priority");
  const [sortDirection, setSortDirection] = useState("asc");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [statusConfirmation, setStatusConfirmation] = useState<ManagedUser | null>(null);
  const [roleConfirmation, setRoleConfirmation] = useState(false);
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

  const currentRole =
    localStorage.getItem("sg_user_role") ||
    sessionStorage.getItem("sg_user_role");
  const isSuperAdmin = currentRole === "super_admin";

  const [showCaptainModal, setShowCaptainModal] = useState(initialCreateCaptain && isSuperAdmin);
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
    setRefreshing(true);
    if (!silent) setError("");

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
      setRefreshing(false);
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
    void markAdminActionNotificationsRead("accounts");
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

  useEffect(() => {
    if (initialCreateCaptain && isSuperAdmin) setShowCaptainModal(true);
  }, [initialCreateCaptain, isSuperAdmin]);

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
        (activeTab === "pending" && isPendingApproval(user)) ||
        (activeTab === "residents" && user.role === "resident") ||
        (activeTab === "collectors" && user.role === "collector") ||
        (activeTab === "leaders" && user.role === "purok_leader");

      return matchesSearch && matchesTab &&
        (roleFilter === "all" || user.role === roleFilter) &&
        (barangayFilter === "all" || String(user.barangay_id) === barangayFilter) &&
        (statusFilter === "all" || user.status === statusFilter);
    }).sort((a, b) => {
      if (sortBy !== "priority") {
        const value = (user: ManagedUser) => sortBy === "name" ? user.full_name
          : sortBy === "role" ? roleLabel(user.role)
          : sortBy === "barangay" ? user.barangay_name || "" : user.status;
        return value(a).localeCompare(value(b), undefined, { sensitivity: "base", numeric: true }) * (sortDirection === "asc" ? 1 : -1);
      }
      const pendingDifference =
        Number(isPendingApproval(b)) -
        Number(isPendingApproval(a));

      if (pendingDifference !== 0) {
        return pendingDifference;
      }

      return (
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
      );
    });
  }, [users, searchTerm, activeTab, roleFilter, barangayFilter, statusFilter, sortBy, sortDirection]);

  const userPageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / userPageSize),
  );

  const visibleUsers = useMemo(() => {
    const safePage = Math.min(
      userPage,
      userPageCount,
    );
    const start = (safePage - 1) * userPageSize;

    return filteredUsers.slice(
      start,
      start + userPageSize,
    );
  }, [
    filteredUsers,
    userPage,
    userPageCount,
    userPageSize,
  ]);

  useEffect(() => {
    setUserPage(1);
  }, [
    searchTerm,
    activeTab,
    roleFilter,
    barangayFilter,
    statusFilter,
    sortBy,
    sortDirection,
  ]);

  useEffect(() => {
    if (userPage > userPageCount) {
      setUserPage(userPageCount);
    }
  }, [userPage, userPageCount]);

  const resetFilters = () => {
    setSearchTerm("");
    setRoleFilter("all");
    onRoleFilterChange?.("all");
    setBarangayFilter("all");
    setStatusFilter("all");
    setActiveTab("all");
  };

  const pendingCount = useMemo(
    () =>
      users.filter(
        (user) => isPendingApproval(user),
      ).length,
    [users],
  );

  const visiblePuroks = useMemo(() => {
    const barangayId = Number(selectedBarangayId);

    if (!barangayId) return puroks;

    return puroks.filter((purok) => purok.barangay_id === barangayId);
  }, [puroks, selectedBarangayId]);

  const openRoleModal = (user: ManagedUser) => {
    if (!canAdminModifyAccount(user)) {
      setError(
        "This resident must verify their email and complete any required profile details before admin activation.",
      );
      return;
    }

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
    if (saving) return;
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
    if (!selectedUser || saving) return;

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
      notifyAdminActionCountsChanged();

      setRoleConfirmation(false);
      setSelectedUser(null);
    } catch (err) {
      setRoleConfirmation(false);
      setError(err instanceof Error ? err.message : "Unable to update role.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (user: ManagedUser) => {
    if (saving) return;
    if (user.role === "admin" || user.role === "super_admin") return;

    if (!canAdminModifyAccount(user)) {
      setError(
        "This resident must verify their email and complete any required profile details before admin activation.",
      );
      return;
    }

    const nextStatus = user.status === "active" ? "inactive" : "active";

    setError("");
    setSuccessMessage("");
    setSaving(true);

    try {
      const data = await apiRequest(`/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });

      setSuccessMessage(data.message || "Account status updated.");
      setStatusConfirmation(null);
      await loadData();
      notifyAdminActionCountsChanged();
    } catch (err) {
      setStatusConfirmation(null);
      setError(
        err instanceof Error ? err.message : "Unable to update account status.",
      );
    } finally {
      setSaving(false);
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

    if (
      temporaryPassword.length < 12 ||
      !/[A-Z]/.test(temporaryPassword) ||
      !/[a-z]/.test(temporaryPassword) ||
      !/\d/.test(temporaryPassword) ||
      !/[^A-Za-z0-9]/.test(temporaryPassword)
    ) {
      setError(
        "Use a temporary password of at least 12 characters with uppercase, lowercase, number, and symbol.",
      );
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
            {isSuperAdmin ? roleFilter === "admin" ? "Barangay Captains" : "User Directory" : "User Management"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSuperAdmin ? "System accounts across municipal, barangay, and collection roles. Household records are managed in the Household Directory." : "Manage Purok Leader, Collector, and Resident accounts in your barangay."}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:flex-wrap md:items-center">
          {isSuperAdmin && onViewHouseholds && (
            <button type="button" onClick={onViewHouseholds} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700">Household Directory</button>
          )}
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
              aria-label="Search users by name, email, or ID"
              placeholder="Search name, email, or ID"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <button
            type="button"
            onClick={() => void refreshUsers(false)}
            disabled={refreshing || loading}
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
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {isSuperAdmin && <FeedbackToast message={successMessage} onDismiss={() => setSuccessMessage("")} />}
      {!isSuperAdmin && successMessage && (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
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
            onClick={() => { setActiveTab("pending"); setRoleFilter("all"); onRoleFilterChange?.("all"); setStatusFilter("all"); }}
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
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => {
              const nextRole = tab.id === "residents" ? "resident" : tab.id === "collectors" ? "collector" : tab.id === "leaders" ? "purok_leader" : "all";
              setActiveTab(tab.id as typeof activeTab);
              setRoleFilter(nextRole);
              onRoleFilterChange?.(nextRole);
              setStatusFilter("all");
            }}
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

      <section aria-label="Filter user directory" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-bold text-slate-600">Role
            <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); onRoleFilterChange?.(event.target.value); setActiveTab("all"); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="all">All roles</option>
              {isSuperAdmin && <><option value="super_admin">Municipal Administrator</option><option value="admin">Barangay Captain</option></>}
              <option value="purok_leader">Purok Leader</option><option value="collector">Collector</option><option value="resident">Resident</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Barangay
            <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="all">All barangays</option>
              {barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Account status
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setActiveTab("all"); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive / suspended</option><option value="pending">Pending</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Sort by
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="priority">Pending approval first</option><option value="name">Name</option><option value="role">Role</option><option value="barangay">Barangay</option><option value="status">Status</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Order
            <select value={sortDirection} disabled={sortBy === "priority"} onChange={(event) => setSortDirection(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm disabled:opacity-50">
              <option value="asc">A to Z</option><option value="desc">Z to A</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span role="status">{loading ? "Loading accounts..." : `${filteredUsers.length} of ${users.length} accounts`}</span>
          <button type="button" onClick={resetFilters} className="rounded-lg px-3 py-2 font-bold text-emerald-700 hover:bg-emerald-50">Clear filters</button>
        </div>
      </section>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">User Identity</th>
                <th className="px-4 py-3">LGU Role</th>
                <th className="hidden px-4 py-3 xl:table-cell">Assignment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                    <td colSpan={5} className="px-4 py-12 text-center">
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
                    className="px-4 py-12 text-center text-sm font-bold text-slate-500"
                  >
                    <p>No matching accounts found.</p>
                    <button type="button" onClick={resetFilters} className="mt-3 rounded-lg px-3 py-2 font-bold text-emerald-700 hover:bg-emerald-50">Clear filters and search</button>
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                          <User className="h-4 w-4" />
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

                    <td className="px-4 py-3">
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
                        {roleLabel(user.role)}
                      </span>
                    </td>

                    <td className="hidden px-4 py-3 xl:table-cell">
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

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${statusClass(
                            user.status,
                          )}`}
                        />
                        <span className="text-[10px] font-bold capitalize text-slate-600">
                          {user.status === "pending" && !isPendingApproval(user)
                            ? "Awaiting email verification"
                            : user.status}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                     {user.role === "admin" || user.role === "super_admin" ? (
                        <span className="text-[10px] font-bold text-slate-400">
                          Protected account
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openRoleModal(user)}
                            aria-label={`Edit User: ${user.full_name}`}
                            disabled={
                              saving || !canAdminModifyAccount(user)
                            }
                            className="rounded-xl p-2 text-slate-400 transition-all hover:bg-white hover:text-emerald-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:hover:shadow-none"
                            title={
                              !canAdminModifyAccount(user)
                                ? "Email verification and required profile details are needed first"
                                : "Edit User"
                            }
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => setStatusConfirmation(user)}
                            aria-label={`${user.status === "active" ? "Suspend Account" : "Activate Account"}: ${user.full_name}`}
                            disabled={
                              saving || !canAdminModifyAccount(user)
                            }
                            className={`rounded-xl p-2 transition-all hover:bg-white hover:shadow-md ${
                              user.status === "active"
                                ? "text-amber-600"
                                : "text-emerald-600"
                            } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none`}
                            title={
                              user.status === "active"
                                ? "Suspend Account"
                                : user.status === "pending"
                                  ? isPendingApproval(user)
                                    ? "Approve and activate account"
                                    : "Email verification and required profile details are needed first"
                                  : !canAdminModifyAccount(user)
                                    ? "Email verification is required before activation"
                                  : "Activate Account"
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

      <div className="space-y-3 md:hidden">
        {loading ? (
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-12 text-center shadow-sm">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
            <p className="mt-2 text-sm font-bold text-slate-500">
              Loading database users...
            </p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-12 text-center text-sm font-bold text-slate-500 shadow-sm">
            <p>No matching accounts found.</p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 rounded-lg px-3 py-2 font-bold text-emerald-700 hover:bg-emerald-50"
            >
              Clear filters and search
            </button>
          </div>
        ) : (
          visibleUsers.map((user) => (
            <article
              key={user.id}
              className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {user.full_name}
                    </p>
                    <p className="truncate text-[10px] font-medium text-slate-400">
                      {user.email} · ID {user.id}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-700">
                  {roleLabel(user.role)}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                    Assignment
                  </p>
                  <p className="mt-1 truncate font-bold text-slate-700">
                    {user.barangay_name || "No barangay"}
                  </p>
                  <p className="truncate text-[10px] text-slate-400">
                    {user.purok_name ||
                      (user.role === "collector"
                        ? "Barangay-wide"
                        : "No purok")}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                    Status
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${statusClass(
                        user.status,
                      )}`}
                    />
                    <span className="text-[10px] font-bold capitalize text-slate-600">
                      {user.status === "pending" &&
                      !isPendingApproval(user)
                        ? "Awaiting verification"
                        : user.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                {user.role === "admin" ||
                user.role === "super_admin" ? (
                  <span className="text-[10px] font-bold text-slate-400">
                    Protected account
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openRoleModal(user)}
                      disabled={
                        saving || !canAdminModifyAccount(user)
                      }
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[10px] font-black uppercase text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        !canAdminModifyAccount(user)
                          ? "Email verification and required profile details are needed first"
                          : "Edit user"
                      }
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStatusConfirmation(user)
                      }
                      disabled={
                        saving || !canAdminModifyAccount(user)
                      }
                      className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                        user.status === "active"
                          ? "bg-amber-600"
                          : "bg-emerald-700"
                      }`}
                      title={
                        user.status === "active"
                          ? "Suspend account"
                          : "Activate account"
                      }
                    >
                      {user.status === "active" ? (
                        <ShieldAlert className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {user.status === "active"
                        ? "Suspend"
                        : "Activate"}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {!loading && filteredUsers.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white px-4 pb-3 shadow-sm">
          <Pagination
            page={userPage}
            pageSize={userPageSize}
            totalItems={filteredUsers.length}
            itemLabel="accounts"
            compact
            onPageChange={setUserPage}
            onPageSizeChange={(nextPageSize) => {
              setUserPageSize(nextPageSize);
              setUserPage(1);
            }}
          />
        </div>
      )}


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
                  {isSuperAdmin ? "Municipal Administrator Action" : "Barangay Captain Action"}
                </p>
                <h2 className="text-2xl font-black text-slate-900">
                  Edit User Assignment
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedUser.full_name}
                </p>
              </div>

              <button
                onClick={closeRoleModal}
                aria-label="Close user assignment"
                disabled={saving}
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
                    <option value="collector">Collector</option>
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
                  "The Collector will serve the selected barangay and receive assigned collection or complaint tasks."}
                {selectedRole === "resident" &&
                  "The account will return to Resident access and retain its selected residential purok."}
              </div>
              <p className="text-xs text-slate-500">Saving this assignment also activates the account.</p>
              {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
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
                onClick={() => setRoleConfirmation(true)}
                disabled={saving || !selectedBarangayId || (selectedRole !== "collector" && !selectedPurokId)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Assignment
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!statusConfirmation}
        title={statusConfirmation?.status === "active" ? "Suspend Account?" : "Activate Account?"}
        description={statusConfirmation ? `${statusConfirmation.status === "active" ? "Suspend" : "Activate"} the account for ${statusConfirmation.full_name} (${statusConfirmation.email})? ${statusConfirmation.status === "active" ? "They will lose access until the account is activated again." : "They will be able to access the system with their assigned role."}` : ""}
        confirmLabel={statusConfirmation?.status === "active" ? "Suspend Account" : "Activate Account"}
        destructive={statusConfirmation?.status === "active"}
        busy={saving}
        onCancel={() => setStatusConfirmation(null)}
        onConfirm={() => { if (statusConfirmation) void toggleStatus(statusConfirmation); }}
      />
      <ConfirmDialog
        open={roleConfirmation && !!selectedUser}
        title="Save account assignment?"
        description={`Assign ${selectedUser?.full_name || "this account"} as ${roleLabel(selectedRole)} in ${barangays.find((barangay) => String(barangay.id) === selectedBarangayId)?.name || "the selected barangay"}? This updates their permissions and activates their account.`}
        confirmLabel="Save Assignment"
        busy={saving}
        onCancel={() => setRoleConfirmation(false)}
        onConfirm={() => void saveRole()}
      />
      </div>
    </>
  );
}
