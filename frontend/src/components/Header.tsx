import {
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Sun,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { useAppState, type AppRole } from "../context/AppStateContext";
import { useNotifications } from "../context/NotificationsContext";
import { menuSections, roleLabel, useSgmsFlags } from "./navigation";
import UserAvatar from "./UserAvatar";
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
  /** @deprecated The avatar now reads the shared app state (see UserAvatar). */
  profilePhoto?: string | null;
  pageTitle?: string;
  /** Opens the mobile navigation drawer. */
  onOpenMenu?: () => void;
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
  pageTitle,
  onOpenMenu,
}: HeaderProps) {
  const [isDarkMode, setIsDarkMode] =
    useState(readInitialDarkMode);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const { notifications, update, enabled } = useNotifications();
  const { userProfile, currentUser } = useAppState();
  const { revisions } = useSgmsFlags();
  const username = userProfile.name || currentUser?.name || "System User";
  const title = pageTitle || formatPageTitle(activeTab);
  // Breadcrumb section comes from the same hierarchy as the sidebar (counts are irrelevant here).
  const section = menuSections(
    userRole,
    { unseenNotifications: 0 } as Parameters<typeof menuSections>[1],
    { revisions, residentRestricted: userRole === "household" && !enabled },
  ).find((group) => group.items.some((item) => item.id === activeTab));
  const sectionTitle = section && section.title !== "Overview" ? section.title : null;

  useEffect(() => {
    if (!accountOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountOpen]);

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
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 lg:h-16 lg:px-6">
        {/* Mobile: [Menu + Title]. The page's own <h1> stays the only heading. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-base font-semibold text-slate-800">{title}</p>
        </div>

        {/* Desktop: subtle breadcrumb instead of a second page title. */}
        <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 lg:block">
          <ol className="flex items-center gap-1.5 text-sm text-slate-500">
            <li>Smart Garbage Monitoring</li>
            {sectionTitle && (
              <>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-slate-400" /></li>
                <li>{sectionTitle}</li>
              </>
            )}
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-slate-400" /></li>
            <li aria-current="page" className="truncate font-medium text-slate-800">{title}</li>
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          {/* FACEBOOK-STYLE TOP NOTIFICATION BELL DROPDOWN */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setNotifOpen((prev) => !prev);
              }}
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
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 lg:flex"
          >
            {isDarkMode ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <div className="hidden items-center gap-3 lg:flex">
            <UserAvatar className="h-9 w-9" />

            <div>
              <p className="max-w-[160px] truncate text-sm font-semibold text-slate-800" title={username}>
                {username}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                {roleLabel(userRole)} · Active
              </p>
            </div>
          </div>

          {/* Mobile: avatar dropdown holds status, theme toggle and sign out. */}
          <div ref={accountRef} className="relative lg:hidden">
            <button
              type="button"
              onClick={() => {
                setNotifOpen(false);
                setAccountOpen((open) => !open);
              }}
              aria-label="Open account menu"
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className="flex h-10 items-center gap-1 rounded-full pl-0.5 pr-1.5 text-slate-500 hover:bg-slate-100"
            >
              <UserAvatar className="h-9 w-9" />
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            {accountOpen && (
              <div role="menu" aria-label="Account menu" className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-center gap-3 border-b border-slate-100 p-4">
                  <UserAvatar className="h-10 w-10" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{username}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                      Account active · {roleLabel(userRole)}
                    </p>
                  </div>
                </div>
                <div className="p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setIsDarkMode((current) => !current)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {isDarkMode ? "Light mode" : "Dark mode"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      onLogout();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="hidden shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 lg:flex"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </header>
  );
}