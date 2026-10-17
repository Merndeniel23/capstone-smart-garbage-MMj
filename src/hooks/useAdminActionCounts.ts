import { useEffect, useMemo, useState } from "react";
import type { AppRole } from "../context/AppStateContext";
import { useNotifications } from "../context/NotificationsContext";
import { apiRequest } from "../services/api";

export const ADMIN_ACTION_COUNTS_CHANGED_EVENT =
  "admin-action-counts-changed";

const ADMIN_ROLES: AppRole[] = ["admin", "super_admin"];
const PAYMENT_ACTION_ROLES: AppRole[] = [
  "leader",
  "admin",
  "super_admin",
];
const ENDORSEMENT_ACTION_ROLES: AppRole[] = [
  "leader",
  "admin",
];
const COLLECTION_ACTION_ROLES: AppRole[] = ["collector"];
const ACCOUNT_NOTIFICATION_TYPES = new Set([
  "account_approval_request",
]);
const COMPLAINT_NOTIFICATION_TYPES = new Set([
  "new_complaint",
  "complaint_message",
  "complaint_update",
]);
const POLL_INTERVAL_MS = 30000;
const REQUEST_TIMEOUT_MS = 20000;
const REFRESH_DEBOUNCE_MS = 250;
const MIN_REFRESH_INTERVAL_MS = 1000;

export interface AdminActionCounts {
  pendingAccounts: number;
  pendingComplaints: number;
  pendingPayments: number;
  pendingEndorsements: number;
  pendingCollectionTasks: number;
  unreadAccounts: number;
  unreadComplaints: number;
}

const EMPTY_COUNTS: AdminActionCounts = {
  pendingAccounts: 0,
  pendingComplaints: 0,
  pendingPayments: 0,
  pendingEndorsements: 0,
  pendingCollectionTasks: 0,
  unreadAccounts: 0,
  unreadComplaints: 0,
};

export function notifyAdminActionCountsChanged() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new Event(ADMIN_ACTION_COUNTS_CHANGED_EVENT),
  );
}

export type AdminActionNotificationGroup =
  | "accounts"
  | "complaints";

export async function markAdminActionNotificationsRead(
  group: AdminActionNotificationGroup,
) {
  if (typeof window === "undefined") return;

  const notificationTypes =
    group === "accounts"
      ? ["account_approval_request"]
      : [
          "new_complaint",
          "complaint_message",
          "complaint_update",
        ];

  try {
    await apiRequest("/notifications/read-by-type", {
      method: "PATCH",
      body: JSON.stringify({ notificationTypes }),
    });
    window.dispatchEvent(new Event("notifications-changed"));
  } catch {
    // A badge refresh failure must not prevent the page from opening.
  }
}

