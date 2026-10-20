
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CalendarDays,
  MapPin,
  Phone,
  ShieldCheck,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  User,
  UserCog,
  X,
} from "lucide-react";
import {
  markAdminActionNotificationsRead,
  notifyAdminActionCountsChanged,
} from "../hooks/useAdminActionCounts";
import ConfirmDialog from "./ConfirmDialog";
import { portalOverlays } from "./PortalOverlays";
import RecordActions from "./RecordActions";
import FeedbackToast from "./FeedbackToast";
import EmailVerificationForm from "./EmailVerificationForm";
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
  email_verification_required?: number | boolean;
  approval_ready: number | boolean;
  can_delete?: boolean;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
  profile_photo?: string | null;
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
type StaffRole = "collector" | "purok_leader";
interface StaffDraft {
  fullName: string;
  email: string;
  phone: string;
  purokId: string;
  temporaryPassword: string;
  confirmTemporaryPassword: string;
}
const emptyStaffDraft: StaffDraft = {
  fullName: "", email: "", phone: "", purokId: "", temporaryPassword: "", confirmTemporaryPassword: "",
};

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

function formatRegisteredDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-PH", {
    year: "numeric", month: "long", day: "numeric",
  });
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

function needsEmailVerification(user: ManagedUser) {
  if (user.status === "pending_activation") return false;
  return Boolean(Number(user.email_verification_required)) ||
    (user.status === "pending" && !Boolean(Number(user.email_verified)));
}

function accountStatusLabel(user: ManagedUser) {
  if (user.status === "pending_activation") return "Pending Password Setup";
  if (needsEmailVerification(user)) return "Pending Verification";
  if (user.status === "pending") return "Pending Approval";
  if (user.status === "inactive") return "Inactive / Suspended";
  return user.status;
}

function canAdminModifyAccount(user: ManagedUser) {
  if (user.status === "pending_activation") return false;
  if (needsEmailVerification(user)) return false;
  if (user.role !== "resident" || user.status === "active") {
    return true;
  }

  if (user.status === "pending") {
    return isPendingApproval(user);
  }

  return Boolean(Number(user.email_verified));
}

