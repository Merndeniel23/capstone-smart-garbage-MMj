import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Users,
  Truck,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

interface SuperAdminDashboardProps {
  setCurrentScreen: (screen: any) => void;
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

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
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
      return "Garbage Collector";
    default:
      return "Civilian";
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
}: SuperAdminDashboardProps) {
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);

  const [users, setUsers] =
    useState<SystemUser[]>([]);

  const [barangays, setBarangays] =
    useState<Barangay[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");

  const [activities,setActivities]=useState<ActivityItem[]>([]);
  const [activityError,setActivityError]=useState("");


  const loadDashboard = async () => {
    setLoading(true);
    setError("");

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

      /*
       * These requests are optional while the dedicated
       * Super Admin backend routes are still being completed.
       * The dashboard remains usable even if one request fails.
       */
      const results =
        await Promise.allSettled([
          apiRequest("/admin/users"),
          apiRequest(
            "/auth/registration-locations",
          ),
          apiRequest("/admin/recent-activities"),
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
      }else{
        setActivities([]);
        setActivityError("Recent activities unavailable.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the Municipal Administrator dashboard.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
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

  const showComingSoon = (
    feature: string,
  ) => {
    setNotice(
      `${feature} UI is ready. Its dedicated Super Admin backend route is the next step.`,
    );

    window.setTimeout(
      () => setNotice(""),
      4500,
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-bold text-slate-500">
            Loading municipal control center...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">
            Municipality of Cordova
          </p>

          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            Municipal Administrator Dashboard
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Municipality-wide LGU account and barangay monitoring center
          </p>
        </div>

        <button
          type="button"
          onClick={loadDashboard}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">
            {error}
          </p>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">
            {notice}
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
              <ShieldCheck className="h-8 w-8 text-emerald-300" />
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                Logged-in Super Admin
              </p>

              <h2 className="mt-1 text-2xl font-black">
                {currentUser?.full_name ||
                  "Municipal System Administrator"}
              </h2>

              <p className="mt-1 text-sm text-slate-300">
                {currentUser?.email}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          label="Barangays"
          value={stats.barangays}
          icon={Building2}
        />

        <SummaryCard
          label="Captains"
          value={stats.captains}
          icon={UserCog}
        />

        <SummaryCard
          label="Leaders"
          value={stats.leaders}
          icon={Users}
        />

        <SummaryCard
          label="Collectors"
          value={stats.collectors}
          icon={Users}
        />

        <SummaryCard
          label="Residents"
          value={stats.residents}
          icon={Users}
        />

        <SummaryCard
          label="Active Users"
          value={stats.activeUsers}
          icon={ShieldCheck}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">
                Barangay Captain Accounts
              </h2>

              <p className="text-xs text-slate-500">
                Municipal-level account overview
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                showComingSoon(
                  "Create Barangay Captain",
                )
              }
              className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white"
            >
              Create Captain
            </button>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
            {captainAccounts.length ===
            0 ? (
              <div className="p-12 text-center">
                <UserCog className="mx-auto h-9 w-9 text-slate-300" />

                <p className="mt-3 font-black text-slate-700">
                  No captain accounts loaded
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  Captain records will appear after the dedicated Super Admin API is connected.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {captainAccounts.map(
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
                          onClick={() =>
                            showComingSoon(
                              `Manage ${captain.full_name}`,
                            )
                          }
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
        </section>

        <section className="space-y-4">
          <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">
              Municipal Controls
            </h2>

            <div className="mt-4 space-y-3">
              <ActionButton
                label="Manage Barangays"
                description="Activate and review barangays"
                icon={Building2}
                onClick={() =>
                  showComingSoon(
                    "Manage Barangays",
                  )
                }
              />

              <ActionButton
                label="Create Barangay Captain"
                description="Issue a secured captain account"
                icon={UserCog}
                onClick={() =>
                  showComingSoon(
                    "Create Barangay Captain",
                  )
                }
              />

              <ActionButton
                label="Truck & Crew Management"
                description="Register collection trucks, driver accounts, and crew"
                icon={Truck}
                onClick={() =>
                  setCurrentScreen(
                    "truck-crew-management",
                  )
                }
              />

              <ActionButton
                label="Password Recovery Center"
                description="Manage municipal account recovery"
                icon={KeyRound}
                onClick={() =>
                  showComingSoon(
                    "Recovery Center",
                  )
                }
              />

              <ActionButton
                label="View User Management"
                description="Open the current user directory"
                icon={Users}
                onClick={() =>
                  setCurrentScreen(
                    "user-management",
                  )
                }
              />
            </div>
          </div>

          
          <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">Recent Activity</h2>
            {activityError && <p className="mt-3 text-xs text-rose-600">{activityError}</p>}
            <div className="mt-4 space-y-3">
              {activities.length===0 ? (
                <p className="text-xs text-slate-500">No recent activity.</p>
              ) : activities.slice(0,6).map(a=>(
                <div key={a.activity_id} className="border-b border-slate-100 pb-2">
                  <p className="text-sm font-bold text-slate-800">{a.title}</p>
                  <p className="text-[10px] text-slate-500">{a.description}</p>
                  <p className="text-[10px] text-emerald-700">{a.barangay_name||""} {a.purok_name||""}</p>
                </div>
              ))}
            </div>
          </div>


          <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6">
            <div className="flex items-center gap-3">
              <KeyRound className="h-6 w-6 text-amber-600" />

              <div>
                <p className="text-sm font-black text-amber-900">
                  Recovery Security
                </p>

                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  Emergency code enabled
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
}: {
  label: string;
  value: number;
  icon: any;
}) {
  return (
    <div className="rounded-[1.7rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {label}
          </p>

          <p className="mt-2 text-3xl font-black text-slate-900">
            {value}
          </p>
        </div>

        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
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