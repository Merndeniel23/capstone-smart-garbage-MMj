import {
  AlertTriangle,
  Building2,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Users,
  Truck,
  CalendarDays,
  MessageSquare,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

interface SuperAdminDashboardProps {
  setCurrentScreen: (screen: any) => void;
  onOpenDirectory: (role?: string, status?: string, createCaptain?: boolean) => void;
}

interface CollectionSchedule {
  id: number;
  barangay_name: string;
  day_of_week: string;
  start_time: string;
  end_time?: string | null;
  notes?: string | null;
  is_active: number | boolean;
}

interface CurrentUser {
  id: number;
  full_name: string;
  email: string;
  recovery_email?: string | null;
  role: string;
  status: string;
  must_change_password?: number | boolean;
}

interface Barangay {
  id: number;
  name: string;
  is_active?: number | boolean;
}

interface ActivityItem {
  activity_id:string;
  activity_type:string;
  title:string;
  description:string;
  barangay_name?:string|null;
  purok_name?:string|null;
  activity_date:string;
}

interface SystemUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  status: string;
  barangay_id?: number | null;
  barangay_name?: string | null;
  purok_name?: string | null;
}

const API_BASE = "/api";
const DASHBOARD_PREVIEW_LIMIT = 5;

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
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

function roleLabel(role: string) {
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

function statusClass(status: string) {
  return status === "active"
    ? "bg-emerald-100 text-emerald-700"
    : status === "pending"
      ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";
}

export default function SuperAdminDashboard({
  setCurrentScreen,
  onOpenDirectory,
}: SuperAdminDashboardProps) {
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);

  const [users, setUsers] =
    useState<SystemUser[]>([]);

  const [barangays, setBarangays] =
    useState<Barangay[]>([]);

  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [activities,setActivities]=useState<ActivityItem[]>([]);
  const [activityError,setActivityError]=useState("");
  const [usersAvailable, setUsersAvailable] = useState(false);
  const [barangaysAvailable, setBarangaysAvailable] = useState(false);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<CollectionSchedule[] | null>(null);
  const [binsNeedingCollection, setBinsNeedingCollection] = useState<number | null>(null);
  const [openComplaints, setOpenComplaints] = useState<number | null>(null);
  const [activeTrucks, setActiveTrucks] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);


  const loadDashboard = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");
    setActivityError("");
    setDataWarnings([]);

    if (!isRefresh) {
      setUsers([]);
      setBarangays([]);
      setActivities([]);
      setUsersAvailable(false);
      setBarangaysAvailable(false);
      setSchedules(null);
      setBinsNeedingCollection(null);
      setOpenComplaints(null);
      setActiveTrucks(null);
    }

    try {
      const profileData =
        await apiRequest("/auth/me");

      const profile =
        profileData.user as CurrentUser;

      if (
        profile?.role !==
        "super_admin"
      ) {
        throw new Error(
          "Municipal Administrator access is required.",
        );
      }

      setCurrentUser(profile);

      const results =
        await Promise.allSettled([
          apiRequest("/admin/users"),
          apiRequest(
            "/auth/registration-locations",
          ),
          apiRequest("/admin/recent-activities"),
          apiRequest("/collection-schedules"),
          apiRequest("/garbage-bins"),
          apiRequest("/complaints"),
          apiRequest("/admin/truck-crews"),
        ]);

      const userResult = results[0];
      const locationResult =
        results[1];
      const activityResult =
        results[2];

      if (
        userResult.status ===
        "fulfilled"
      ) {
        setUsersAvailable(true);
        setUsers(
          Array.isArray(
            userResult.value.users,
          )
            ? userResult.value.users
            : [],
        );
      } else {
        setUsers([]);
      }

      if (
        locationResult.status ===
        "fulfilled"
      ) {
        setBarangaysAvailable(true);
        setBarangays(
          Array.isArray(
            locationResult.value
              .barangays,
          )
            ? locationResult.value
                .barangays
            : [],
        );
      } else {
        setBarangays([]);
      }

      if (activityResult.status==="fulfilled"){
        setActivities(Array.isArray(activityResult.value.activities)?activityResult.value.activities:[]);
        if (activityResult.value.unavailableSources?.length) {
          setActivityError("Some recent activity sources are unavailable. Showing the records that could be loaded.");
        }
      }else{
        setActivities([]);
        setActivityError("Recent activities unavailable.");
      }

      const [scheduleResult, binResult, complaintResult, truckResult] = results.slice(3);
      if (scheduleResult.status === "fulfilled" && Array.isArray(scheduleResult.value.schedules)) {
        setSchedules(scheduleResult.value.schedules.filter((schedule: CollectionSchedule) => Number(schedule.is_active) === 1));
      }
      if (binResult.status === "fulfilled" && Array.isArray(binResult.value.bins)) {
        const uniqueBins = new Map<number, any>(binResult.value.bins.map((bin: any) => [Number(bin.id), bin]));
        setBinsNeedingCollection([...uniqueBins.values()].filter((bin) => Number(bin.is_active) === 1 && (["full", "overflowing", "overflow"].includes(String(bin.current_status).toLowerCase()) || Number(bin.is_scheduled_today) === 1)).length);
      }
      if (complaintResult.status === "fulfilled" && Array.isArray(complaintResult.value.complaints)) {
        setOpenComplaints(complaintResult.value.complaints.filter((complaint: { status: string }) => !["resolved", "cancelled"].includes(complaint.status)).length);
      }
      if (truckResult.status === "fulfilled" && Array.isArray(truckResult.value.trucks)) {
        setActiveTrucks(truckResult.value.trucks.filter((truck: { status: string }) => truck.status === "active").length);
      }
      const labels = ["System accounts", "Barangays", "Recent activity", "Collection schedules", "Bins", "Complaints", "Truck fleet"];
      setDataWarnings(results.flatMap((result, index) => result.status === "rejected" ? [labels[index]] : []));
      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the Municipal Administrator dashboard.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const stats = useMemo(() => {
    return {
      barangays:
        barangays.length,
      captains: users.filter(
        (user) =>
          user.role === "admin",
      ).length,
      leaders: users.filter(
        (user) =>
          user.role ===
          "purok_leader",
      ).length,
      collectors: users.filter(
        (user) =>
          user.role ===
          "collector",
      ).length,
      residents: users.filter(
        (user) =>
          user.role ===
          "resident",
      ).length,
      activeUsers: users.filter(
        (user) =>
          user.status === "active",
      ).length,
    };
  }, [users, barangays]);

  const captainAccounts =
    useMemo(
      () =>
        users.filter(
          (user) =>
            user.role === "admin",
        ),
      [users],
    );

  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todaysSchedules = schedules?.filter((schedule) => schedule.day_of_week === todayName) ?? [];
  const captainPreview = captainAccounts.slice(0, DASHBOARD_PREVIEW_LIMIT);
  const todaysSchedulePreview = todaysSchedules.slice(0, DASHBOARD_PREVIEW_LIMIT);
  const activityPreview = activities.slice(0, DASHBOARD_PREVIEW_LIMIT);
  const formatTime = (value: string) => {
    if (!value) return "Time not provided";
    const [hours, minutes] = value.split(":");
    const hour = Number(hours);
    return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? "PM" : "AM"}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="text-center" role="status" aria-live="polite">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-bold text-slate-500">
            Loading municipal control center...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sg-page space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">
            Municipality of Cordova
          </p>

          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            Municipal Dashboard
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Monitor collections, respond to issues, and manage municipal accounts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDashboard(true)}
          disabled={refreshing}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">
            {error}
          </p>
        </div>
      )}

      {dataWarnings.length > 0 && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Some data could not be loaded: {dataWarnings.join(", ")}. Refresh to try again. Any retained totals may be from the previous refresh.</div>}

      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 p-5 text-white shadow-xl md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
              <ShieldCheck className="h-6 w-6 text-emerald-300" />
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                Municipal Administrator
              </p>

              <h2 className="mt-1 text-xl font-black">
                {currentUser?.full_name ||
                  "Municipal System Administrator"}
              </h2>

              <p className="mt-1 text-sm text-slate-300">
                {currentUser?.email}
              </p>
            </div>
          </div>

          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Account Status
            </p>

            <p className="mt-1 text-sm font-black text-emerald-300">
              {currentUser?.status ===
              "active"
                ? "ACTIVE & SECURED"
                : currentUser?.status?.toUpperCase()}
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-6">
        <SummaryCard
          label="Barangays"
          value={barangaysAvailable ? stats.barangays : null}
          icon={Building2}
          onClick={() => onOpenDirectory("admin")}
        />

        <SummaryCard
          label="Captains"
          value={usersAvailable ? stats.captains : null}
          icon={UserCog}
          onClick={() => onOpenDirectory("admin")}
        />

        <SummaryCard
          label="Leaders"
          value={usersAvailable ? stats.leaders : null}
          icon={Users}
          onClick={() => onOpenDirectory("purok_leader")}
        />

        <SummaryCard
          label="Collectors"
          value={usersAvailable ? stats.collectors : null}
          icon={Users}
          onClick={() => onOpenDirectory("collector")}
        />

        <SummaryCard
          label="Residents"
          value={usersAvailable ? stats.residents : null}
          icon={Users}
          onClick={() => onOpenDirectory("resident")}
        />

        <SummaryCard
          label="Active Users"
          value={usersAvailable ? stats.activeUsers : null}
          icon={ShieldCheck}
          onClick={() => onOpenDirectory("all", "active")}
        />
      </section>

      <section aria-labelledby="operations-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="operations-title" className="text-xl font-black text-slate-900">Operations at a glance</h2><p className="mt-1 text-xs text-slate-500">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p></div>
          {lastUpdated && <p className="text-xs text-slate-500">Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Today's Schedules" value={schedules ? todaysSchedules.length : null} icon={CalendarDays} onClick={() => setCurrentScreen("schedule")} />
          <SummaryCard label="Bins Needing Collection" value={binsNeedingCollection} icon={Trash2} onClick={() => setCurrentScreen("garbage-bins")} />
          <SummaryCard label="Open Complaints" value={openComplaints} icon={MessageSquare} onClick={() => setCurrentScreen("complaints")} />
          <SummaryCard label="Active Trucks" value={activeTrucks} icon={Truck} onClick={() => setCurrentScreen("truck-crew-management")} />
        </div>
        <p className="text-xs text-slate-500">Bins needing collection include active bins that are full, overflowing, or scheduled today. Open complaints include completed work awaiting resolution.</p>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-slate-900">Today's Collections</h2><p className="mt-1 text-xs text-slate-500">{todaysSchedules.length} published window{todaysSchedules.length === 1 ? "" : "s"}</p></div><button type="button" onClick={() => setCurrentScreen("schedule")} className="min-h-11 text-sm font-bold text-emerald-700">View schedule →</button></div>
            <p className="mt-1 text-xs text-slate-500">Recurring collection windows for {todayName}. These are scheduled windows, not confirmation of completed pickups.</p>
            {!schedules ? <p className="mt-4 text-sm text-slate-500">Collection schedules are unavailable. Refresh to try again.</p> : todaysSchedules.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No collections scheduled for today.</p> : <><ul className="mt-4 divide-y divide-slate-100">{todaysSchedulePreview.map((schedule) => <li key={schedule.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-900">{schedule.barangay_name}</p>{schedule.notes && <p className="mt-1 max-w-md truncate text-xs text-slate-500">{schedule.notes}</p>}</div><span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{formatTime(schedule.start_time)}{schedule.end_time ? ` – ${formatTime(schedule.end_time)}` : ""}</span></li>)}</ul>{todaysSchedules.length > DASHBOARD_PREVIEW_LIMIT && <button type="button" onClick={() => setCurrentScreen("schedule")} className="mt-3 text-xs font-bold text-emerald-700">View all {todaysSchedules.length} collection windows →</button>}</>}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900">
                Barangay Captain Accounts
              </h2>

              <p className="text-xs text-slate-500">
                {captainAccounts.length} account{captainAccounts.length === 1 ? "" : "s"} across the municipality
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenDirectory("admin")}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-slate-700"
              >
                View Directory
              </button>
              <button
                type="button"
                onClick={() => onOpenDirectory("admin", "all", true)}
                className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white"
              >
                Create Captain
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
            {captainAccounts.length ===
            0 ? (
              <div className="p-12 text-center">
                <UserCog className="mx-auto h-9 w-9 text-slate-300" />

                <p className="mt-3 font-black text-slate-700">
                  {usersAvailable ? "No captain accounts yet" : "Captain accounts unavailable"}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {usersAvailable ? "Create a captain account to assign a barangay." : "Refresh to try loading account records again."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {captainPreview.map(
                  (captain) => (
                    <article
                      key={captain.id}
                      className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                          <UserCog className="h-5 w-5" />
                        </div>

                        <div>
                          <h3 className="font-black text-slate-900">
                            {captain.full_name}
                          </h3>

                          <p className="text-xs text-slate-500">
                            {captain.email}
                          </p>

                          <p className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                            <MapPin className="h-3 w-3" />
                            {captain.barangay_name ||
                              "No barangay assigned"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${statusClass(
                            captain.status,
                          )}`}
                        >
                          {captain.status}
                        </span>

                        <button
                          type="button"
                          onClick={() => onOpenDirectory("admin")}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700"
                        >
                          Manage
                        </button>
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}
          </div>
          {captainAccounts.length > DASHBOARD_PREVIEW_LIMIT && (
            <button
              type="button"
              onClick={() => onOpenDirectory("admin")}
              className="text-xs font-bold text-emerald-700"
            >
              View all {captainAccounts.length} captain accounts →
            </button>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">
              Quick Actions
            </h2>

            <div className="mt-4 space-y-3">
              <ActionButton
                label="Barangays & Captains"
                description="Review locations and captain assignments"
                icon={Building2}
                onClick={() => onOpenDirectory("admin")}
              />

              <ActionButton
                label="Create Barangay Captain"
                description="Issue a secured captain account"
                icon={UserCog}
                onClick={() => onOpenDirectory("admin", "all", true)}
              />

              <ActionButton
                label="Register Truck & Crew"
                description="Register collection trucks, driver accounts, and crew"
                icon={Truck}
                onClick={() =>
                  setCurrentScreen(
                    "truck-crew-management",
                  )
                }
              />

              <ActionButton label="View Complaints" description="Review and assign open complaints" icon={MessageSquare} onClick={() => setCurrentScreen("complaints")} />
              <ActionButton label="View Collection Schedule" description="Monitor barangay collection windows" icon={CalendarDays} onClick={() => setCurrentScreen("schedule")} />
              <ActionButton label="View Municipal Bins" description="Locate bins that need collection" icon={Trash2} onClick={() => setCurrentScreen("garbage-bins")} />

              <ActionButton
                label="Account Security"
                description="Review your profile and recovery email"
                icon={KeyRound}
                onClick={() => setCurrentScreen("profile")}
              />

              <ActionButton
                label="View User Directory"
                description="Open the current user directory"
                icon={Users}
                onClick={() => onOpenDirectory()}
              />
            </div>
          </div>

          
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">Recent Activity</h2>
            {activityError && <p className="mt-3 text-xs text-rose-600">{activityError}</p>}
            <div className="mt-4 space-y-3">
              {!activityError && activities.length===0 ? (
                <p className="text-xs text-slate-500">No recent activity.</p>
              ) : activityPreview.map(a=>(
                <div key={a.activity_id} className="border-b border-slate-100 pb-2">
                  <p className="text-sm font-bold text-slate-800">{a.title}</p>
                  <p className="text-[10px] text-slate-500">{a.description}</p>
                  <p className="text-[10px] text-emerald-700">{a.barangay_name||""} {a.purok_name||""}</p>
                  <time dateTime={a.activity_date} className="mt-1 block text-xs text-slate-500">{new Date(a.activity_date).toLocaleString()}</time>
                </div>
              ))}
            </div>
          </div>


          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-3">
              <KeyRound className="h-6 w-6 text-amber-600" />

              <div>
                <p className="text-sm font-black text-amber-900">
                  Recovery Security
                </p>

                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  Account recovery
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-amber-800">
              Keep the printed emergency recovery code offline and accessible only to authorized Municipal IT personnel.
            </p>
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
  onClick,
}: {
  label: string;
  value: number | null;
  icon: any;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md md:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {label}
          </p>

          <p className="mt-1 text-2xl font-black text-slate-900 md:text-3xl">
            {value ?? <span aria-label="Data unavailable">—</span>}
          </p>
        </div>

        <div className="shrink-0 rounded-xl bg-emerald-50 p-2 text-emerald-700">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <span className="mt-2 flex items-center gap-1 text-[11px] font-bold text-emerald-700">Open <ArrowUpRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}

function ActionButton({
  label,
  description,
  icon: Icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: any;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:bg-slate-100"
    >
      <div className="rounded-xl bg-white p-2 text-emerald-700 shadow-sm">
        <Icon className="h-5 w-5" />
      </div>

      <div>
        <p className="text-sm font-black text-slate-800">
          {label}
        </p>

        <p className="text-[10px] text-slate-500">
          {description}
        </p>
      </div>
    </button>
  );
}
