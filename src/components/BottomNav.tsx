import { useEffect, useState } from "react";
import { ClipboardCheck, LayoutDashboard, Calendar, User, Bell, Map, ClipboardList, Shield, Users, Award, CreditCard, MessageSquare, FileText, Truck, MapPinned, UserCog } from 'lucide-react';
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  role: 'household' | 'collector' | 'leader' | 'admin' | 'super_admin';
  adminActionCounts: AdminActionCounts;
}

export default function BottomNav({ activeTab, onTabChange, role, adminActionCounts }: BottomNavProps) {
  const [unseenCount, setUnseenCount] =
    useState(0);

  const {
    pendingPayments,
    pendingEndorsements,
    pendingCollectionTasks,
    unreadAccounts,
    unreadComplaints,
  } = adminActionCounts;

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

        if (!response.ok) return;

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
        // Keep the last known count.
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

  const householdTabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'schedule', icon: Calendar, label: 'Schedule' },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints', count: unreadComplaints },
    { id: 'endorsements', icon: Award, label: 'Endorsements' },
    { id: 'payments', icon: CreditCard, label: 'Payments' },
    { id: 'notifications', icon: Bell, label: 'Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const collectorTabs = [
    { id: 'collector-tasks', icon: ClipboardList, label: 'Tasks', count: pendingCollectionTasks },
    { id: 'route-map', icon: Map, label: 'Route Map' },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints', count: unreadComplaints },
    { id: 'collector-pickup-log', icon: Truck, label: 'Pickup Log' },
    { id: 'schedule', icon: Calendar, label: 'Schedule' },
    { id: 'notifications', icon: Bell, label: 'Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const leaderTabs = [
    { id: 'leader-dashboard', icon: LayoutDashboard, label: 'Leader HUD' },
    { id: 'garbage-bins', icon: MapPinned, label: 'Garbage Bins' },
    { id: 'bin-inspections', icon: ClipboardCheck, label: 'Inspect Bins' },
    { id: 'members-list', icon: Users, label: 'Purok Members' },
    { id: 'payments', icon: CreditCard, label: 'Verify Payments', count: pendingPayments },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints', count: unreadComplaints },
    { id: 'schedule', icon: Calendar, label: 'Schedule' },
    { id: 'notifications', icon: Bell, label: 'System Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const adminTabs = [
    { id: 'admin-dashboard', icon: Shield, label: 'Admin Panel' },
    { id: 'garbage-bins', icon: MapPinned, label: 'Garbage Bins' },
    { id: 'bin-inspections', icon: ClipboardCheck, label: 'Inspections' },
    { id: 'user-management', icon: Users, label: 'Manage Users', count: unreadAccounts },
    { id: 'payments', icon: CreditCard, label: 'Ledger Audit', count: pendingPayments },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints', count: unreadComplaints },
    { id: 'endorsements', icon: Award, label: 'Endorsements', count: pendingEndorsements },
    { id: 'route-map', icon: Map, label: 'Global Map' },
    { id: 'schedule', icon: Calendar, label: 'Schedule' },
    { id: 'notifications', icon: Bell, label: 'Global Alerts', count: unseenCount },
    { id: 'reports', icon: FileText, label: 'Reports' },
    { id: 'profile', icon: User, label: 'Control Center' },
  ];

  const superAdminTabs = [
    { id: 'super-admin-dashboard', icon: LayoutDashboard, label: 'Municipal' },
    { id: 'user-management', icon: UserCog, label: 'Captains', count: unreadAccounts },
    { id: 'members-list', icon: Users, label: 'Directory' },
    { id: 'garbage-bins', icon: MapPinned, label: 'Bins' },
    { id: 'truck-crew-management', icon: Truck, label: 'Truck & Crew' },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints', count: unreadComplaints },
    { id: 'payments', icon: CreditCard, label: 'Payments', count: pendingPayments },
    { id: 'schedule', icon: Calendar, label: 'Schedules' },
    { id: 'notifications', icon: Bell, label: 'Alerts', count: unseenCount },
    { id: 'reports', icon: FileText, label: 'Reports' },
    { id: 'profile', icon: User, label: 'Security' },
  ];

  const residentAccessRestricted =
    role === 'household' &&
    (
      localStorage.getItem('sg_requires_location_setup') === 'true' ||
      sessionStorage.getItem('sg_requires_location_setup') === 'true' ||
      localStorage.getItem('sg_pending_approval') === 'true' ||
      sessionStorage.getItem('sg_pending_approval') === 'true'
    );

  const restrictedHouseholdTabs =
    householdTabs.filter((tab) => tab.id === 'profile');

  const tabs =
    role === 'super_admin'
      ? superAdminTabs
      : role === 'collector'
      ? collectorTabs
      : role === 'leader'
        ? leaderTabs
        : role === 'admin'
          ? adminTabs
          : residentAccessRestricted
            ? restrictedHouseholdTabs
            : householdTabs;

  return (
    <nav className="h-20 bg-white border-t border-slate-100 flex items-center gap-1 overflow-x-auto shrink-0 pb-2 px-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] w-full">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center gap-1 transition-all duration-300 shrink-0 min-w-[76px] cursor-pointer focus:outline-none ${
              isActive ? 'text-emerald-500 scale-105' : 'text-slate-400'
            }`}
          >
            <div className={`p-2 rounded-2xl transition-all duration-300 relative ${
              isActive ? 'bg-emerald-50 text-emerald-600' : ''
            }`}>
              <Icon className="w-5.5 h-5.5" />
              {tab.count && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full select-none">
                  {tab.count > 99
                    ? "99+"
                    : tab.count}
                </span>
              )}
            </div>
            <span className={`text-[9px] font-bold tracking-tight transition-all duration-300 ${
              isActive ? 'opacity-100 font-extrabold text-emerald-600' : 'text-slate-450'
            }`}>
              {tab.label}
            </span>
            {isActive && (
              <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
