import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

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
  is_read: number | boolean;
  read_at?: string | null;
  created_at: string;
};

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

  useEffect(() => {
    void loadNotifications();

    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const filteredNotifications =
    useMemo(() => {
      return notifications.filter(
        (item) => {
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

          return true;
        },
      );
    }, [
      notifications,
      activeFilter,
    ]);

  const unreadCount =
    notifications.filter(
      (item) =>
        !Boolean(Number(item.is_read)),
    ).length;

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
                is_read: 1,
                read_at:
                  new Date().toISOString(),
              }
            : item,
        ),
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
          is_read: 1,
          read_at:
            item.read_at ||
            new Date().toISOString(),
        })),
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
    const confirmed =
      window.confirm(
        "Delete this notification?",
      );

    if (!confirmed) return;

    setError("");

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
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to delete notification.",
      );
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            <Megaphone className="h-4 w-4" />
            Real-Time Notification Center
          </div>

          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">
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
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-xs font-black uppercase text-slate-700"
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
            onClick={() =>
              void markAllRead()
            }
            className="rounded-xl border bg-white px-4 py-3 text-xs font-black uppercase text-slate-700"
          >
            Mark All Read
          </button>

          {canBroadcast && (
            <button
              type="button"
              onClick={() =>
                setShowCompose(true)
              }
              className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black uppercase text-white"
            >
              <Plus className="h-4 w-4" />
              Broadcast
            </button>
          )}
        </div>
      </header>

      {unreadEmergency && (
        <div className="rounded-[2rem] bg-gradient-to-r from-rose-700 to-red-600 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-white/10" />
                <AlertTriangle className="relative h-7 w-7" />
              </span>

              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-rose-100">
                  Active Emergency Alert
                </p>

                <h2 className="mt-1 text-xl font-black">
                  {unreadEmergency.title}
                </h2>

                <p className="mt-2 max-w-3xl text-sm font-semibold text-white/90">
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
              className="shrink-0 rounded-xl bg-white px-5 py-3 text-xs font-black uppercase text-rose-700"
            >
              Acknowledge Alert
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
          {successMessage}
        </div>
      )}

      <div className="flex w-fit gap-2 rounded-2xl bg-slate-100 p-1">
        {[
          ["all", "All Alerts"],
          ["unread", "Unread"],
          ["emergency", "Emergency"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() =>
              setActiveFilter(
                id as typeof activeFilter,
              )
            }
            className={`rounded-xl px-4 py-2 text-xs font-black ${
              activeFilter === id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="space-y-4">
        {loading &&
          notifications.length === 0 && (
            <div className="rounded-[2rem] border bg-white p-12 text-center shadow-sm">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-700" />
              <p className="mt-3 text-sm font-bold text-slate-500">
                Loading notifications...
              </p>
            </div>
          )}

        {!loading &&
          filteredNotifications.length ===
            0 && (
            <div className="rounded-[2rem] border bg-white p-12 text-center shadow-sm">
              <Bell className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 font-black text-slate-700">
                No notifications found
              </p>
            </div>
          )}

        {filteredNotifications.map(
          (item) => {
            const style =
              priorityStyle(
                item.priority,
              );

            const isRead =
              Boolean(
                Number(item.is_read),
              );

            return (
              <article
                key={item.id}
                className={`relative rounded-[2rem] border p-6 shadow-sm ${style.container}`}
              >
                {!isRead && (
                  <span className="absolute left-4 top-4 h-2.5 w-2.5 rounded-full bg-emerald-500">
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400" />
                  </span>
                )}

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 pl-3">
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

                    <h2 className="mt-3 text-lg font-black text-slate-900">
                      {item.title}
                    </h2>

                    <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">
                      {item.message}
                    </p>

                    <p className="mt-4 text-[10px] font-bold uppercase tracking-wide text-slate-400">
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

                  <div className="flex shrink-0 gap-2">
                    {!isRead && (
                      <button
                        type="button"
                        onClick={() =>
                          void markRead(
                            item.id,
                          )
                        }
                        className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-[10px] font-black uppercase text-emerald-700 shadow-sm"
                      >
                        <Check className="h-4 w-4" />
                        Read
                      </button>
                    )}

                    {canBroadcast && (
                      <button
                        type="button"
                        onClick={() =>
                          void deleteNotification(
                            item.id,
                          )
                        }
                        className="rounded-xl bg-white p-2 text-rose-600 shadow-sm"
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
      </section>

      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                  Authorized Broadcast
                </p>

                <h2 className="text-2xl font-black text-slate-900">
                  Create Notification
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowCompose(false)
                }
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={submitBroadcast}
              className="mt-6 space-y-4"
            >
              <label className="block text-xs font-bold text-slate-600">
                Title
                <input
                  value={title}
                  onChange={(event) =>
                    setTitle(
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border bg-slate-50 p-3 text-sm"
                  placeholder="Notification title"
                />
              </label>

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
                  className="mt-2 w-full rounded-xl border bg-white p-3 text-sm"
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
                  className="mt-2 w-full rounded-xl border bg-white p-3 text-sm"
                >
                  <option value="">
                    Everyone in allowed area
                  </option>
                  <option value="resident">
                    Civilians
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

              <label className="block text-xs font-bold text-slate-600">
                Message
                <textarea
                  rows={5}
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border bg-slate-50 p-3 text-sm"
                  placeholder="Write the notification message..."
                />
              </label>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setShowCompose(false)
                  }
                  disabled={saving}
                  className="flex-1 rounded-xl border px-4 py-3 text-sm font-black text-slate-600"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
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
    </div>
  );
}