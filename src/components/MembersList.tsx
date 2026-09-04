import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  User,
  UserRoundCheck,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
} from "motion/react";
import { apiRequest } from "../services/api";

type DirectoryStatus =
  | "active"
  | "pending"
  | "inactive";

type DirectoryMember = {
  id: number;
  name: string;
  email: string;
  phone: string;
  communalZone: string;
  address: string;
  householdId: string;
  status: DirectoryStatus;
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

function normalizePurok(
  value?: string | null,
) {
  const match = String(value || "")
    .match(/purok\s*\d+/i);

  return match
    ? match[0]
        .replace(/\s+/g, " ")
        .replace(/^purok/i, "Purok")
    : "";
}

function formatJoinedDate(
  value?: string,
) {
  if (!value) {
    return "Registration date unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
}

function statusLabel(
  status?: DirectoryStatus,
) {
  if (status === "inactive") {
    return "Inactive";
  }

  if (status === "pending") {
    return "Pending";
  }

  return "Active";
}

function statusClasses(
  status?: DirectoryStatus,
) {
  if (status === "inactive") {
    return "bg-rose-50 text-rose-600";
  }

  if (status === "pending") {
    return "bg-amber-50 text-amber-600";
  }

  return "bg-emerald-50 text-emerald-600";
}

function mapDatabaseUser(
  user: DatabaseUser,
): DirectoryMember {
  return {
    id: Number(user.id),
    name: String(
      user.full_name || "Unnamed user",
    ),
    email: String(user.email || ""),
    phone: String(user.phone || ""),
    communalZone: [
      user.purok_name,
      user.barangay_name,
    ]
      .filter(Boolean)
      .join(", "),
    address: String(user.address || ""),
    householdId:
      user.role === "resident"
        ? `HH-${String(user.id).padStart(4, "0")}`
        : `USR-${String(user.id).padStart(4, "0")}`,
    barangay:
      user.barangay_name || undefined,
    purok:
      user.purok_name || undefined,
    status:
      user.status === "inactive"
        ? "inactive"
        : user.status === "pending"
          ? "pending"
          : "active",
    profilePhoto: user.profile_photo || null,
    currentMonthContribution: Number(
      user.current_month_contribution || 0,
    ),
    previousMonthContribution: Number(
      user.previous_month_contribution || 0,
    ),
    previousMonthComplete:
      Boolean(Number(user.previous_month_complete)),
    createdAt:
      user.created_at || undefined,
  };
}

export default function MembersList() {
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);

  const [databaseMembers, setDatabaseMembers] =
    useState<DirectoryMember[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [searchTerm, setSearchTerm] =
    useState("");

  const [
    selectedMemberId,
    setSelectedMemberId,
  ] = useState<number | null>(null);

  const [statusFilter, setStatusFilter] =
    useState<
      "all" | DirectoryStatus
    >("all");

  const [memberPage, setMemberPage] =
    useState(1);

  const [deletingId, setDeletingId] =
    useState<number | null>(null);

  const [actionMessage, setActionMessage] =
    useState<{
      type: "success" | "error";
      text: string;
    } | null>(null);

  const canManageUsers =
    currentUser?.role === "admin" ||
    currentUser?.role === "super_admin";

  const isPurokLeader =
    currentUser?.role === "purok_leader";

  const leaderPurok = useMemo(
    () =>
      normalizePurok(
        currentUser?.purok_name,
      ),
    [currentUser?.purok_name],
  );

  const loadDatabaseMembers =
    useCallback(async () => {
      setLoading(true);
      setCurrentUser(null);
      setActionMessage(null);

      try {
        const profileData = await apiRequest<{
          success: boolean;
          user?: CurrentUser;
        }>("/auth/me");

        const profile = profileData.user;

        if (!profile) {
          throw new Error(
            "The signed-in account could not be loaded.",
          );
        }

        const canViewDirectory =
          profile.role === "admin" ||
          profile.role === "super_admin" ||
          profile.role === "purok_leader";

        if (!canViewDirectory) {
          throw new Error(
            "Administrator or Purok Leader access is required.",
          );
        }

        setCurrentUser(profile);

        const endpoint =
          profile.role === "purok_leader"
            ? "/admin/purok-members"
            : "/admin/users";

        const data = await apiRequest<{
          success: boolean;
          users?: DatabaseUser[];
        }>(endpoint);

        const rows = Array.isArray(
          data.users,
        )
          ? data.users
          : [];

        setDatabaseMembers(
          rows
            .filter(
              (user) =>
                user.role === "resident",
            )
            .map(mapDatabaseUser),
        );
        return true;
      } catch (error) {
        setDatabaseMembers([]);
        setActionMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Unable to load users.",
        });
        return false;
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadDatabaseMembers();
  }, [loadDatabaseMembers]);

  const members = useMemo(() => {
    const normalizedSearch =
      searchTerm.trim().toLowerCase();

    return databaseMembers
      .filter((member) => {
        if (statusFilter === "all") {
          return true;
        }

        return (
          member.status === statusFilter
        );
      })
      .filter((member) => {
        if (!normalizedSearch) {
          return true;
        }

        return [
          member.name,
          member.email,
          member.phone,
          member.householdId,
          member.address,
          member.purok,
          member.barangay,
          member.communalZone,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value)
              .toLowerCase()
              .includes(
                normalizedSearch,
              ),
          );
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name),
      );
  }, [
    databaseMembers,
    searchTerm,
    statusFilter,
  ]);

  const memberPageSize = 8;
  const memberPageCount = Math.max(
    1,
    Math.ceil(members.length / memberPageSize),
  );

  const visibleMembers = useMemo(() => {
    const safePage = Math.min(
      memberPage,
      memberPageCount,
    );
    const start =
      (safePage - 1) * memberPageSize;

    return members.slice(
      start,
      start + memberPageSize,
    );
  }, [
    members,
    memberPage,
    memberPageCount,
  ]);

  useEffect(() => {
    setMemberPage(1);
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    if (memberPage > memberPageCount) {
      setMemberPage(memberPageCount);
    }
  }, [memberPage, memberPageCount]);

  const selectedMember =
    members.find(
      (member) =>
        member.id === selectedMemberId,
    ) || null;

  const activeCount = members.filter(
    (member) =>
      member.status === "active",
  ).length;

  const directoryUnavailable =
    !loading &&
    actionMessage?.type === "error" &&
    databaseMembers.length === 0;

  const handleDeleteMember =
    async (
      member: DirectoryMember,
    ) => {
      if (!canManageUsers) {
        setActionMessage({
          type: "error",
          text:
            "Only an administrator can delete user accounts.",
        });
        return;
      }

      if (
        currentUser?.id === member.id
      ) {
        setActionMessage({
          type: "error",
          text:
            "You cannot delete your own account.",
        });
        return;
      }

      const confirmed =
        window.confirm(
          `Delete ${member.name}? This action cannot be undone.`,
        );

      if (!confirmed) {
        return;
      }

      setDeletingId(member.id);
      setActionMessage(null);

      try {
        const data = await apiRequest<{
          success: boolean;
          message?: string;
        }>(`/admin/users/${member.id}`, {
          method: "DELETE",
        });

        setSelectedMemberId(null);
        const refreshed =
          await loadDatabaseMembers();

        if (refreshed) {
          setActionMessage({
            type: "success",
            text:
              data.message ||
              "User deleted successfully.",
          });
        }
      } catch (error) {
        console.error(
          "DELETE ERROR:",
          error,
        );

        setActionMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Unable to delete the user.",
        });
      } finally {
        setDeletingId(null);
      }
    };

  return (
    <div className="space-y-6 pb-20 md:pb-0 animate-in fade-in slide-in-from-right-4 duration-500">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Household Directory
          </span>

          <h1 className="text-2xl font-black text-slate-900">
            Purok Members
          </h1>

          <p className="text-sm font-medium text-slate-500">
            View household accounts, contact details, and contribution status.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 md:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

            <input
              type="text"
              placeholder="Search name, ID, email, or phone"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value,
                )
              }
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as
                    | "all"
                    | DirectoryStatus,
                )
              }
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-9 text-sm font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:w-40"
            >
              <option value="all">
                All statuses
              </option>
              <option value="active">
                Active
              </option>
              <option value="pending">
                Pending
              </option>
              <option value="inactive">
                Inactive
              </option>
            </select>
          </div>

          {(canManageUsers || isPurokLeader) && (
            <button
              type="button"
              onClick={() =>
                void loadDatabaseMembers()
              }
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loading
                    ? "animate-spin"
                    : ""
                }`}
              />
              Refresh
            </button>
          )}
        </div>
      </header>

      {actionMessage && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            actionMessage.type ===
            "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[1.8rem] border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Members shown
          </p>
          <p className="mt-2 text-3xl font-black text-slate-900">
            {loading || directoryUnavailable
              ? "—"
              : members.length}
          </p>
        </div>

        <div className="rounded-[1.8rem] border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Active accounts
          </p>
          <p className="mt-2 text-3xl font-black text-emerald-600">
            {loading || directoryUnavailable
              ? "—"
              : activeCount}
          </p>
        </div>

        <div className="rounded-[1.8rem] border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Directory scope
          </p>
          <p className="mt-2 text-sm font-black text-slate-800">
            {loading
              ? "Loading scope..."
              : isPurokLeader
              ? leaderPurok ||
                "Assigned purok"
              : currentUser?.role ===
                  "super_admin"
                ? "All households"
                : currentUser?.barangay_name ||
                  "Assigned barangay"}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {!loading && !directoryUnavailable && members.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-500">
                Showing{" "}
                <span className="font-black text-slate-800">
                  {(memberPage - 1) * memberPageSize + 1}
                </span>
                {"–"}
                <span className="font-black text-slate-800">
                  {Math.min(
                    memberPage * memberPageSize,
                    members.length,
                  )}
                </span>{" "}
                of{" "}
                <span className="font-black text-slate-800">
                  {members.length}
                </span>{" "}
                members
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMemberPage((page) => Math.max(1, page - 1))}
                  disabled={memberPage === 1}
                  aria-label="Previous members page"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <span className="min-w-16 text-center text-xs font-black text-slate-600">
                  {memberPage} / {memberPageCount}
                </span>

                <button
                  type="button"
                  onClick={() => setMemberPage((page) => Math.min(memberPageCount, page + 1))}
                  disabled={memberPage === memberPageCount}
                  aria-label="Next members page"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-[2rem] border border-slate-100 bg-white">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
                <p className="mt-3 text-xs font-bold text-slate-500">
                  Loading household accounts...
                </p>
              </div>
            </div>
          ) : directoryUnavailable ? (
            <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-10 text-center">
              <ShieldAlert className="mx-auto h-10 w-10 text-rose-400" />
              <h3 className="mt-4 font-black text-rose-700">
                Directory unavailable
              </h3>
              <p className="mx-auto mt-2 max-w-md text-xs font-medium leading-relaxed text-rose-600">
                Household records could not be loaded from the database.
              </p>
              <button
                type="button"
                onClick={() => void loadDatabaseMembers()}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-5 py-3 text-xs font-black text-white transition hover:bg-rose-700"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : members.length > 0 ? (
            visibleMembers.map((member) => {
              const isSelected =
                selectedMemberId ===
                member.id;

              return (
                <motion.button
                  type="button"
                  key={member.id}
                  whileHover={{
                    scale: 1.005,
                  }}
                  onClick={() =>
                    setSelectedMemberId(
                      member.id,
                    )
                  }
                  className={`flex w-full items-center gap-5 rounded-[2rem] border bg-white p-5 text-left transition-all ${
                    isSelected
                      ? "border-emerald-500 shadow-lg shadow-emerald-500/5"
                      : "border-slate-100 shadow-sm hover:border-slate-200"
                  }`}
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-emerald-50">
                    {member.profilePhoto ? (
                      <img
                        src={member.profilePhoto}
                        alt={`${member.name} profile`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-7 w-7 text-emerald-600" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-black text-slate-900">
                        {member.name}
                      </h3>

                      <span className="text-[10px] font-black tracking-widest text-slate-400">
                        {member.householdId}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
                      {member.purok ||
                        normalizePurok(
                          member.communalZone,
                        ) ||
                        "No purok assigned"}
                      {" · "}
                      {member.barangay ||
                        "Barangay not specified"}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                        This month: ₱{member.currentMonthContribution.toFixed(2)}
                      </span>

                      <span
                        className={
                          member.previousMonthComplete
                            ? "rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700"
                            : "rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700"
                        }
                      >
                        Last month:{" "}
                        {member.previousMonthComplete
                          ? "Complete · ₱" + member.previousMonthContribution.toFixed(2)
                          : "Pending"}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${statusClasses(
                        member.status,
                      )}`}
                    >
                      {statusLabel(
                        member.status,
                      )}
                    </span>

                    <p className="mt-2 hidden text-[10px] font-bold text-slate-400 sm:block">
                      View profile
                    </p>
                  </div>
                </motion.button>
              );
            })
          ) : (
            <div className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/60 p-10 text-center">
              <UserRoundCheck className="mx-auto h-10 w-10 text-slate-300" />
              <h3 className="mt-4 font-black text-slate-700">
                No household members found
              </h3>
              <p className="mx-auto mt-2 max-w-md text-xs font-medium leading-relaxed text-slate-400">
                No registered household account matches the current filters.
              </p>
            </div>
          )}
        </div>

        <div className="xl:col-span-1">
          <AnimatePresence mode="wait">
            {selectedMember ? (
              <motion.aside
                key={selectedMember.id}
                initial={{
                  opacity: 0,
                  x: 20,
                }}
                animate={{
                  opacity: 1,
                  x: 0,
                }}
                exit={{
                  opacity: 0,
                  x: 20,
                }}
                className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm"
              >
                <div className="bg-slate-900 p-6 text-white">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-emerald-500/15">
                        {selectedMember.profilePhoto ? (
                          <img
                            src={selectedMember.profilePhoto}
                            alt={`${selectedMember.name} profile`}
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
                      <p className="text-[10px] font-black uppercase tracking-wider text-white/50">
                        {selectedMember.householdId}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-6">
                  <DetailRow
                    icon={Mail}
                    label="Email"
                    value={
                      selectedMember.email
                    }
                  />

                  <DetailRow
                    icon={Phone}
                    label="Phone"
                    value={
                      selectedMember.phone ||
                      "Not provided"
                    }
                  />

                  <DetailRow
                    icon={MapPin}
                    label="Physical Address"
                    value={
                      selectedMember.address ||
                      "Not provided"
                    }
                  />

                  <DetailRow
                    icon={MapPin}
                    label="Assigned Area"
                    value={[
                      selectedMember.purok ||
                        normalizePurok(
                          selectedMember.communalZone,
                        ),
                      selectedMember.barangay,
                    ]
                      .filter(Boolean)
                      .join(", ") ||
                      selectedMember.communalZone ||
                      "Not assigned"}
                  />

                  <DetailRow
                    icon={CalendarDays}
                    label="Registered"
                    value={formatJoinedDate(
                      selectedMember.createdAt,
                    )}
                  />

                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center gap-3">
                      {selectedMember.status ===
                      "active" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="h-5 w-5 text-amber-600" />
                      )}

                      <div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          Account Status
                        </p>
                        <p className="text-xs font-black text-slate-800">
                          {statusLabel(
                            selectedMember.status,
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-emerald-700">
                        This Month&apos;s Contribution
                      </p>
                      <p className="mt-1 text-xl font-black text-emerald-800">
                        ₱{selectedMember.currentMonthContribution.toFixed(2)}
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-emerald-700/80">
                        Completed weekly fees
                      </p>
                    </div>

                    <div
                      className={
                        selectedMember.previousMonthComplete
                          ? "rounded-2xl border border-blue-100 bg-blue-50 p-4"
                          : "rounded-2xl border border-amber-100 bg-amber-50 p-4"
                      }
                    >
                      <p
                        className={
                          selectedMember.previousMonthComplete
                            ? "text-[9px] font-black uppercase tracking-wider text-blue-700"
                            : "text-[9px] font-black uppercase tracking-wider text-amber-700"
                        }
                      >
                        Last Month
                      </p>
                      <p
                        className={
                          selectedMember.previousMonthComplete
                            ? "mt-1 text-xl font-black text-blue-800"
                            : "mt-1 text-xl font-black text-amber-800"
                        }
                      >
                        {selectedMember.previousMonthComplete
                          ? "Complete"
                          : "Pending"}
                      </p>
                      <p
                        className={
                          selectedMember.previousMonthComplete
                            ? "mt-1 text-[10px] font-bold text-blue-700/80"
                            : "mt-1 text-[10px] font-bold text-amber-700/80"
                        }
                      >
                        ₱{selectedMember.previousMonthContribution.toFixed(2)} recorded
                      </p>
                    </div>
                  </div>

                  {canManageUsers && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteMember(
                          selectedMember,
                        )
                      }
                      disabled={
                        deletingId ===
                        selectedMember.id
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId ===
                      selectedMember.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}

                      {deletingId ===
                      selectedMember.id
                        ? "Deleting..."
                        : "Delete User"}
                    </button>
                  )}
                </div>
              </motion.aside>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <User className="h-8 w-8 text-slate-200" />
                </div>
                <h4 className="mt-4 font-black text-slate-600">
                  No Member Selected
                </h4>
                <p className="mt-2 max-w-[220px] text-[11px] text-slate-400">
                  Click a household card to view its official account details.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
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
    <div className="flex gap-3 rounded-2xl border border-slate-100 p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />

      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
          {label}
        </p>

        <p className="mt-1 break-words text-xs font-bold text-slate-700">
          {value}
        </p>
      </div>
    </div>
  );
}
