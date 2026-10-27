import { useState } from "react";
import {
  Award,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Truck,
  User,
} from "lucide-react";
import {
  useAppState,
  type AppRole,
} from "../context/AppStateContext";
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";
import { useNotifications } from "../context/NotificationsContext";
import { menuSections, roleLabel, useSgmsFlags } from "./navigation";
import UserAvatar from "./UserAvatar";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout?: () => void;
  role: AppRole;
  adminActionCounts: AdminActionCounts;
}

export default function Sidebar({
  activeTab,
  onTabChange,
  role,
  adminActionCounts,
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
  const { revisions } = useSgmsFlags();

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

  const sections = menuSections(
    role,
    { ...adminActionCounts, unseenNotifications: unseenCount },
    { revisions, residentRestricted: role === "household" && !enabled },
  );

  const RoleIcon =
    role === "admin"
      ? Shield
      : role === "leader"
        ? Award
        : role === "collector"
          ? Truck
          : User;

  return (
    <aside
      className={`sticky top-0 hidden h-screen min-h-0 shrink-0 flex-col self-start text-white shadow-xl transition-all duration-300 lg:flex ${
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
          <UserAvatar tone="dark" className="h-11 w-11" />

          {!collapsed && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-200 dark:text-emerald-300/80">
                <RoleIcon className="h-3.5 w-3.5" />
                {roleLabel(role)}
              </p>

              <p
                className="mt-0.5 max-w-[132px] truncate text-sm font-semibold text-white"
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
        className={`min-h-0 flex-1 overflow-y-auto pb-4 pt-2 ${
          collapsed
            ? "px-3"
            : "px-4"
        }`}
      >
        {sections.map((section, sectionIndex) => (
          <div key={section.title} role="group" aria-label={section.title}>
            {collapsed ? (
              sectionIndex > 0 && <hr className="my-3 border-white/15" />
            ) : (
              <p className="px-3 pb-1 pt-4 text-[11px] font-semibold text-white/50">
                {section.title}
              </p>
            )}

            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

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
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onTabChange(item.id)}
                    className={`group relative flex w-full items-center rounded-xl py-2.5 transition-all duration-200 ${
                      collapsed
                        ? "justify-center px-0"
                        : "gap-3 px-3"
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
            </div>
          </div>
        ))}
      </nav>

      <div
        className={`border-t border-white/10 ${
          collapsed
            ? "p-3"
            : "px-5 py-4"
        }`}
      >
        {!collapsed ? (
          <p className="text-center text-[11px] font-medium text-white/40 dark:text-emerald-100/30">
            Smart Garbage Monitoring
          </p>
        ) : (
          <div className="mx-auto h-1.5 w-1.5 rounded-full bg-emerald-300/50" />
        )}
      </div>
    </aside>
  );
}
