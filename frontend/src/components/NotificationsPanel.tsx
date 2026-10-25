import { apiFetch } from "../services/http";
import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { portalOverlays } from './PortalOverlays';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
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
import { useNotifications } from "../context/NotificationsContext";
import type { NotificationItem } from "../services/notificationFeed";

export type NotificationPage =
  | "complaints"
  | "collection-records"
  | "violations"
  | "payments"
  | "members-list"
  | "endorsements"
  | "user-management"
  | "collector-tasks"
  | "bin-inspections"
  | "garbage-bins"
  | "schedule";

interface NotificationsPanelProps {
  role:
    | "household"
    | "collector"
    | "leader"
    | "admin"
    | "super_admin";
  onNavigate?: (page: NotificationPage, relatedId?: number) => void;
}

type NotificationPriority =
  | "emergency"
  | "schedule"
  | "notice";

const NOTIFICATIONS_PER_PAGE = 10;

// Use actual backend relationship fields where provided. An ordinary broadcast
// without a linked record is intentionally not given a fictitious destination.
export function linkedNotificationPage(
  item: NotificationItem,
  role: NotificationsPanelProps["role"],
): NotificationPage | null {
  const entity = String(item.related_entity_type || "")
    .trim().toLowerCase().replaceAll("-", "_");
  const type = String(item.notification_type || "")
    .trim().toLowerCase().replaceAll("-", "_");
  const normalizedRole = normalizeRole(role);
  const isManager = normalizedRole === "admin" || normalizedRole === "super_admin";
  const isLeader = normalizedRole === "purok_leader";
  const isResident = normalizedRole === "resident";
  const isCollector = normalizedRole === "collector";
  if(entity==="household_collection"||type==="collection_result")return normalizedRole==="super_admin"?null:isLeader?"members-list":"collection-records";
  if(entity==="household_violation"||type==="violation")return isCollector?null:"violations";

  if (entity === "complaint" || ["new_complaint", "complaint_update", "complaint_message"].includes(type)) {
    return "complaints";
  }
  if (["payment", "payment_record", "remittance"].includes(entity) ||
      ["payment_submission", "payment_update", "payment_verification", "payment_reminder"].includes(type)) {
    // The Purok Leader verifies payments in one place only: Purok Members.
    return isCollector ? null : isLeader ? "members-list" : "payments";
  }
  if (["endorsement", "endorsement_request"].includes(entity) || type.startsWith("endorsement_")) {
    return (isResident || isLeader || normalizedRole === "admin")
      ? "endorsements"
      : null;
  }
  if (["user_account", "user_registration"].includes(entity) || type === "account_approval_request") {
    return isManager ? "user-management" : null;
  }
  if (["collection_schedule", "schedule"].includes(entity) ||
      ["schedule_update", "collection_schedule_update"].includes(type)) {
    return "schedule";
  }
  if (["bin_inspection", "inspection"].includes(entity)) {
    return (isLeader || normalizedRole === "admin") ? "bin-inspections" : null;
  }
  if (["garbage_bin", "bin"].includes(entity)) {
    return (isManager || isLeader) ? "garbage-bins" : null;
  }
  if (["collection_request", "collection_run"].includes(entity)) {
    return isCollector ? "collector-tasks" :
      isLeader ? "bin-inspections" :
      isManager ? "garbage-bins" : null;
  }
  return null;
}

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

class NotificationRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "NotificationRequestError";
  }
}

