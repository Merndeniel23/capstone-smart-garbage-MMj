import { useEffect, useState } from "react";
import { ClipboardCheck, LayoutDashboard, Calendar, User, Bell, Map, ClipboardList, Shield, Users, Award, CreditCard, MessageSquare } from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  role: 'household' | 'collector' | 'leader' | 'admin';
}

export default function BottomNav({ activeTab, onTabChange, role }: BottomNavProps) {
  const [unseenCount, setUnseenCount] =
    useState(0);

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
    { id: 'complaints', icon: MessageSquare, label: 'Complaints' },
    { id: 'payments', icon: CreditCard, label: 'Payments' },
    { id: 'notifications', icon: Bell, label: 'Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const collectorTabs = [
    { id: 'collector-tasks', icon: ClipboardList, label: 'Tasks' },
    { id: 'route-map', icon: Map, label: 'Route Map' },
    { id: 'schedule', icon: Calendar, label: 'Pickup Log' },
    { id: 'notifications', icon: Bell, label: 'Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const leaderTabs = [
    { id: 'leader-dashboard', icon: LayoutDashboard, label: 'Leader HUD' },
    { id: 'bin-inspections', icon: ClipboardCheck, label: 'Inspect Bins' },
    { id: 'members-list', icon: Users, label: 'Purok Members' },
    { id: 'endorsements', icon: Award, label: 'Endorsements' },
    { id: 'payments', icon: CreditCard, label: 'Verify Payments' },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints' },
    { id: 'schedule', icon: Calendar, label: 'Waste Logs' },
    { id: 'notifications', icon: Bell, label: 'System Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  const adminTabs = [
    { id: 'admin-dashboard', icon: Shield, label: 'Admin Panel' },
    { id: 'bin-inspections', icon: ClipboardCheck, label: 'Inspections' },
    { id: 'user-management', icon: Users, label: 'Manage Users' },
    { id: 'endorsements', icon: Award, label: 'Endorsements' },
    { id: 'payments', icon: CreditCard, label: 'Ledger Audit' },
    { id: 'complaints', icon: MessageSquare, label: 'Complaints' },
    { id: 'route-map', icon: Map, label: 'Global Map' },
    { id: 'notifications', icon: Bell, label: 'Global Alerts', count: unseenCount },
    { id: 'profile', icon: User, label: 'Control Center' },
  ];

  const residentAccessRestricted =
    role === 'household' &&
    (
      localStorage.getItem('sg_requires_location_setup') === 'true' ||
      localStorage.getItem('sg_pending_approval') === 'true'
    );

  const restrictedHouseholdTabs =
    householdTabs.filter((tab) => tab.id === 'profile');

  const tabs =
    role === 'collector'
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