export default function UserManagement({ initialRoleFilter = "all", initialStatusFilter = "all", initialCreateCaptain = false, onRoleFilterChange }: {
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
    "all" | "pending" | "captains" | "residents" | "collectors" | "leaders"
  >("all");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState(initialRoleFilter);
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [purokFilter, setPurokFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [sortBy, setSortBy] = useState("priority");
  const [sortDirection, setSortDirection] = useState("asc");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [statusConfirmation, setStatusConfirmation] = useState<ManagedUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<ManagedUser | null>(null);
  const [detailsUser, setDetailsUser] = useState<ManagedUser | null>(null);
  const deletingRef = useRef(false);
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
  const isBarangayCaptain = currentRole === "admin";

  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [secureSetup, setSecureSetup] = useState(false);
  useEffect(()=>{void fetch("/api/account-setup/config").then(res=>res.json()).then(data=>setSecureSetup(data.enabled===true)).catch(()=>undefined);},[]);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>(emptyStaffDraft);
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [showPurokModal, setShowPurokModal] = useState(false);
  const [newPurokName, setNewPurokName] = useState("");
  const [purokSaving, setPurokSaving] = useState(false);
  const [purokError, setPurokError] = useState("");
  const [purokSuccess, setPurokSuccess] = useState("");
  const [editingPurokId, setEditingPurokId] = useState<number | null>(null);
  const [editingPurokName, setEditingPurokName] = useState("");
  const [editPurokError, setEditPurokError] = useState("");
  const [editPurokSuccess, setEditPurokSuccess] = useState("");
  const [verification, setVerification] = useState<{ email: string; resendAfter: number } | null>(null);
  // The locations endpoint returns only the captain's assigned barangay.
  const assignedBarangay = isBarangayCaptain ? barangays[0] : undefined;
  const staffPuroks = puroks
    .filter((purok) => Number(purok.barangay_id) === Number(assignedBarangay?.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

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

  const barangayCaptainIds = useMemo(
    () =>
      new Set(
        users
          .filter(
            (user) =>
              user.role === "admin" &&
              user.barangay_id,
          )
          .map((user) =>
            Number(user.barangay_id),
          ),
      ),
    [users],
  );

  const availableCaptainBarangays = useMemo(
    () =>
      barangays.filter(
        (barangay) =>
          !barangayCaptainIds.has(
            Number(barangay.id),
          ),
      ),
    [barangays, barangayCaptainIds],
  );

  const createPurok = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (purokSaving || !assignedBarangay) return;
    const name = newPurokName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100) {
      setPurokError("Enter a valid purok name between 2 and 100 characters.");
      return;
    }
    if (staffPuroks.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
      setPurokError(`${name} already exists in ${assignedBarangay.name}.`);
      return;
    }

    setPurokSaving(true);
    setPurokError("");
    setPurokSuccess("");
    try {
      const response = await apiRequest("/admin/puroks", {
        method: "POST",
        body: JSON.stringify({
          name,
        }),
      });
      // Refresh from DB, rather than inventing a temporary local purok ID.
      const locations = await apiRequest("/admin/locations");
      setPuroks(Array.isArray(locations.puroks) ? locations.puroks : []);
      setNewPurokName("");
      setPurokSuccess(response.message || "Purok added successfully.");
    } catch (err) {
      setPurokError(err instanceof Error ? err.message : "Unable to add purok.");
    } finally {
      setPurokSaving(false);
    }
  };

  const startEditingPurok = (purok: Purok) => {
    if (purokSaving) return;
    setEditingPurokId(purok.id);
    setEditingPurokName(purok.name);
    setEditPurokError("");
    setEditPurokSuccess("");
  };

  const stopEditingPurok = () => {
    if (purokSaving) return;
    setEditingPurokId(null);
    setEditingPurokName("");
    setEditPurokError("");
  };

  const savePurokName = async (event: React.FormEvent<HTMLFormElement>, purok: Purok) => {
    event.preventDefault();
    if (purokSaving || !assignedBarangay || editingPurokId !== purok.id) return;

    const name = editingPurokName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100 || !/^[\p{L}\p{N} .'-]+$/u.test(name)) {
      setEditPurokError("Enter a valid purok name (2–100 characters, letters and numbers).");
      return;
    }
    if (staffPuroks.some((item) =>
      item.id !== purok.id && item.name.trim().toLowerCase() === name.toLowerCase()
    )) {
      setEditPurokError(`${name} already exists in ${assignedBarangay.name}.`);
      return;
    }
    if (name === purok.name) {
      stopEditingPurok();
      return;
    }

    setPurokSaving(true);
    setEditPurokError("");
    setEditPurokSuccess("");
    try {
      const response = await apiRequest(`/admin/puroks/${purok.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      // Keep the same ID: users, leaders, payments and inspections stay linked.
      setPuroks((current) => current.map((item) =>
        item.id === purok.id ? { ...item, name } : item
      ));
      setUsers((current) => current.map((user) =>
        Number(user.purok_id) === purok.id ? { ...user, purok_name: name } : user
      ));
      setEditingPurokId(null);
      setEditingPurokName("");
      setEditPurokSuccess(response.message || "Purok name updated successfully.");
    } catch (err) {
      setEditPurokError(err instanceof Error ? err.message : "Unable to rename this purok.");
    } finally {
      setPurokSaving(false);
    }
  };

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
        (activeTab === "pending" && user.status === "pending") ||
        (activeTab === "captains" && user.role === "admin") ||
        (activeTab === "residents" && user.role === "resident") ||
        (activeTab === "collectors" && user.role === "collector") ||
        (activeTab === "leaders" && user.role === "purok_leader");

      return matchesSearch && matchesTab &&
        (roleFilter === "all" || user.role === roleFilter) &&
        (isBarangayCaptain
          ? purokFilter === "all" || (purokFilter === "unassigned" ? !user.purok_id : String(user.purok_id) === purokFilter)
          : barangayFilter === "all" || String(user.barangay_id) === barangayFilter) &&
        (statusFilter === "all" || user.status === statusFilter);
    }).sort((a, b) => {
      if (sortBy !== "priority") {
        const value = (user: ManagedUser) => sortBy === "name" ? user.full_name
          : sortBy === "role" ? roleLabel(user.role)
          : sortBy === "barangay" ? user.barangay_name || ""
          : sortBy === "purok" ? user.purok_name || (user.role === "collector" ? "Barangay-wide assignment" : "No purok assigned")
          : user.status;
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
  }, [users, searchTerm, activeTab, roleFilter, barangayFilter, purokFilter, isBarangayCaptain, statusFilter, sortBy, sortDirection]);

  const viewedUser = detailsUser
    ? users.find((user) => user.id === detailsUser.id) ?? detailsUser
    : null;

  useEffect(() => {
    if (!detailsUser) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsUser(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailsUser]);

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
    purokFilter,
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
    setPurokFilter("all");
    setStatusFilter("all");
    setActiveTab("all");
  };

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
    if (!canAdminModifyAccount(user)) {
      setError(
        "This account must verify its email and complete any required profile details before admin activation.",
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
        "This account must verify its email and complete any required profile details before admin activation.",
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

  const requestDeleteUser = (user: ManagedUser) => {
    if (saving || deletingRef.current || !user.can_delete) return;
    setError("");
    setSuccessMessage("");
    setDeleteConfirmation(user);
  };

  const deleteUser = async (user: ManagedUser) => {
    if (saving || deletingRef.current || !user.can_delete) return;
    deletingRef.current = true;
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const data = await apiRequest(`/admin/users/${user.id}`, {
        method: "DELETE",
      });

      setUsers((currentUsers) => currentUsers.filter((item) => item.id !== user.id));
      setDeleteConfirmation(null);
      if (statusConfirmation?.id === user.id) setStatusConfirmation(null);
      if (selectedUser?.id === user.id) {
        setRoleConfirmation(false);
        setSelectedUser(null);
        setSelectedBarangayId("");
        setSelectedPurokId("");
      }
      if (verification?.email === user.email) setVerification(null);
      setSuccessMessage(data.message || "Account removed successfully. Historical records were preserved.");
      notifyAdminActionCountsChanged();
      await refreshUsers(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the account.");
    } finally {
      deletingRef.current = false;
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

    if (
      barangayCaptainIds.has(
        Number(captainBarangayId),
      )
    ) {
      setError(
        "This barangay already has a Barangay Captain. Only one captain account is allowed per barangay.",
      );
      return;
    }

    if (!availableCaptainBarangays.some((barangay) => Number(barangay.id) === Number(captainBarangayId))) {
      setError("Select an active barangay without an assigned captain.");
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
      if (data.requiresEmailVerification) {
        setVerification({ email: data.email || email, resendAfter: Number(data.resendAfter) || 60 });
      }
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

  const openStaffModal = (role: StaffRole) => {
    if (!isBarangayCaptain) return;
    setStaffRole(role);
    setStaffDraft({ ...emptyStaffDraft });
    setShowStaffPassword(false);
    setError("");
    setSuccessMessage("");
  };

  const closeStaffModal = () => {
    if (saving) return;
    setStaffRole(null);
    setStaffDraft({ ...emptyStaffDraft });
    setError("");
  };

  const createStaffAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !staffRole || !isBarangayCaptain) return;
    setError("");
    setSuccessMessage("");
    const fullName = staffDraft.fullName.trim();
    const email = staffDraft.email.trim().toLowerCase();
    const phone = staffDraft.phone.trim();
    if (!assignedBarangay) {
      setError("Your account must have an assigned barangay before creating staff accounts.");
      return;
    }
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email) || !isValidPhone(phone)) {
      setError("Enter a full name, valid email, and mobile number (7 to 15 digits, optionally starting with +).");
      return;
    }
    const purokId = staffRole === "purok_leader" ? Number(staffDraft.purokId) : null;
    if (staffRole === "purok_leader" && !staffPuroks.some((purok) => Number(purok.id) === purokId)) {
      setError("Select a valid purok in your assigned barangay.");
      return;
    }
    const password = staffDraft.temporaryPassword;
    if (!secureSetup && (password.length < 12 || password.length > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password))) {
      setError("Use a temporary password of 12 to 72 characters with uppercase, lowercase, a number, and a symbol.");
      return;
    }
    if (!secureSetup && password !== staffDraft.confirmTemporaryPassword) {
      setError("Temporary passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const data = await apiRequest("/admin/staff", {
        method: "POST",
        body: JSON.stringify({
          role: staffRole, fullName, email, phone,
          barangayId: Number(assignedBarangay.id), purokId,
          ...(!secureSetup ? {temporaryPassword: password, confirmTemporaryPassword: staffDraft.confirmTemporaryPassword} : {}),
        }),
      });
      setSuccessMessage(data.message || "Account created. Email verification is required before signing in.");
      setStaffRole(null);
      setStaffDraft({ ...emptyStaffDraft });
      await loadData();
      notifyAdminActionCountsChanged();
      if (data.requiresEmailVerification) {
        setVerification({ email: data.email || email, resendAfter: Number(data.resendAfter) || 60 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the staff account.");
    } finally {
      setSaving(false);
    }
  };

  const statusClass = (status: string) => {
    if (status === "active") return "bg-emerald-500";
    if (status === "inactive") return "bg-rose-500";
    return "bg-amber-500";
  };

  return portalOverlays(
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
            {isSuperAdmin ? "User Directory" : "User Management"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSuperAdmin ? "One directory for Municipal Administrator, Barangay Captains, Purok Leaders, Collectors, and Residents. Use the role filters below to narrow the list." : "Manage Purok Leader, Collector, and Resident accounts in your barangay."}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:flex-wrap md:items-center">
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
          {isBarangayCaptain && (
            <>
              <button
                type="button"
                onClick={() => {
                  setNewPurokName("");
                  setPurokError("");
                  setPurokSuccess("");
                  setEditPurokError("");
                  setEditPurokSuccess("");
                  setEditingPurokId(null);
                  setEditingPurokName("");
                  setShowPurokModal(true);
                }}
                disabled={loading || !assignedBarangay}
                className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-200"
              >
                <Plus className="h-4 w-4" /> Manage Puroks
              </button>
              <button type="button" onClick={() => openStaffModal("purok_leader")} disabled={loading || !assignedBarangay} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-xs font-black uppercase tracking-wide text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" />Create Purok Leader
              </button>
              <button type="button" onClick={() => openStaffModal("collector")} disabled={loading || !assignedBarangay} className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" />Create Collector
              </button>
            </>
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
          ...(isSuperAdmin ? [{ id: "captains", label: "Barangay Captains" }] : []),
          { id: "residents", label: "Residents" },
          { id: "collectors", label: "Collectors" },
          { id: "leaders", label: "Purok Leaders" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => {
              const nextRole =
                tab.id === "captains"
                  ? "admin"
                  : tab.id === "residents"
                    ? "resident"
                    : tab.id === "collectors"
                      ? "collector"
                      : tab.id === "leaders"
                        ? "purok_leader"
                        : "all";
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
          {isBarangayCaptain ? (
            <label className="text-xs font-bold text-slate-600">Purok
              <select value={purokFilter} onChange={(event) => setPurokFilter(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <option value="all">All puroks / assignments</option>
                {staffPuroks.map((purok) => <option key={purok.id} value={purok.id}>{purok.name}</option>)}
                <option value="unassigned">No purok / barangay-wide</option>
              </select>
            </label>
          ) : (
            <label className="text-xs font-bold text-slate-600">Barangay
              <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <option value="all">All barangays</option>
                {barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs font-bold text-slate-600">Account status
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setActiveTab("all"); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive / suspended</option><option value="pending">Pending</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Sort by
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="priority">Pending approval first</option><option value="name">Name</option><option value="role">Role</option>
              {isBarangayCaptain ? <option value="purok">Purok</option> : <option value="barangay">Barangay</option>}
              <option value="status">Status</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">Order
            <select value={sortDirection} disabled={sortBy === "priority"} onChange={(event) => setSortDirection(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm disabled:opacity-50">
              <option value="asc">A to Z</option><option value="desc">Z to A</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span role="status">{loading ? "Loading accounts..." : `${filteredUsers.length} of ${users.length} accounts${assignedBarangay ? ` in ${assignedBarangay.name}` : ""}`}</span>
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
                <th className={isBarangayCaptain ? "px-4 py-3" : "hidden px-4 py-3 xl:table-cell"}>{isBarangayCaptain ? "Purok" : "Assignment"}</th>
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
                          <button
                            type="button"
                            onClick={() => setDetailsUser(user)}
                            aria-label={`View details for ${user.full_name}`}
                            title="View account details"
                            className="block max-w-[16rem] truncate rounded text-left text-sm font-bold text-slate-900 transition hover:text-emerald-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                          >
                            {user.full_name}
                          </button>
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

                    <td className={isBarangayCaptain ? "px-4 py-3" : "hidden px-4 py-3 xl:table-cell"}>
                      <p className="text-xs font-bold text-slate-700">
                        {isBarangayCaptain
                          ? user.purok_name || (user.role === "collector" ? "Barangay-wide assignment" : "No purok assigned")
                          : user.barangay_name || "No barangay"}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {isBarangayCaptain ? user.barangay_name || "No barangay" : user.purok_name ||
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
                          {accountStatusLabel(user)}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                      {user.status === "pending_activation" ? (
                        <button type="button" disabled={saving} onClick={()=>{setSaving(true);void apiRequest(`/account-setup/${user.id}/resend`,{method:"POST"}).then(data=>setSuccessMessage(data.message)).catch(error=>setError(error.message)).finally(()=>setSaving(false));}} className="rounded-xl border px-3 py-2 text-xs font-bold text-emerald-700">Resend setup link</button>
                      ) : needsEmailVerification(user) ? (
                        <button type="button" onClick={() => { setError(""); setVerification({ email: user.email, resendAfter: 0 }); }} className="inline-flex items-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                          <Mail className="h-4 w-4" />Verify Email
                        </button>
                      ) : user.role === "super_admin" ? (
                        <span className="text-[10px] font-bold text-slate-400">
                          Protected account
                        </span>
                      ) : user.role === "admin" ? (
                        <span className="text-[10px] font-bold text-slate-400">
                          Managed by Municipal Administrator
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
                      {Boolean(user.can_delete) && (
                        <RecordActions label={user.full_name} disabled={saving} onArchive={()=>requestDeleteUser(user)} />
                      )}
                      </div>
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
                    <button
                      type="button"
                      onClick={() => setDetailsUser(user)}
                      aria-label={`View details for ${user.full_name}`}
                      title="View account details"
                      className="block max-w-full truncate rounded text-left text-sm font-bold text-slate-900 transition hover:text-emerald-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                    >
                      {user.full_name}
                    </button>
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
                    {isBarangayCaptain ? "Purok" : "Assignment"}
                  </p>
                  <p className="mt-1 truncate font-bold text-slate-700">
                    {isBarangayCaptain
                      ? user.purok_name || (user.role === "collector" ? "Barangay-wide" : "No purok assigned")
                      : user.barangay_name || "No barangay"}
                  </p>
                  <p className="truncate text-[10px] text-slate-400">
                    {isBarangayCaptain ? user.barangay_name || "No barangay" : user.purok_name ||
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
                      {accountStatusLabel(user)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {user.status === "pending_activation" ? (
                  <button type="button" disabled={saving} onClick={()=>{setSaving(true);void apiRequest(`/account-setup/${user.id}/resend`,{method:"POST"}).then(data=>setSuccessMessage(data.message)).catch(error=>setError(error.message)).finally(()=>setSaving(false));}} className="rounded-xl border px-3 py-2 text-xs font-bold text-emerald-700">Resend setup link</button>
                ) : needsEmailVerification(user) ? (
                  <button type="button" onClick={() => { setError(""); setVerification({ email: user.email, resendAfter: 0 }); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                    <Mail className="h-4 w-4" />Verify Email
                  </button>
                ) : user.role === "super_admin" ? (
                  <span className="text-[10px] font-bold text-slate-400">
                    Protected account
                  </span>
                ) : user.role === "admin" ? (
                  <span className="text-[10px] font-bold text-slate-400">
                    Managed by Municipal Administrator
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
                {Boolean(user.can_delete) && (
                  <RecordActions label={user.full_name} disabled={saving} onArchive={()=>requestDeleteUser(user)} />
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


      {showPurokModal && isBarangayCaptain && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5">
          <div role="dialog" aria-modal="true" aria-labelledby="manage-puroks-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Barangay Captain</p>
                <h2 id="manage-puroks-title" className="mt-1 text-xl font-black text-slate-900 dark:text-white">Manage Puroks</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Add or rename puroks within <strong>{assignedBarangay?.name || "your barangay"}</strong>.</p>
              </div>
              <button type="button" aria-label="Close Manage Puroks" onClick={() => setShowPurokModal(false)} disabled={purokSaving} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={createPurok} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">Purok Name *
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={100}
                  placeholder="Example: Purok Sampaguita or Purok 10"
                  value={newPurokName}
                  onChange={(event) => setNewPurokName(event.target.value)}
                  disabled={purokSaving}
                  className="mt-2 block w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </label>
              {purokError && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">{purokError}</p>}
              {purokSuccess && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">{purokSuccess}</p>}
              <button type="submit" disabled={purokSaving || !newPurokName.trim() || !assignedBarangay} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {purokSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {purokSaving ? "Adding Purok..." : "Add Purok"}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Existing Puroks ({staffPuroks.length})</h3>
              {editPurokSuccess && (
                <p role="status" className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{editPurokSuccess}</p>
              )}
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {staffPuroks.length ? staffPuroks.map((purok) => (
                  <div key={purok.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {editingPurokId === purok.id ? (
                      <form onSubmit={(event) => void savePurokName(event, purok)} className="space-y-2">
                        <label htmlFor={`edit-purok-${purok.id}`} className="block text-xs font-semibold">Edit Purok Name (ID {purok.id})</label>
                        <input
                          id={`edit-purok-${purok.id}`}
                          type="text"
                          required
                          autoFocus
                          maxLength={100}
                          value={editingPurokName}
                          onChange={(event) => setEditingPurokName(event.target.value)}
                          disabled={purokSaving}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                        {editPurokError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{editPurokError}</p>}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button type="button" onClick={stopEditingPurok} disabled={purokSaving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700">Cancel</button>
                          <button type="submit" disabled={purokSaving || !editingPurokName.trim() || editingPurokName.trim().replace(/\s+/g, " ") === purok.name} className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                            {purokSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            {purokSaving ? "Saving..." : "Save Name"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words">{purok.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">ID {purok.id}</span>
                          <button type="button" aria-label={`Edit ${purok.name}`} title={`Rename ${purok.name}`} onClick={() => startEditingPurok(purok)} disabled={purokSaving} className="flex items-center gap-1 rounded-lg border border-emerald-600 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-600 dark:text-emerald-300 dark:hover:bg-emerald-950">
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )) : <p className="text-xs text-slate-500 dark:text-slate-400">No puroks created yet.</p>}
              </div>
              <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">New or renamed puroks appear when assigning Purok Leaders and residents. Purok IDs never change, and existing puroks cannot be deleted here to protect linked records.</p>
            </div>
          </div>
        </div>
      )}

      {staffRole && isBarangayCaptain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="create-staff-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-100 bg-white p-6 shadow-2xl md:p-8">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Barangay Captain Action</p>
                <h2 id="create-staff-title" className="mt-1 text-xl font-black text-slate-900">Create {staffRole === "purok_leader" ? "Purok Leader" : "Collector"}</h2>
                <p className="mt-1 text-sm text-slate-500">Create an account within your assigned barangay.</p>
              </div>
              <button type="button" onClick={closeStaffModal} disabled={saving} aria-label="Close account form" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={createStaffAccount} className="sg-compact-form">
              <fieldset disabled={saving} className="sg-form-section">
                <legend className="sg-form-section-title">Account details</legend>
                <div className="sg-form-grid sg-form-grid--two">
                  <label className="block text-xs font-bold text-slate-600">Full Name *
                    <input required maxLength={150} autoComplete="name" value={staffDraft.fullName} onChange={(event) => setStaffDraft((draft) => ({ ...draft, fullName: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Email *
                    <input required type="email" maxLength={150} autoComplete="email" value={staffDraft.email} onChange={(event) => setStaffDraft((draft) => ({ ...draft, email: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Mobile Number *
                    <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={16} value={staffDraft.phone} onChange={(event) => setStaffDraft((draft) => ({ ...draft, phone: sanitizePhoneInput(event.target.value) }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={saving} className="sg-form-section">
                <legend className="sg-form-section-title">Assignment</legend>
                <div className="sg-form-grid sg-form-grid--two">
                  <label className="block text-xs font-bold text-slate-600">Assigned Barangay
                    <input value={assignedBarangay?.name || "No assigned barangay"} readOnly aria-readonly="true" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-100 p-3 text-sm" />
                    <span className="mt-1.5 block text-[11px] font-normal text-slate-500">Fixed to your barangay.</span>
                  </label>
                  {staffRole === "purok_leader" && <label className="block text-xs font-bold text-slate-600">Assigned Purok *
                    <select required value={staffDraft.purokId} onChange={(event) => setStaffDraft((draft) => ({ ...draft, purokId: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                      <option value="">Select a purok</option>
                      {staffPuroks.map((purok) => {
                        const occupied = users.some((user) => user.role === "purok_leader" && Number(user.purok_id) === Number(purok.id) && (user.status === "active" || user.status === "pending"));
                        return <option key={purok.id} value={purok.id} disabled={occupied}>{purok.name}{occupied ? " — leader assigned" : ""}</option>;
                      })}
                    </select>
                  </label>}
                </div>
              </fieldset>

              {!secureSetup && <fieldset disabled={saving} className="sg-form-section">
                <legend className="sg-form-section-title">Temporary password</legend>
                <div className="sg-form-grid sg-form-grid--two">
                  <label className="block text-xs font-bold text-slate-600">Temporary Password *
                    <input required type={showStaffPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={72} value={staffDraft.temporaryPassword} onChange={(event) => setStaffDraft((draft) => ({ ...draft, temporaryPassword: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Confirm Temporary Password *
                    <input required type={showStaffPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={72} value={staffDraft.confirmTemporaryPassword} onChange={(event) => setStaffDraft((draft) => ({ ...draft, confirmTemporaryPassword: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">12–72 characters with uppercase, lowercase, a number, and a symbol.</p>
                  <button type="button" aria-pressed={showStaffPassword} onClick={() => setShowStaffPassword((show) => !show)} className="text-xs font-bold text-emerald-700 hover:underline">{showStaffPassword ? "Hide passwords" : "Show passwords"}</button>
                </div>
              </fieldset>}

              <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{secureSetup ? "The account starts as pending_activation. Its owner receives a single-use password setup link that expires in one hour. No password is emailed or shared by the Admin." : "A verification code will be sent to the account owner. The temporary password must be changed on first login."}</p>
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={closeStaffModal} disabled={saving} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving || !assignedBarangay} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Creating..." : "Create Account"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {verification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Verify account email" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
            <p className="mb-5 text-xs leading-relaxed text-slate-500">The account owner can enter their emailed code here or use “Verify an existing account” on the Sign In page.</p>
            <EmailVerificationForm
              key={verification.email}
              variant="management"
              email={verification.email}
              initialResendAfter={verification.resendAfter}
              backLabel="Back to User Management"
              onBack={() => setVerification(null)}
              onVerified={() => {
                setVerification(null);
                setSuccessMessage("Email verified. The account owner can now sign in. Staff must change their temporary password on first login.");
                void refreshUsers(false);
                notifyAdminActionCountsChanged();
              }}
            />
          </div>
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
                    {barangays.map((barangay) => {
                      const occupied = barangayCaptainIds.has(Number(barangay.id));
                      return (
                        <option key={barangay.id} value={barangay.id} disabled={occupied}>
                          {barangay.name}{occupied ? " — Captain already assigned" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">
                  All active barangays are listed. Barangays with an assigned captain are disabled because only one captain account is allowed per barangay.
                </p>
                {availableCaptainBarangays.length === 0 && (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
                    All active barangays already have an assigned Barangay Captain.
                  </p>
                )}
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
                role. A 6-digit code will be sent to their email. The account stays
                pending until email verification, then requires a password change
                after the first login. The captain can also verify from the Sign In page.
              </div>

              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

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

      {viewedUser && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDetailsUser(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-details-title"
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">
                  LGU User Directory
                </p>
                <h2 id="user-details-title" className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">
                  Account Details
                </h2>
                <p className="mt-1 text-xs text-slate-500">Read-only account and assignment information</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsUser(null)}
                aria-label="Close account details"
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {viewedUser.profile_photo ? (
                <img
                  src={viewedUser.profile_photo}
                  alt={`${viewedUser.full_name}'s profile`}
                  className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <User className="h-7 w-7" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-base font-black text-slate-900">{viewedUser.full_name}</p>
                <p className="mt-0.5 text-xs font-bold text-emerald-700">{roleLabel(viewedUser.role)}</p>
                <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${statusClass(viewedUser.status)}`} />
                  {accountStatusLabel(viewedUser)}
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700">
                  <User className="h-4 w-4 text-emerald-600" /> Personal &amp; Contact Information
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Full name</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{viewedUser.full_name}</p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400"><Mail className="h-3 w-3" /> Email</p>
                    <p className="mt-1 break-all text-sm font-semibold text-slate-900">{viewedUser.email}</p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400"><Phone className="h-3 w-3" /> Mobile number</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{viewedUser.phone?.trim() || "Not provided"}</p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400"><MapPin className="h-3 w-3" /> Address</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{viewedUser.address?.trim() || "Not provided"}</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700">
                  <MapPin className="h-4 w-4 text-emerald-600" /> Official Assignment
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Barangay</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{viewedUser.barangay_name || "Not assigned"}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Purok</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {viewedUser.purok_name || (viewedUser.role === "collector" ? "Barangay-wide assignment" : "Not assigned")}
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Account Information
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">User ID</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{viewedUser.id}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Email verification</p>
                    <p className={`mt-1 text-sm font-semibold ${Boolean(Number(viewedUser.email_verified)) ? "text-emerald-700" : "text-amber-600"}`}>
                      {Boolean(Number(viewedUser.email_verified)) ? "Verified" : "Not verified"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
                    <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400"><CalendarDays className="h-3 w-3" /> Registered on</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatRegisteredDate(viewedUser.created_at)}</p>
                  </div>
                </div>
              </section>
            </div>
            <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setDetailsUser(null)}
                className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                Close Details
              </button>
            </div>
          </section>
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
        open={Boolean(deleteConfirmation)}
        title="Archive account?"
        description={deleteConfirmation ? (
          <>
            <p>
              Archive {deleteConfirmation.full_name} ({deleteConfirmation.email})?
              The account will disappear from normal user lists and can no longer sign in.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Historical records such as payments, complaints, inspections, endorsements, and audit history will remain linked to the original name.
            </p>
            {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 font-bold text-rose-700">{error}</p>}
          </>
        ) : ""}
        confirmLabel="Archive account"
        destructive
        busy={saving}
        onCancel={() => { if (!saving) setDeleteConfirmation(null); }}
        onConfirm={() => { if (deleteConfirmation) void deleteUser(deleteConfirmation); }}
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