async function apiRequest(
  url: string,
  options: RequestInit = {},
) {
  const token = getToken();

  if (!token) {
    throw new NotificationRequestError(
      "Login session is missing. Please log in again.",
      401,
    );
  }

  const response = await apiFetch(url, {
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
    throw new NotificationRequestError(
      data.message || "Request failed.",
      response.status,
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
  onNavigate,
}: NotificationsPanelProps) {
  const normalizedRole = normalizeRole(role);

  const canBroadcast =
    normalizedRole === "super_admin" ||
    normalizedRole === "admin" ||
    normalizedRole === "purok_leader";

  const {
    notifications,
    update: setNotifications,
    refresh: refreshFeed,
    loading,
    loaded,
    error: feedError,
    accessPaused,
    enabled,
  } = useNotifications();

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");
  const displayError = error || feedError?.message || "";

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

  const [notificationToDelete, setNotificationToDelete] =
    useState<NotificationItem | null>(null);

  const [notificationDetails, setNotificationDetails] =
    useState<NotificationItem | null>(null);
  const detailsDialogRef = useRef<HTMLDialogElement>(null);
  const detailsTitleRef = useRef<HTMLHeadingElement>(null);
  const detailsTitleId = useId();
  const detailsMetaId = useId();

  useEffect(() => {
    const dialog = detailsDialogRef.current;
    if (!dialog || !notificationDetails) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    detailsTitleRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [notificationDetails]);

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

  const mountedRef = useRef(false);
  const initialSeenSyncedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Opening the inbox marks notifications seen once. Shared background refreshes
  // update the inbox, both badges, and emergency alerts without extra requests.
  useEffect(() => {
    if (!enabled || !loaded || accessPaused || initialSeenSyncedRef.current) return;
    initialSeenSyncedRef.current = true;
    const sessionToken = getToken();
    void apiRequest("/api/notifications/seen-all", { method: "PATCH" })
      .then(() => {
        if (getToken() !== sessionToken) return;
        setNotifications((current) => current.map((item) => ({
          ...item,
          is_seen: 1,
          seen_at: item.seen_at || new Date().toISOString(),
        })));
        window.dispatchEvent(new Event("notifications-seen-all"));
      })
      .catch((requestError) => {
        if (mountedRef.current && getToken() === sessionToken) {
          setError(requestError instanceof Error ? requestError.message : "Unable to mark notifications as seen.");
        }
      });
  }, [enabled, loaded, accessPaused, setNotifications]);

  const refreshNotifications = async (manual = false) => {
    setError("");
    await refreshFeed({ manual });
  };

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
      label: "All notifications",
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

  const openLinkedNotification = (item: NotificationItem, page: NotificationPage) => {
    if (!Boolean(Number(item.is_read))) {
      void markRead(item.id);
    }
    const recordId = Number(item.related_entity_id);
    onNavigate?.(
      page,
      Number.isSafeInteger(recordId) && recordId > 0 ? recordId : undefined,
    );
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
      const result = await apiRequest(
        `/api/notifications/${notificationId}`,
        {
          method: "DELETE",
        },
      );

      setSuccessMessage(result.message || "Notification removed.");
      window.dispatchEvent(new Event("notifications-changed"));
      setNotifications((current) =>
        current.filter(
          (item) =>
            item.id !== notificationId,
        ),
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

  return portalOverlays(
    <>
      <style>{`
        html.sg-dark .sg-notification-card {
          background-color: #111827 !important;
          border-color: #334155 !important;
        }

        html.sg-dark .sg-notification-card.sg-notification-card {
          color: #e2e8f0;
        }

        html.sg-dark .sg-notification-title {
          color: #f8fafc !important;
        }

        html.sg-dark .sg-notification-message {
          color: #cbd5e1 !important;
        }

        html.sg-dark .sg-notification-meta {
          color: #94a3b8 !important;
        }

        html.sg-dark .sg-notification-area {
          color: #6ee7b7 !important;
        }
      `}</style>
      <div className="space-y-4 pb-20 md:pb-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            <Megaphone className="h-4 w-4" />
            Real-Time Notification Center
          </div>

          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-3xl">
            Notifications
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            {unreadCount} unread notification
            {unreadCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshNotifications(true)}
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

                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm font-semibold text-white/90">
                  {unreadEmergency.message}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNotificationDetails(unreadEmergency)}
                aria-haspopup="dialog"
                aria-label={`View details for ${unreadEmergency.title}`}
                className="h-10 rounded-xl border border-white/40 px-4 text-xs font-black uppercase text-white transition hover:bg-white/10"
              >
                View details
              </button>
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
        </div>
      )}

      {displayError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          {displayError}
        </div>
      )}

      {accessPaused && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          Automatic notification checks are paused because this account cannot access notifications yet.
          After your account is approved, click Refresh or sign in again to retry.
        </p>
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
              placeholder="Search notifications, sender, or area"
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
            {filteredNotifications.length} matching notification
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
            const targetPage = onNavigate ? linkedNotificationPage(item, role) : null;
            const openTarget = () => {
              if (targetPage) openLinkedNotification(item, targetPage);
            };

            return (
              <article
                key={item.id}
                role={targetPage ? "link" : undefined}
                tabIndex={targetPage ? 0 : undefined}
                aria-label={targetPage ? `Open related ${targetPage.replaceAll("-", " ")} page: ${item.title}` : undefined}
                title={targetPage ? `Open related ${targetPage.replaceAll("-", " ")} page` : undefined}
                onClick={targetPage ? openTarget : undefined}
                onKeyDown={targetPage ? (event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openTarget();
                  }
                } : undefined}
                className={`sg-notification-card relative border-l-4 p-4 transition-colors ${style.container} ${targetPage ? "cursor-pointer hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-emerald-500" : ""}`}
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

                      <span className="text-[10px] font-bold text-[#64748b]">
                        NOTIF-{item.id}
                      </span>

                      {/* This shows the actual read status; viewing the inbox only
                          marks notifications as seen, not read. */}
                      <span
                        aria-label={`Notification status: ${isRead ? "Read" : "Unread"}`}
                        title={
                          isRead && item.read_at
                            ? `Read on ${formatDate(item.read_at)}`
                            : isRead
                              ? "Already read"
                              : "Not yet read"
                        }
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                          isRead
                            ? "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                            : "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200"
                        }`}
                      >
                        {isRead ? (
                          <Check aria-hidden="true" className="h-3 w-3" />
                        ) : (
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-300" />
                        )}
                        {isRead ? "Read" : "Unread"}
                      </span>
                    </div>

                    <h2 className="sg-notification-title mt-2 truncate text-sm font-black text-[#0f172a] sm:text-base">
                      {item.title}
                    </h2>

                    <p className="sg-notification-message mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#475569]">
                      {item.message}
                    </p>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setNotificationDetails(item);
                      }}
                      aria-haspopup="dialog"
                      aria-label={`View details for ${item.title}`}
                      className="mt-2 min-h-9 rounded-lg px-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-emerald-300"
                    >
                      View details
                    </button>

                    <p className="sg-notification-meta mt-2 text-[10px] font-bold uppercase tracking-wide text-[#64748b]">
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
                      <p className="sg-notification-area mt-1 text-[10px] font-bold uppercase text-[#047857]">
                        {[
                          item.purok_name,
                          item.barangay_name,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                    {targetPage && (
                      <p className="mt-2 text-[11px] font-bold text-emerald-600">
                        Open related {targetPage.replaceAll("-", " ")} →
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 md:justify-end">
                    {!isRead && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void markRead(item.id);
                        }}
                        className="flex h-9 items-center gap-1 rounded-lg bg-white px-2.5 text-[10px] font-black uppercase text-emerald-700 shadow-sm transition hover:bg-emerald-50"
                        title="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                        Read
                      </button>
                    )}

                    {(
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setNotificationToDelete(item);
                        }}
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
                visibleNotifications.length} more notification
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

      {notificationDetails && (
        <dialog
          ref={detailsDialogRef}
          aria-labelledby={detailsTitleId}
          aria-describedby={detailsMetaId}
          onCancel={(event) => {
            event.preventDefault();
            setNotificationDetails(null);
          }}
          className="sg-notification-card m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
        >
          <div className="flex max-h-[calc(100dvh-2rem-2px)] flex-col">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                Notification details
              </p>
              <button
                type="button"
                onClick={() => setNotificationDetails(null)}
                aria-label="Close notification details"
                className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              role="region"
              aria-label="Full notification message"
              tabIndex={0}
              className="min-h-0 overflow-y-auto overscroll-contain p-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 sm:p-5"
            >
              <h2
                ref={detailsTitleRef}
                id={detailsTitleId}
                tabIndex={-1}
                className="sg-notification-title text-lg font-black text-slate-900 focus:outline-none [overflow-wrap:anywhere]"
              >
                {notificationDetails.title}
              </h2>
              <p id={detailsMetaId} className="sg-notification-meta mt-2 text-xs text-slate-500 [overflow-wrap:anywhere]">
                {notificationDetails.created_by_name || "System"}
                {" • "}
                {formatDate(notificationDetails.created_at)}
                {(notificationDetails.purok_name || notificationDetails.barangay_name) && (
                  <span className="mt-1 block">
                    {[notificationDetails.purok_name, notificationDetails.barangay_name]
                      .filter(Boolean).join(", ")}
                  </span>
                )}
              </p>
              <p className="sg-notification-message mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
                {notificationDetails.message}
              </p>
            </div>
            <div className="flex shrink-0 justify-end border-t border-slate-200 p-3 sm:px-5">
              <button
                type="button"
                onClick={() => setNotificationDetails(null)}
                className="h-10 rounded-xl bg-emerald-700 px-5 text-xs font-black uppercase text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}

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
            ? canBroadcast
              ? `Delete “${notificationToDelete.title}”? If you manage this announcement, it may be removed for other recipients too.`
              : `Remove “${notificationToDelete.title}” from your notifications? Other recipients will keep their copy.`
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
    </>
  );
}
