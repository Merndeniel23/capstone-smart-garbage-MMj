import { apiFetch } from "../services/http";
import { Fragment, useEffect, useState } from "react";
import {
  Award,
  Bell,
  Building2,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  Map,
  MapPinned,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Truck,
  User,
  Users,
} from "lucide-react";
import {
  useAppState,
  type AppRole,
} from "../context/AppStateContext";
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";
import { useNotifications } from "../context/NotificationsContext";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout?: () => void;
  role: AppRole;
  adminActionCounts: AdminActionCounts;
  directoryRoleFilter?: string;
  onOpenDirectory?: (role: string) => void;
}

interface MenuItem {
  id: string;
  icon: any;
  label: string;
  count?: number;
  directoryRole?: string;
}

export default function Sidebar({
  activeTab,
  onTabChange,
  role,
  adminActionCounts,
  onOpenDirectory,
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

  const { notifications, enabled } = useNotifications();
  const unseenCount = notifications.filter(
    (item) => !Boolean(Number(item.is_seen)),
  ).length;
  const residentAccessRestricted = role === "household" && !enabled;
  const [revisions, setRevisions] = useState(false);
  const [phase1, setPhase1] = useState(false);
  useEffect(()=>{let active=true;void apiFetch("/api/sgms/config").then(res=>res.json()).then(data=>{if(active){setRevisions(data.enabled===true);setPhase1(data.phase1Enabled===true);}}).catch(()=>undefined);return()=>{active=false;};},[]);

  const {
    pendingPayments,
    pendingEndorsements,
    pendingCollectionTasks,
    unreadAccounts,
    unreadComplaints,
  } = adminActionCounts;

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
      count: unreadComplaints,
    },
    {
      id: "endorsements",
      icon: Award,
      label: "Barangay Endorsements",
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
      count: pendingCollectionTasks,
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Assigned Complaints",
      count: unreadComplaints,
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
      id: "schedule",
      icon: Calendar,
      label: "Collection Schedule",
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
      count: unreadComplaints,
    },
    {
      id: "endorsements",
      icon: Award,
      label: "Endorsements",
      count: pendingEndorsements,
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Verify Payments",
      count: pendingPayments,
    },
    {
      id: "schedule",
      icon: Calendar,
      label: "Collection Schedule",
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
      count: unreadAccounts,
    },
    {
      id: "complaints",
      icon: MessageSquare,
      label: "Complaints & Tickets",
      count: unreadComplaints,
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Ledger Audit",
      count: pendingPayments,
    },
    {
      id: "schedule",
      icon: Calendar,
      label: "Collection Schedule",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Notifications",
      count: unseenCount,
    },
    {
      id: "reports",
      icon: FileText,
      label: "Reports",
    },
    {
      id: "profile",
      icon: User,
      label: "Profile",
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
      icon: Users,
      label: "User Directory",
      directoryRole: "all",
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
      count: unreadComplaints,
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Payment Verification",
      count: pendingPayments,
    },
    {
      id: "schedule",
      icon: Calendar,
      label: "Collection Schedules",
    },
    {
      id: "notifications",
      icon: Bell,
      label: "Notifications",
      count: unseenCount,
    },
    {
      id: "reports",
      icon: FileText,
      label: "Reports",
    },
    {
      id: "profile",
      icon: User,
      label: "Profile",
    },
  ];


  const restrictedHouseholdItems =
    householdItems.filter(
      (item) => item.id === "profile",
    );

  const baseMenuItems =
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

  const additional: MenuItem[] = !revisions || residentAccessRestricted ? [] : [
    ...(["admin","leader","household"].includes(role) ? [{id:"households",icon:Users,label:role==="household"?"My Household":"Households"}] : []),
    ...(role==="admin" ? [{id:"puroks",icon:Building2,label:"Puroks"},{id:"endorsements",icon:Award,label:"Endorsements"},{id:"barangay-policies",icon:Shield,label:"Approved Policies & Templates"}] : []),
    ...(role!=="super_admin"&&(role!=="collector"||phase1) ? [{id:"collection-records",icon:ClipboardList,label:role==="collector"?"QR Collection & Records":"Collection Records"}] : []),
    ...(["admin","leader","household"].includes(role) ? [{id:"violations",icon:Shield,label:"Violations"}] : []),
    {id:"activity-logs",icon:FileText,label:"Activity Logs"},
    ...(role!=="collector" ? [{id:"payment-history",icon:CreditCard,label:"Payment History"}] : []),
    ...(["admin","leader","super_admin"].includes(role) ? [{id:"archives",icon:Building2,label:"Archives"}] : []),
    ...(role==="household" ? [{id:"online-payments",icon:CreditCard,label:"Pay Online"}] : []),
  ];
  const section = (id:string) => id.endsWith("dashboard")||id==="collector-tasks" ? "Overview" : ["user-management","puroks","households","members-list","garbage-bins","schedule","truck-crew-management"].includes(id) ? "Management" : ["collection-records","violations","complaints","payments","route-map","bin-inspections","online-payments"].includes(id) ? "Monitoring & Services" : ["endorsements","activity-logs","archives","reports","payment-history","collector-pickup-log"].includes(id) ? "Records" : "Settings";
  const sectionOrder=["Overview","Management","Monitoring & Services","Records","Settings"];
  const menuItems=[...baseMenuItems,...additional].sort((a,b)=>sectionOrder.indexOf(section(a.id))-sectionOrder.indexOf(section(b.id)));

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
        return "Resident";
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
      className={`sticky top-0 hidden h-screen min-h-0 shrink-0 flex-col self-start text-white shadow-xl transition-all duration-300 md:flex ${
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
        aria-label="Main navigation"
        className={`min-h-0 flex-1 space-y-1 overflow-y-auto pb-4 pt-4 ${
          collapsed
            ? "px-3"
            : "px-4"
        }`}
      >
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (<Fragment key={item.id}>
            {(index===0||section(menuItems[index-1].id)!==section(item.id))&&(!collapsed?<p className="px-4 pb-1 pt-4 text-[10px] font-black uppercase tracking-widest text-white/50">{section(item.id)}</p>:<hr className="my-3 border-white/15"/>)}
            <button
              key={item.id}
              type="button"
              title={
                collapsed
                  ? item.label
                  : undefined
              }
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => item.directoryRole && onOpenDirectory
                ? onOpenDirectory(item.directoryRole)
                : onTabChange(item.id)}
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
            </button></Fragment>
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
