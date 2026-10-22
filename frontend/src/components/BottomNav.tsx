import type { AppRole } from "../context/AppStateContext";
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";
import { useNotifications } from "../context/NotificationsContext";
import { menuSections, useSgmsFlags } from "./navigation";

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  role: AppRole;
  adminActionCounts: AdminActionCounts;
}

export default function BottomNav({ activeTab, onTabChange, role, adminActionCounts }: BottomNavProps) {
  const { notifications, enabled } = useNotifications();
  const unseenCount = notifications.filter(
    (item) => !Boolean(Number(item.is_seen)),
  ).length;
  const { revisions } = useSgmsFlags();

  // Same order as the desktop sidebar, flattened for the scrolling mobile bar.
  const tabs = menuSections(
    role,
    { ...adminActionCounts, unseenNotifications: unseenCount },
    { revisions, residentRestricted: role === 'household' && !enabled },
  ).flatMap((section) => section.items);

  return (
    <nav aria-label="Mobile navigation" className="h-20 bg-white border-t border-slate-100 flex items-center gap-1 overflow-x-auto shrink-0 pb-2 px-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] w-full">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const count = tab.count ?? 0;

        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center gap-1 transition-all duration-300 shrink-0 min-w-[76px] cursor-pointer ${
              isActive ? 'text-emerald-500 scale-105' : 'text-slate-400'
            }`}
          >
            <div className={`p-2 rounded-2xl transition-all duration-300 relative ${
              isActive ? 'bg-emerald-50 text-emerald-600' : ''
            }`}>
              <Icon className="w-5.5 h-5.5" />
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full select-none">
                  {count > 99
                    ? "99+"
                    : count}
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
