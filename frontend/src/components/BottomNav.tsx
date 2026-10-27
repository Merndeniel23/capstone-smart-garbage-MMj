import { useEffect } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { useAppState, type AppRole } from "../context/AppStateContext";
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";
import { useNotifications } from "../context/NotificationsContext";
import { menuSections, roleLabel, useSgmsFlags, type MenuItem } from "./navigation";
import UserAvatar from "./UserAvatar";

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  role: AppRole;
  adminActionCounts: AdminActionCounts;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onLogout?: () => void;
}

// Four primary destinations per role with short bar labels; every other link
// lives in the Menu drawer, which mirrors the desktop sidebar.
const PRIMARY_TABS: Partial<Record<AppRole, [string, string][]>> = {
  household: [["dashboard", "Home"], ["schedule", "Schedule"], ["payments", "Pay"], ["complaints", "Complaints"]],
  admin: [["admin-dashboard", "Home"], ["user-management", "Users"], ["complaints", "Complaints"], ["activity-logs", "Logs"]],
  leader: [["leader-dashboard", "Home"], ["members-list", "Members"], ["complaints", "Complaints"], ["endorsements", "Endorse"]],
  collector: [["collector-tasks", "Home"], ["collection-records", "Scan"], ["route-map", "Map"], ["schedule", "Schedule"]],
};

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function BottomNav({ activeTab, onTabChange, role, adminActionCounts, menuOpen, onMenuOpenChange, onLogout }: BottomNavProps) {
  const { userProfile, currentUser } = useAppState();
  const { notifications, enabled } = useNotifications();
  const unseenCount = notifications.filter(
    (item) => !Boolean(Number(item.is_seen)),
  ).length;
  const { revisions } = useSgmsFlags();

  const sections = menuSections(
    role,
    { ...adminActionCounts, unseenNotifications: unseenCount },
    { revisions, residentRestricted: role === "household" && !enabled },
  );
  const allItems = sections.flatMap((section) => section.items);
  const primary = (PRIMARY_TABS[role] || [])
    .map(([id, shortLabel]) => {
      const item = allItems.find((entry) => entry.id === id);
      return item ? { ...item, shortLabel } : null;
    })
    .filter((item): item is MenuItem & { shortLabel: string } => item !== null);
  const primaryIds = new Set(primary.map((item) => item.id));
  const menuActive = !primaryIds.has(activeTab);
  const menuCount = allItems
    .filter((item) => !primaryIds.has(item.id))
    .reduce((total, item) => total + (item.count ?? 0), 0);
  const username = userProfile.name || currentUser?.name || "System User";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMenuOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, onMenuOpenChange]);

  const go = (id: string) => {
    onMenuOpenChange(false);
    onTabChange(id);
  };

  const slotClass = (active: boolean) =>
    `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
      active ? "text-emerald-700" : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 gap-1 border-t border-slate-200 bg-white px-2 pb-[env(safe-area-inset-bottom)]"
      >
        {primary.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => go(tab.id)}
              className={slotClass(isActive)}
            >
              <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${isActive ? "bg-emerald-50" : ""}`}>
                <Icon className="h-5 w-5" />
                <Badge count={tab.count ?? 0} />
              </span>
              <span className="max-w-full truncate">{tab.shortLabel}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => onMenuOpenChange(true)}
          className={`${slotClass(menuActive)} col-start-5`}
        >
          <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${menuActive ? "bg-emerald-50" : ""}`}>
            <Menu className="h-5 w-5" />
            <Badge count={menuCount} />
          </span>
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => onMenuOpenChange(false)}
            className="absolute inset-0 bg-slate-950/50"
          />
          <aside className="relative flex h-full w-[min(18rem,85vw)] flex-col bg-[#14532d] text-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar tone="dark" className="h-10 w-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{username}</p>
                  <p className="text-[11px] font-medium text-emerald-200">{roleLabel(role)}</p>
                </div>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Close menu"
                onClick={() => onMenuOpenChange(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav aria-label="All pages" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {sections.map((section) => (
                <div key={section.title} role="group" aria-label={section.title}>
                  <p className="px-3 pb-1 pt-4 text-[11px] font-semibold text-white/50">{section.title}</p>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => go(item.id)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                            isActive ? "bg-white/15 font-semibold text-white" : "text-white/75 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {Boolean(item.count) && (
                            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {(item.count ?? 0) > 99 ? "99+" : item.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {onLogout && (
              <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => {
                    onMenuOpenChange(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/80 hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-5 w-5" />
                  Sign out
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
