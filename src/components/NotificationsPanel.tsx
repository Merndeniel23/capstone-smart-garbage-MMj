import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

interface NotificationsPanelProps {
  role:
    | "household"
    | "collector"
    | "leader"
    | "admin"
    | "super_admin";
}

type NotificationPriority =
  | "emergency"
  | "schedule"
  | "notice";

type NotificationItem = {
  id: number;
  recipient_user_id?: number | null;
  recipient_role?: string | null;
  barangay_id?: number | null;
  purok_id?: number | null;
  notification_type: string;
  priority: NotificationPriority;
  title: string;
  message: string;
  related_entity_type?: string | null;
  related_entity_id?: number | null;
  created_by?: number | null;
  created_by_name?: string | null;
  barangay_name?: string | null;
  purok_name?: string | null;
  is_seen: number | boolean;
  seen_at?: string | null;
  is_read: number | boolean;
  read_at?: string | null;
  created_at: string;
};

const NOTIFICATIONS_PER_PAGE = 10;

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

function normalizeRole(role: NotificationsPanelProps["role"]) {
  if (role === "household") return "resident";
  if (role === "leader") return "purok_leader";
  return role;
}

async function apiRequest(
  url: string,
  options: RequestInit = {},
) {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Login session is missing. Please log in again.",
    );
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

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