export function useAdminActionCounts(
  role: AppRole,
  userId?: number,
) {
  const [counts, setCounts] =
    useState<AdminActionCounts>(EMPTY_COUNTS);
  const { notifications, loaded, enabled } = useNotifications();
  const isAdminRole = ADMIN_ROLES.includes(role);
  const canReviewPayments = PAYMENT_ACTION_ROLES.includes(role);
  const canReviewEndorsements = ENDORSEMENT_ACTION_ROLES.includes(role);
  const canManageCollectionTasks = COLLECTION_ACTION_ROLES.includes(role);

  useEffect(() => {
    setCounts(EMPTY_COUNTS);
    if (!enabled || !userId) return;

    let stopped = false;
    let accessPaused = false;
    let inFlight = false;
    let refreshQueued = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let lastCompletedAt = 0;

    const isVisible = () => document.visibilityState !== "hidden";
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (stopped || accessPaused || !isVisible()) return;
      timer = window.setTimeout(() => void loadCounts(), delay);
    };

    async function loadCounts() {
      if (stopped || accessPaused || !isVisible() || inFlight) return;

      clearTimer();
      inFlight = true;
      refreshQueued = false;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = window.setTimeout(
        () => requestController.abort(),
        REQUEST_TIMEOUT_MS,
      );

      try {
        const options = { signal: requestController.signal };
        const [summaryResult, paymentResult, endorsementResult, collectionResult] =
          await Promise.allSettled([
            isAdminRole
              ? apiRequest<{
                  summary?: Partial<AdminActionCounts>;
                }>("/admin/dashboard-summary", options)
              : Promise.resolve(null),
            canReviewPayments
              ? apiRequest<{
                  payments?: Array<{ status?: string }>;
                }>("/payments", options)
              : Promise.resolve(null),
            canReviewEndorsements
              ? apiRequest<{
                  endorsements?: Array<{ status?: string }>;
                }>("/endorsements", options)
              : Promise.resolve(null),
            canManageCollectionTasks
              ? apiRequest<{
                  requests?: Array<{ status?: string }>;
                }>("/collection-requests", options)
              : Promise.resolve(null),
          ]);

        if (
          stopped ||
          accessPaused ||
          requestController.signal.aborted ||
          !isVisible()
        ) return;

        const summary =
          summaryResult.status === "fulfilled"
            ? summaryResult.value?.summary
            : undefined;
        const paymentRows =
          paymentResult.status === "fulfilled" &&
          Array.isArray(paymentResult.value?.payments)
            ? paymentResult.value.payments
            : null;
        const endorsementRows =
          endorsementResult.status === "fulfilled" &&
          Array.isArray(endorsementResult.value?.endorsements)
            ? endorsementResult.value.endorsements
            : null;
        const collectionRows =
          collectionResult.status === "fulfilled" &&
          Array.isArray(collectionResult.value?.requests)
            ? collectionResult.value.requests
            : null;

        const pendingPayments = !canReviewPayments
          ? 0
          : paymentRows === null
            ? null
            : paymentRows.filter((payment) =>
                role === "leader"
                  ? payment.status === "pending_leader_verification"
                  : payment.status === "pending_admin_confirmation" ||
                    payment.status === "discrepancy",
              ).length;
        const pendingEndorsements = !canReviewEndorsements
          ? 0
          : endorsementRows === null
            ? null
            : endorsementRows.filter((endorsement) =>
                role === "leader"
                  ? endorsement.status === "pending_leader_review"
                  : endorsement.status === "leader_endorsed",
              ).length;
        const pendingCollectionTasks = !canManageCollectionTasks
          ? 0
          : collectionRows === null
            ? null
            : collectionRows.filter((request) =>
                ["pending", "approved", "assigned", "in_progress"].includes(
                  String(request.status || "").toLowerCase(),
                ),
              ).length;

        setCounts((previous) => ({
          ...previous,
          pendingAccounts: summary
            ? Number(summary.pendingAccounts || 0)
            : previous.pendingAccounts,
          pendingComplaints: summary
            ? Number(summary.pendingComplaints || 0)
            : previous.pendingComplaints,
          pendingPayments: pendingPayments ?? previous.pendingPayments,
          pendingEndorsements: pendingEndorsements ?? previous.pendingEndorsements,
          pendingCollectionTasks:
            pendingCollectionTasks ?? previous.pendingCollectionTasks,
        }));
      } finally {
        window.clearTimeout(timeout);
        if (controller === requestController) controller = null;
        inFlight = false;
        lastCompletedAt = Date.now();
        schedule(refreshQueued ? MIN_REFRESH_INTERVAL_MS : POLL_INTERVAL_MS);
      }
    }

    const refreshCounts = () => {
      if (stopped || accessPaused || !isVisible()) return;
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      schedule(Math.max(
        REFRESH_DEBOUNCE_MS,
        MIN_REFRESH_INTERVAL_MS - (Date.now() - lastCompletedAt),
      ));
    };
    const refreshOnFocus = () => {
      if (!inFlight) refreshCounts();
    };
    const handleVisibilityChange = () => {
      if (isVisible()) {
        refreshCounts();
      } else {
        clearTimer();
        refreshQueued = false;
        controller?.abort();
      }
    };
    const pauseForExpiredSession = () => {
      accessPaused = true;
      clearTimer();
      controller?.abort();
      setCounts(EMPTY_COUNTS);
    };

    void loadCounts();
    window.addEventListener(
      ADMIN_ACTION_COUNTS_CHANGED_EVENT,
      refreshCounts,
    );
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("auth-session-expired", pauseForExpiredSession);

    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      window.removeEventListener(
        ADMIN_ACTION_COUNTS_CHANGED_EVENT,
        refreshCounts,
      );
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("auth-session-expired", pauseForExpiredSession);
    };
  }, [canManageCollectionTasks, canReviewEndorsements, canReviewPayments, enabled, isAdminRole, role, userId]);

  return useMemo(() => {
    if (!enabled || !userId) return EMPTY_COUNTS;

    const accountNotifications = loaded
      ? notifications.filter((item) =>
          ACCOUNT_NOTIFICATION_TYPES.has(
            String(item.notification_type || "").toLowerCase(),
          ),
        )
      : [];
    const complaintNotifications = loaded
      ? notifications.filter((item) =>
          COMPLAINT_NOTIFICATION_TYPES.has(
            String(item.notification_type || "").toLowerCase(),
          ),
        )
      : [];

    return {
      ...counts,
      unreadAccounts: !isAdminRole
        ? 0
        : accountNotifications.length > 0
          ? accountNotifications.filter((item) => !Boolean(Number(item.is_read))).length
          : counts.pendingAccounts,
      unreadComplaints: complaintNotifications.length > 0
        ? complaintNotifications.filter((item) => !Boolean(Number(item.is_read))).length
        : counts.pendingComplaints,
    };
  }, [counts, enabled, isAdminRole, loaded, notifications, userId]);
}
