import { useEffect, useState } from "react";
import {
  Award,
  Bell,
  Building2,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  KeyRound,
  LayoutDashboard,
  Map,
  MapPinned,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Truck,
  User,
  UserCog,
  Users,
} from "lucide-react";
import {
  useAppState,
  type AppRole,
} from "../context/AppStateContext";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout?: () => void;
  role: AppRole;
}

interface MenuItem {
  id: string;
  icon: any;
  label: string;
  count?: number;
}

export default function Sidebar({
  activeTab,
  onTabChange,
  role,
}: SidebarProps) {
  const {
    userProfile,
    currentUser,
  } = useAppState();

  const activeUser =
    currentUser || userProfile;

  const username =
    activeUser?.name ||
    "System User";

  const [unseenCount, setUnseenCount] =
    useState(0);

  const [collapsed, setCollapsed] =
    useState(
      () =>
        localStorage.getItem(
          "sg_sidebar_collapsed",
        ) === "true",
    );

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;

      localStorage.setItem(
        "sg_sidebar_collapsed",
        String(next),
      );

      return next;
    });
  };

  const loadNotificationBadge =
    async () => {
      const token =
        localStorage.getItem("token") ||
        sessionStorage.getItem("token") ||
        localStorage.getItem("authToken") ||
        sessionStorage.getItem("authToken") ||
        "";

      if (!token) {
        setUnseenCount(0);
        return;
      }

      try {
        const response = await fetch(
          "/api/notifications",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) {
          return;
        }

        const data = await response
          .json()
          .catch(() => ({}));

        const items = Array.isArray(
          data.notifications,
        )
          ? data.notifications
          : [];

        setUnseenCount(
          items.filter(
            (item: any) =>
              !Boolean(
                Number(item.is_seen),
              ),
          ).length,
        );
      } catch {
        // Keep the previous badge value if the
        // notification endpoint is temporarily unavailable.
      }
    };

  useEffect(() => {
    void loadNotificationBadge();

    const timer = window.setInterval(
      () => void loadNotificationBadge(),
      10000,
    );

    const clearSeenBadge = () =>
      setUnseenCount(0);

    const refreshBadge = () =>
      void loadNotificationBadge();

    window.addEventListener(
      "notifications-seen-all",
      clearSeenBadge,
    );

    window.addEventListener(
      "notifications-changed",
      refreshBadge,
    );

    return () => {
      window.clearInterval(timer);

      window.removeEventListener(
        "notifications-seen-all",
        clearSeenBadge,
      );

      window.removeEventListener(
        "notifications-changed",
        refreshBadge,
      );
    };
  }, []);

  const householdItems: MenuItem[] = [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      label: "Dashboard",
    },
    {
      id: "schedule",
      icon: Calendar,
      label: "Schedule",
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Complaints",
    },
    {
      id: "endorsements",
      icon: Award,
      label: "Endorsements",
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Payments",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Notifications",
      count: unseenCount,
    },
    {
      id: "profile",
      icon: User,
      label: "Profile",
    },
  ];

  const collectorItems: MenuItem[] = [
    {
      id: "collector-tasks",
      icon: ClipboardList,
      label: "Collection Tasks",
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Assigned Complaints",
    },
    {
      id: "route-map",
      icon: Map,
      label: "Route Map",
    },
    {
      id: "collector-pickup-log",
      icon: Truck,
      label: "Pickup Log",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Alerts",
      count: unseenCount,
    },
    {
      id: "profile",
      icon: User,
      label: "Profile",
    },
  ];

  const leaderItems: MenuItem[] = [
    {
      id: "leader-dashboard",
      icon: LayoutDashboard,
      label: "Leader Dashboard",
    },
    {
      id: "garbage-bins",
      icon: MapPinned,
      label: "Garbage Bins",
    },
    {
      id: "bin-inspections",
      icon: ClipboardCheck,
      label: "Bin Inspections",
    },
    {
      id: "members-list",
      icon: Users,
      label: "Purok Members",
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Complaints & Tickets",
    },
    {
      id: "endorsements",
      icon: Award,
      label: "Endorsements",
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Verify Payments",
    },
    {
      id: "schedule",
      icon: Calendar,
      label: "Waste Logs",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "System Alerts",
      count: unseenCount,
    },
    {
      id: "profile",
      icon: User,
      label: "Profile",
    },
  ];

  const adminItems: MenuItem[] = [
    {
      id: "admin-dashboard",
      icon: Shield,
      label: "Barangay Dashboard",
    },
    {
      id: "garbage-bins",
      icon: MapPinned,
      label: "Garbage Bins",
    },
    {
      id: "bin-inspections",
      icon: ClipboardCheck,
      label: "Inspection Records",
    },
    {
      id: "user-management",
      icon: Users,
      label: "Manage Users",
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Complaints & Tickets",
    },
    {
      id: "endorsements",
      icon: Award,
      label: "Endorsements",
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Ledger Audit",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Barangay Alerts",
      count: unseenCount,
    },
    {
      id: "reports",
      icon: FileText,
      label: "Reports",
    },
    {
      id: "profile",
      icon: Settings,
      label: "Control Center",
    },
  ];

  const superAdminItems: MenuItem[] = [
    {
      id: "super-admin-dashboard",
      icon: LayoutDashboard,
      label: "Municipal Dashboard",
    },
    {
      id: "user-management",
      icon: UserCog,
      label: "Barangay Captains",
    },
    {
      id: "members-list",
      icon: Users,
      label: "User Directory",
    },
    {
      id: "garbage-bins",
      icon: MapPinned,
      label: "Municipal Bins",
    },
    {
      id: "truck-crew-management",
      icon: Truck,
      label: "Truck & Crew",
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "All Complaints",
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Payment Verification",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Municipal Alerts",
      count: unseenCount,
    },
    {
      id: "reports",
      icon: FileText,
      label: "Reports",
    },
    {
      id: "profile",
      icon: KeyRound,
      label: "Recovery & Security",
    },
  ];

  const residentAccessRestricted =
    role === "household" &&
    (
      localStorage.getItem(
        "sg_requires_location_setup",
      ) === "true" ||
      localStorage.getItem(
        "sg_pending_approval",
      ) === "true"
    );

  const restrictedHouseholdItems =
    householdItems.filter(
      (item) => item.id === "profile",
    );

  const menuItems =
    role === "super_admin"
      ? superAdminItems
      : role === "admin"
        ? adminItems
        : role === "leader"
          ? leaderItems
          : role === "collector"
            ? collectorItems
            : residentAccessRestricted
              ? restrictedHouseholdItems
              : householdItems;

  const roleLabel = (() => {
    switch (role) {
      case "super_admin":
        return "Municipal Administrator";
      case "admin":
        return "Barangay Captain";
      case "leader":
        return "Purok Leader";
      case "collector":
        return "Garbage Collector";
      default:
        return "Civilian";
    }
  })();

  const RoleIcon =
    role === "super_admin"
      ? Building2
      : role === "admin"
        ? Shield
        : role === "leader"
          ? Award
          : role === "collector"
            ? Truck
            : User;

  return (
    <aside
      className={`sticky top-0 z-20 hidden h-screen shrink-0 flex-col text-white shadow-xl transition-all duration-300 md:flex ${
        collapsed
          ? "w-20"
          : "w-64"
      } bg-[#14532d] dark:bg-[#0b2a20]`}
    >
      <div
        className={`flex items-center border-b border-white/10 ${
          collapsed
            ? "justify-center p-3"
            : "justify-between gap-3 p-5"
        }`}
      >
        <div
          className={`flex min-w-0 items-center ${
            collapsed
              ? "justify-center"
              : "gap-3"
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 shadow-inner ring-1 ring-white/5 dark:bg-emerald-300/10">
            <RoleIcon className="h-5 w-5 text-emerald-100 dark:text-emerald-200" />
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300 dark:text-emerald-300/80">
                {roleLabel}
              </p>

              <p
                className="mt-0.5 max-w-[132px] truncate text-sm font-extrabold text-white"
                title={username}
              >
                {username}
              </p>
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center border-b border-white/10 py-3">
          <button
            type="button"
            onClick={toggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      <nav
        className={`flex-1 space-y-1 overflow-y-auto pb-4 pt-4 ${
          collapsed
            ? "px-3"
            : "px-4"
        }`}
      >
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              title={
                collapsed
                  ? item.label
                  : undefined
              }
              aria-label={item.label}
              onClick={() =>
                onTabChange(item.id)
              }
              className={`group relative flex w-full items-center rounded-xl py-3 transition-all duration-200 ${
                collapsed
                  ? "justify-center px-0"
                  : "gap-3 px-4"
              } ${
                isActive
                  ? "bg-white/15 font-semibold text-white ring-1 ring-white/10 dark:bg-emerald-300/10 dark:text-emerald-50 dark:ring-emerald-300/10"
                  : "text-white/70 hover:bg-white/5 hover:text-white dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-emerald-50"
              }`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 transition-transform duration-200 ${
                  isActive
                    ? "scale-110"
                    : "group-hover:scale-105"
                }`}
              />

              {!collapsed && (
                <span className="flex-1 text-left text-sm">
                  {item.label}
                </span>
              )}

              {Boolean(item.count) && (
                collapsed ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[8px] font-black text-white">
                    {(item.count ?? 0) > 9
                      ? "9+"
                      : (item.count ?? 0)}
                  </span>
                ) : (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {(item.count ?? 0) > 99
                      ? "99+"
                      : (item.count ?? 0)}
                  </span>
                )
              )}
            </button>
          );
        })}
      </nav>

      <div
        className={`border-t border-white/10 ${
          collapsed
            ? "p-3"
            : "px-5 py-4"
        }`}
      >
        {!collapsed ? (
          <p className="text-center text-[9px] font-bold uppercase tracking-[0.18em] text-white/35 dark:text-emerald-100/30">
            Smart Garbage Monitoring
          </p>
        ) : (
          <div className="mx-auto h-1.5 w-1.5 rounded-full bg-emerald-300/50" />
        )}
      </div>
    </aside>
  );
}