function formatDate(value?: string | null) {
  if (!value) return "No date";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function priorityStyle(
  priority: NotificationPriority,
) {
  if (priority === "emergency") {
    return {
      container:
        "border-rose-200 bg-rose-50",
      badge:
        "bg-rose-600 text-white",
      label: "Emergency",
    };
  }

  if (priority === "schedule") {
    return {
      container:
        "border-amber-200 bg-amber-50",
      badge:
        "bg-amber-600 text-white",
      label: "Schedule",
    };
  }

  return {
    container:
      "border-emerald-200 bg-emerald-50",
    badge:
      "bg-emerald-700 text-white",
    label: "Official Notice",
  };
}

export default function NotificationsPanel({
  role,
}: NotificationsPanelProps) {
  const normalizedRole = normalizeRole(role);

  const canBroadcast =
    normalizedRole === "super_admin" ||
    normalizedRole === "admin" ||
    normalizedRole === "purok_leader";

  const [notifications, setNotifications] =
    useState<NotificationItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  const [showCompose, setShowCompose] =
    useState(false);

  const [activeFilter, setActiveFilter] =
    useState<
      "all" | "unread" | "emergency"
    >("all");

  const [searchTerm, setSearchTerm] =
    useState("");

  const [visibleCount, setVisibleCount] =
    useState(NOTIFICATIONS_PER_PAGE);

  const [expandedNotificationId, setExpandedNotificationId] =
    useState<number | null>(null);

  const [notificationToDelete, setNotificationToDelete] =
    useState<NotificationItem | null>(null);

  const [deletingNotificationId, setDeletingNotificationId] =
    useState<number | null>(null);

  const [title, setTitle] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [priority, setPriority] =
    useState<NotificationPriority>(
      "notice",
    );

  const [recipientRole, setRecipientRole] =
    useState("");

  const loadNotifications = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest(
        "/api/notifications",
      );

      setNotifications(
        Array.isArray(data.notifications)
          ? data.notifications
          : [],
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load notifications.",
      );
    } finally {
      setLoading(false);
    }
  };

  const markAllSeen = async () => {
    try {
      await apiRequest(
        "/api/notifications/seen-all",
        {
          method: "PATCH",
        },
      );

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_seen: 1,
          seen_at:
            item.seen_at ||
            new Date().toISOString(),
        })),
      );

      // The sidebar/bottom-nav badge should disappear
      // once the notification center has been opened,
      // while unread items remain visually unread.
      window.dispatchEvent(
        new Event("notifications-seen-all"),
      );
    } catch {
      // Seeing notifications should never block
      // the notification center from opening.
    }
  };

  useEffect(() => {
    const refreshVisibleNotifications =
      async () => {
        await loadNotifications();
        await markAllSeen();
      };

    void refreshVisibleNotifications();

    const timer = window.setInterval(
      () =>
        void refreshVisibleNotifications(),
      10000,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const filterCounts = useMemo(
    () => ({
      all: notifications.length,
      unread: notifications.filter(
        (item) => !Boolean(Number(item.is_read)),
      ).length,
      emergency: notifications.filter(
        (item) => item.priority === "emergency",
      ).length,
    }),
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    const normalizedSearch =
      searchTerm.trim().toLocaleLowerCase();

    return notifications.filter((item) => {
      if (
        activeFilter === "unread" &&
        Boolean(Number(item.is_read))
      ) {
        return false;
      }

      if (
        activeFilter === "emergency" &&
        item.priority !== "emergency"
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      return [
        item.title,
        item.message,
        item.created_by_name || "",
        item.barangay_name || "",
        item.purok_name || "",
        item.recipient_role || "",
        item.notification_type,
        `notif-${item.id}`,
      ].some((value) =>
        value
          .toLocaleLowerCase()
          .includes(normalizedSearch),
      );
    });
  }, [
    activeFilter,
    notifications,
    searchTerm,
  ]);

  useEffect(() => {
    setVisibleCount(NOTIFICATIONS_PER_PAGE);
  }, [activeFilter, searchTerm]);

  const visibleNotifications =
    filteredNotifications.slice(0, visibleCount);

  const unreadCount = filterCounts.unread;

  const notificationFilters: Array<{
    id: typeof activeFilter;
    label: string;
    count: number;
  }> = [
    {
      id: "all",
      label: "All alerts",
      count: filterCounts.all,
    },
    {
      id: "unread",
      label: "Unread",
      count: filterCounts.unread,
    },
    {
      id: "emergency",
      label: "Emergency",
      count: filterCounts.emergency,
    },
  ];

  const hasMoreNotifications =
    visibleNotifications.length <
    filteredNotifications.length;

  const unreadEmergency =
    notifications.find(
      (item) =>
        item.priority === "emergency" &&
        !Boolean(Number(item.is_read)),
    ) || null;

  const submitBroadcast = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    if (!title.trim() || !message.trim()) {
      setError(
        "Title and message are required.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const data = await apiRequest(
        "/api/notifications",
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            message: message.trim(),
            priority,
            notificationType:
              priority === "emergency"
                ? "emergency_broadcast"
                : priority === "schedule"
                  ? "schedule_update"
                  : "official_notice",
            recipientRole:
              recipientRole || null,
          }),
        },
      );

      setSuccessMessage(
        data.message ||
          "Notification broadcast successfully.",
      );

      setTitle("");
      setMessage("");
      setPriority("notice");
      setRecipientRole("");
      setShowCompose(false);

      await loadNotifications();

      window.dispatchEvent(
        new Event("notifications-changed"),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to broadcast notification.",
      );
    } finally {
      setSaving(false);
    }
  };

  const markRead = async (
    notificationId: number,
  ) => {
    setError("");

    try {
      await apiRequest(
        `/api/notifications/${notificationId}/read`,
        {
          method: "PATCH",
        },
      );

      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId
            ? {
                ...item,
                is_seen: 1,
                seen_at:
                  item.seen_at ||
                  new Date().toISOString(),
                is_read: 1,
                read_at:
                  new Date().toISOString(),
              }
            : item,
        ),
      );

      window.dispatchEvent(
        new Event("notifications-changed"),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to mark notification as read.",
      );
    }
  };

  const markAllRead = async () => {
    setError("");

    try {
      const data = await apiRequest(
        "/api/notifications/read-all",
        {
          method: "PATCH",
        },
      );

      setSuccessMessage(
        data.message ||
          "All notifications marked as read.",
      );

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_seen: 1,
          seen_at:
            item.seen_at ||
            new Date().toISOString(),
          is_read: 1,
          read_at:
            item.read_at ||
            new Date().toISOString(),
        })),
      );

      window.dispatchEvent(
        new Event("notifications-seen-all"),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to mark notifications as read.",
      );
    }
  };

  const deleteNotification = async (
    notificationId: number,
  ) => {
    setError("");
    setDeletingNotificationId(notificationId);

    try {
      await apiRequest(
        `/api/notifications/${notificationId}`,
        {
          method: "DELETE",
        },
      );

      setNotifications((current) =>
        current.filter(
          (item) =>
            item.id !== notificationId,
        ),
      );
      setExpandedNotificationId((current) =>
        current === notificationId
          ? null
          : current,
      );
      setNotificationToDelete(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to delete notification.",
      );
      setNotificationToDelete(null);
    } finally {
      setDeletingNotificationId(null);
    }
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            <Megaphone className="h-4 w-4" />
            Real-Time Notification Center
          </div>

          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-3xl">
            System Alerts & Notices
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            {unreadCount} unread notification
            {unreadCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void loadNotifications()
            }
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading
                  ? "animate-spin"
                  : ""
              }`}
            />
            Refresh
          </button>

          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={() =>
              void markAllRead()
            }
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark all read
          </button>

          {canBroadcast && (
            <button
              type="button"
              onClick={() =>
                setShowCompose(true)
              }
              className="flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-3 text-xs font-black uppercase text-white transition hover:bg-emerald-800"
            >
              <Plus className="h-4 w-4" />
              Broadcast
            </button>
          )}
        </div>
      </header>

      {unreadEmergency && (
        <div className="rounded-2xl bg-gradient-to-r from-rose-700 to-red-600 p-4 text-white shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <span className="absolute inset-0 animate-ping rounded-xl bg-white/10" />
                <AlertTriangle className="relative h-5 w-5" />
              </span>

              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-100">
                  Active emergency alert
                </p>

                <h2 className="mt-0.5 truncate text-base font-black sm:text-lg">
                  {unreadEmergency.title}
                </h2>

                <p className="mt-1 line-clamp-2 text-sm font-semibold text-white/90">
                  {unreadEmergency.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                void markRead(
                  unreadEmergency.id,
                )
              }
              className="h-10 shrink-0 rounded-xl bg-white px-4 text-xs font-black uppercase text-rose-700 transition hover:bg-rose-50"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700"
        >
          {successMessage}
        </div>
      )}

      <section
        aria-label="Notification filters"
        className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
            {notificationFilters.map(
              ({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={activeFilter === id}
                  onClick={() =>
                    setActiveFilter(id)
                  }
                  className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-black transition ${
                    activeFilter === id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                  <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {count}
                  </span>
                </button>
              ),
            )}
          </div>

          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              aria-label="Search notifications"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
              placeholder="Search alerts, sender, or area"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() =>
                  setSearchTerm("")
                }
                className="absolute right-2 top-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Clear notification search"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      <section
        aria-label="Notifications"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold text-slate-500">
            Showing {visibleNotifications.length} of{" "}
            {filteredNotifications.length} matching alert
            {filteredNotifications.length === 1
              ? ""
              : "s"}
          </p>

          {loading && notifications.length > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating
            </span>
          )}
        </div>
        {loading &&
          notifications.length === 0 && (
            <div className="p-10 text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-700" />
              <p className="mt-3 text-sm font-bold text-slate-500">
                Loading notifications...
              </p>
            </div>
          )}

        {!loading &&
          filteredNotifications.length ===
            0 && (
            <div className="p-10 text-center">
              <Bell className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 font-black text-slate-700">
                {searchTerm || activeFilter !== "all"
                  ? "No notifications match the selected filters."
                  : "No notifications found."}
              </p>
              {(searchTerm ||
                activeFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setActiveFilter("all");
                  }}
                  className="mt-3 text-xs font-black uppercase text-emerald-700 hover:text-emerald-800"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

        <div className="divide-y divide-slate-100">
        {visibleNotifications.map(
          (item) => {
            const style =
              priorityStyle(
                item.priority,
              );

            const isRead =
              Boolean(
                Number(item.is_read),
              );

            const isExpanded =
              expandedNotificationId === item.id;

            return (
              <article
                key={item.id}
                className={`relative border-l-4 p-4 transition-colors ${style.container}`}
              >
                {!isRead && (
                  <span
                    className="absolute left-2 top-3 h-2 w-2 rounded-full bg-emerald-500"
                    aria-label="Unread notification"
                    title="Unread notification"
                  >
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400" />
                  </span>
                )}

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0 pl-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-lg px-2.5 py-1 text-[9px] font-black uppercase ${style.badge}`}
                      >
                        {style.label}
                      </span>

                      <span className="text-[10px] font-bold text-slate-400">
                        NOTIF-{item.id}
                      </span>
                    </div>

                    <h2 className="mt-2 truncate text-sm font-black text-slate-900 sm:text-base">
                      {item.title}
                    </h2>

                    <p
                      id={`notification-details-${item.id}`}
                      className={`mt-1 text-sm leading-relaxed text-slate-600 ${
                        isExpanded
                          ? ""
                          : "line-clamp-2"
                      }`}
                    >
                      {item.message}
                    </p>

                    <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Issued by{" "}
                      {item.created_by_name ||
                        "System"}
                      {" • "}
                      {formatDate(
                        item.created_at,
                      )}
                    </p>

                    {(item.barangay_name ||
                      item.purok_name) && (
                      <p className="mt-1 text-[10px] font-bold uppercase text-emerald-700">
                        {[
                          item.purok_name,
                          item.barangay_name,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 md:justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedNotificationId((current) =>
                          current === item.id
                            ? null
                            : item.id,
                        )
                      }
                      aria-expanded={isExpanded}
                      aria-controls={`notification-details-${item.id}`}
                      aria-label={`${
                        isExpanded ? "Hide" : "Show"
                      } notification details`}
                      title={`${
                        isExpanded ? "Hide" : "Show"
                      } details`}
                      className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black uppercase text-slate-600 transition hover:bg-slate-50"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      Details
                    </button>

                    {!isRead && (
                      <button
                        type="button"
                        onClick={() =>
                          void markRead(
                            item.id,
                          )
                        }
                        className="flex h-9 items-center gap-1 rounded-lg bg-white px-2.5 text-[10px] font-black uppercase text-emerald-700 shadow-sm transition hover:bg-emerald-50"
                        title="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                        Read
                      </button>
                    )}

                    {canBroadcast && (
                      <button
                        type="button"
                        onClick={() =>
                          setNotificationToDelete(item)
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm transition hover:bg-rose-50"
                        aria-label={`Delete notification ${item.title}`}
                        title="Delete notification"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          },
        )}
        </div>

        {hasMoreNotifications && (
          <div className="flex flex-col items-center gap-2 border-t border-slate-100 p-3 sm:flex-row sm:justify-between">
            <p className="text-xs text-slate-500">
              {filteredNotifications.length -
                visibleNotifications.length} more alert
              {filteredNotifications.length -
                visibleNotifications.length ===
              1
                ? ""
                : "s"}
            </p>
            <button
              type="button"
              onClick={() =>
                setVisibleCount((current) =>
                  current + NOTIFICATIONS_PER_PAGE,
                )
              }
              className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase text-slate-700 transition hover:bg-slate-50"
            >
              <ChevronDown className="h-4 w-4" />
              Load 10 more
            </button>
          </div>
        )}
      </section>

      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                  Authorized Broadcast
                </p>

                <h2 className="mt-1 text-xl font-black text-slate-900">
                  Create notification
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowCompose(false)
                }
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close notification form"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={submitBroadcast}
              className="mt-5 space-y-3"
            >
              <label className="block text-xs font-bold text-slate-600">
                Title
                <input
                  required
                  value={title}
                  onChange={(event) =>
                    setTitle(
                      event.target.value,
                    )
                  }
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white"
                  placeholder="Notification title"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-600">
                Priority
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(
                      event.target
                        .value as NotificationPriority,
                    )
                  }
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500"
                >
                  <option value="notice">
                    Official Notice
                  </option>
                  <option value="schedule">
                    Schedule Update
                  </option>
                  <option value="emergency">
                    Emergency
                  </option>
                </select>
              </label>

              <label className="block text-xs font-bold text-slate-600">
                Recipient Role
                <select
                  value={recipientRole}
                  onChange={(event) =>
                    setRecipientRole(
                      event.target.value,
                    )
                  }
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500"
                >
                  <option value="">
                    Everyone in allowed area
                  </option>
                  <option value="resident">
                    Residents
                  </option>
                  <option value="collector">
                    Garbage Collectors
                  </option>
                  <option value="purok_leader">
                    Purok Leaders
                  </option>
                  <option value="admin">
                    Barangay Captains
                  </option>
                </select>
              </label>
              </div>

              <label className="block text-xs font-bold text-slate-600">
                Message
                <textarea
                  required
                  rows={4}
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value,
                    )
                  }
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white"
                  placeholder="Write the notification message..."
                />
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowCompose(false)
                  }
                  disabled={saving}
                  className="h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Broadcast
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(notificationToDelete)}
        title="Delete notification?"
        description={
          notificationToDelete
            ? `Delete “${notificationToDelete.title}”? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete notification"
        destructive
        busy={
          deletingNotificationId ===
          notificationToDelete?.id
        }
        onCancel={() => {
          if (!deletingNotificationId) {
            setNotificationToDelete(null);
          }
        }}
        onConfirm={() => {
          if (notificationToDelete) {
            void deleteNotification(
              notificationToDelete.id,
            );
          }
        }}
      />
    </div>
  );
}
