import {
  Bell,
  Building2,
  CheckCheck,
  ChevronRight,
  LogOut,
  Moon,
  Shield,
  Sun,
  Truck,
  User,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { AppRole } from "../context/AppStateContext";
import { useNotifications } from "../context/NotificationsContext";
import { apiRequest } from "../services/api";
import type { NotificationItem } from "../services/notificationFeed";
import { linkedNotificationPage, type NotificationPage } from "./NotificationsPanel";

interface HeaderProps {
  activeTab: string;
  onLogout: () => void;
  userRole: AppRole;
  onRoleChange?: (
    role: AppRole,
  ) => void;
  onNavigate?: (page: NotificationPage | "notifications", relatedId?: number) => void;
  profilePhoto?: string | null;
  pageTitle?: string;
}

const THEME_STORAGE_KEY =
  "sg_theme";

function formatPageTitle(
  activeTab: string,
) {
  if (
    activeTab ===
    "super-admin-dashboard"
  ) {
    return "Municipal Dashboard";
  }

  if (
    activeTab ===
    "admin-dashboard"
  ) {
    return "Barangay Dashboard";
  }

  if (
    activeTab ===
    "leader-dashboard"
  ) {
    return "Purok Leader Dashboard";
  }

  if (
    activeTab ===
    "collector-tasks"
  ) {
    return "Collector Dashboard";
  }

  if (
    activeTab ===
    "members-list"
  ) {
    return "Purok Members";
  }

  return String(
    activeTab || "dashboard",
  )
    .split("-")
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

function getRoleLabel(
  role: AppRole,
) {
  switch (role) {
    case "super_admin":
      return "MUNICIPAL ADMINISTRATOR";
    case "admin":
      return "BARANGAY CAPTAIN";
    case "leader":
      return "PUROK LEADER";
    case "collector":
      return "GARBAGE COLLECTOR";
    default:
      return "RESIDENT";
  }
}

function getRoleIcon(
  role: AppRole,
) {
  switch (role) {
    case "super_admin":
      return Building2;
    case "admin":
      return Shield;
    case "collector":
      return Truck;
    default:
      return User;
  }
}

function readInitialDarkMode() {
  return (
    localStorage.getItem(
      THEME_STORAGE_KEY,
    ) === "dark"
  );
}

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export default function Header({
  activeTab,
  onLogout,
  userRole,
  onNavigate,
  profilePhoto,
  pageTitle,
}: HeaderProps) {
  const RoleIcon =
    getRoleIcon(userRole);

  const [isDarkMode, setIsDarkMode] =
    useState(readInitialDarkMode);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { notifications, update } = useNotifications();

  const unreadCount = notifications.filter((item) => !Boolean(Number(item.is_read))).length;
  const displayedNotifications = (
    notifFilter === "unread"
      ? notifications.filter((item) => !Boolean(Number(item.is_read)))
      : notifications
  ).slice(0, 12);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen]);

  const markItemRead = async (item: NotificationItem) => {
    if (Boolean(Number(item.is_read))) return;
    const nowIso = new Date().toISOString();
    update((current) =>
      current.map((n) =>
        n.id === item.id
          ? { ...n, is_seen: 1, seen_at: n.seen_at || nowIso, is_read: 1, read_at: nowIso }
          : n,
      ),
    );
    window.dispatchEvent(new Event("notifications-changed"));
    try {
      await apiRequest(`/notifications/${item.id}/read`, { method: "PATCH" });
    } catch {
      /* ignore background mark-read failure */
    }
  };

  const handleMarkAllRead = async () => {
    const nowIso = new Date().toISOString();
    update((current) =>
      current.map((n) => ({
        ...n,
        is_seen: 1,
        seen_at: n.seen_at || nowIso,
        is_read: 1,
        read_at: n.read_at || nowIso,
      })),
    );
    window.dispatchEvent(new Event("notifications-seen-all"));
    try {
      await apiRequest("/notifications/read-all", { method: "PATCH" });
    } catch {
      /* ignore */
    }
  };

  const handleNotificationClick = (item: NotificationItem) => {
    void markItemRead(item);
    setNotifOpen(false);
    const targetPage = linkedNotificationPage(item, userRole);
    const recordId = Number(item.related_entity_id);
    if (targetPage && onNavigate) {
      onNavigate(
        targetPage,
        Number.isSafeInteger(recordId) && recordId > 0 ? recordId : undefined,
      );
    } else if (onNavigate) {
      onNavigate("notifications");
    }
  };

  useEffect(() => {
    const root =
      document.documentElement;

    root.classList.toggle(
      "sg-dark",
      isDarkMode,
    );

    // Also expose the common "dark" class so any existing
    // Tailwind dark: utilities in the project can respond.
    root.classList.toggle(
      "dark",
      isDarkMode,
    );

    root.dataset.theme =
      isDarkMode
        ? "dark"
        : "light";

    root.style.colorScheme =
      isDarkMode
        ? "dark"
        : "light";

    localStorage.setItem(
      THEME_STORAGE_KEY,
      isDarkMode
        ? "dark"
        : "light",
    );
  }, [isDarkMode]);

  return (
      <header className={`sticky top-0 z-30 flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-6 ${userRole === "super_admin" ? "md:flex-wrap xl:flex-nowrap" : ""}`}>
        <div className="flex w-full items-center justify-between md:hidden">
          <h1 className="whitespace-nowrap text-base font-black text-slate-800">
            {pageTitle || formatPageTitle(
              activeTab,
            )}
          </h1>
        </div>

        <div className="hidden flex-1 md:block">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Smart Garbage Monitoring System
          </p>

          <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-800">
            {pageTitle || formatPageTitle(
              activeTab,
            )}
          </h2>
        </div>

        <div className="ml-auto flex w-full items-center justify-between gap-3 md:w-auto md:justify-end">
          {/* FACEBOOK-STYLE TOP NOTIFICATION BELL DROPDOWN */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label="Open notifications"
              aria-expanded={notifOpen}
              title="Notifications"
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all ${
                notifOpen
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white shadow-sm">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                role="dialog"
                aria-label="Notifications menu"
                className="fixed inset-x-3 top-16 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96"
              >
                <div className="border-b border-slate-100 px-4 pb-3 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-black text-slate-900">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleMarkAllRead()}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNotifFilter("all")}
                      className={`rounded-full px-3.5 py-1 text-xs font-black transition ${
                        notifFilter === "all"
                          ? "bg-emerald-100 text-emerald-800"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotifFilter("unread")}
                      className={`rounded-full px-3.5 py-1 text-xs font-black transition ${
                        notifFilter === "unread"
                          ? "bg-emerald-100 text-emerald-800"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 overflow-y-auto">
                  {displayedNotifications.length === 0 ? (
                    <div className="p-8 text-center">
                      <Bell className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-xs font-bold text-slate-500">
                        {notifFilter === "unread"
                          ? "No unread notifications."
                          : "No notifications yet."}
                      </p>
                    </div>
                  ) : (
                    displayedNotifications.map((item) => {
                      const isUnread = !Boolean(Number(item.is_read));
                      const destination = linkedNotificationPage(item, userRole);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNotificationClick(item)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                            isUnread ? "bg-emerald-50/50" : "bg-white"
                          }`}
                        >
                          <div
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                              isUnread
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <Bell className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-xs leading-snug ${
                                isUnread
                                  ? "font-black text-slate-900"
                                  : "font-semibold text-slate-700"
                              }`}
                            >
                              {item.title}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                              {item.message}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className={`text-[10px] font-bold ${
                                  isUnread ? "text-emerald-700" : "text-slate-400"
                                }`}
                              >
                                {formatTimeAgo(item.created_at)}
                              </span>
                              {destination && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700">
                                  · Open <ChevronRight className="h-3 w-3" />
                                </span>
                              )}
                            </div>
                          </div>
                          {isUnread && (
                            <span
                              aria-label="Unread"
                              className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600"
                            />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50 p-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      onNavigate?.("notifications");
                    }}
                    className="w-full rounded-xl py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100/60"
                  >
                    See all notifications
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              setIsDarkMode(
                (current) => !current,
              )
            }
            aria-label={
              isDarkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={
              isDarkMode
                ? "Light Mode"
                : "Dark Mode"
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            {isDarkMode ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-emerald-50 text-emerald-700">
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <RoleIcon className="h-4 w-4" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />

                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Account Active
                </span>
              </div>

              <p className="mt-0.5 text-xs font-black text-emerald-700">
                {getRoleLabel(
                  userRole,
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className={`flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-black text-slate-600 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 ${userRole === "super_admin" ? "shrink-0 whitespace-nowrap" : ""}`}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>
  );
}