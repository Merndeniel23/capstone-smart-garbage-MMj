import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRole } from "../context/AppStateContext";
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
  "super_admin",
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
    notifyAdminActionCountsChanged();
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
  const latestRequest = useRef(0);
  const isAdminRole = ADMIN_ROLES.includes(role);
  const canReviewPayments = PAYMENT_ACTION_ROLES.includes(role);
  const canReviewEndorsements = ENDORSEMENT_ACTION_ROLES.includes(role);
  const canManageCollectionTasks = COLLECTION_ACTION_ROLES.includes(role);

  const loadCounts = useCallback(async () => {
    const requestId = ++latestRequest.current;

    if (!userId) {
      setCounts(EMPTY_COUNTS);
      return;
    }

    const [summaryResult, notificationResult, paymentResult, endorsementResult, collectionResult] =
      await Promise.allSettled([
        isAdminRole
          ? apiRequest<{
              summary?: Partial<AdminActionCounts>;
            }>("/admin/dashboard-summary")
          : Promise.resolve(null),
        apiRequest<{
          notifications?: Array<{
            notification_type?: string;
            is_read?: number | boolean;
          }>;
        }>("/notifications"),
        canReviewPayments
          ? apiRequest<{
              payments?: Array<{ status?: string }>;
            }>("/payments")
          : Promise.resolve(null),
        canReviewEndorsements
          ? apiRequest<{
              endorsements?: Array<{ status?: string }>;
            }>("/endorsements")
          : Promise.resolve(null),
        canManageCollectionTasks
          ? apiRequest<{
              requests?: Array<{ status?: string }>;
            }>("/collection-requests")
          : Promise.resolve(null),
      ]);

    if (requestId !== latestRequest.current) return;

    const summary =
      summaryResult.status === "fulfilled"
        ? summaryResult.value?.summary
        : undefined;
    const notifications =
      notificationResult.status === "fulfilled" &&
      Array.isArray(notificationResult.value.notifications)
        ? notificationResult.value.notifications
        : null;

    const paymentRows =
      paymentResult.status === "fulfilled" &&
      paymentResult.value &&
      Array.isArray(paymentResult.value.payments)
        ? paymentResult.value.payments
        : null;
    const endorsementRows =
      endorsementResult.status === "fulfilled" &&
      endorsementResult.value &&
      Array.isArray(endorsementResult.value.endorsements)
        ? endorsementResult.value.endorsements
        : null;
    const collectionRows =
      collectionResult.status === "fulfilled" &&
      collectionResult.value &&
      Array.isArray(collectionResult.value.requests)
        ? collectionResult.value.requests
        : null;

    const pendingPayments =
      paymentRows === null
        ? null
        : paymentRows.filter((payment) =>
            role === "leader"
              ? payment.status === "pending_leader_verification"
              : payment.status === "pending_admin_confirmation" ||
                payment.status === "discrepancy",
          ).length;
    const pendingEndorsements =
      endorsementRows === null
        ? null
        : endorsementRows.filter((endorsement) =>
            role === "leader"
              ? endorsement.status === "pending_leader_review"
              : endorsement.status === "leader_endorsed",
          ).length;
    const pendingCollectionTasks =
      collectionRows === null
        ? null
        : collectionRows.filter((request) =>
            ["pending", "approved", "assigned", "in_progress"].includes(
              String(request.status || "").toLowerCase(),
            ),
          ).length;

    setCounts((previous) => {
      const pendingAccounts = summary
        ? Number(summary.pendingAccounts || 0)
        : previous.pendingAccounts;
      const pendingComplaints = summary
        ? Number(summary.pendingComplaints || 0)
        : previous.pendingComplaints;

      if (!notifications) {
        return {
          ...previous,
          pendingAccounts,
          pendingComplaints,
          pendingPayments:
            pendingPayments === null
              ? previous.pendingPayments
              : pendingPayments,
          pendingEndorsements:
            pendingEndorsements === null
              ? previous.pendingEndorsements
              : pendingEndorsements,
          pendingCollectionTasks:
            pendingCollectionTasks === null
              ? previous.pendingCollectionTasks
              : pendingCollectionTasks,
        };
      }

      const accountNotifications = notifications.filter(
        (item) =>
          ACCOUNT_NOTIFICATION_TYPES.has(
            String(item.notification_type || "").toLowerCase(),
          ),
      );
      const complaintNotifications = notifications.filter(
        (item) =>
          COMPLAINT_NOTIFICATION_TYPES.has(
            String(item.notification_type || "").toLowerCase(),
          ),
      );

      return {
        pendingAccounts,
        pendingComplaints,
        pendingPayments:
          pendingPayments === null
            ? previous.pendingPayments
            : pendingPayments,
        pendingEndorsements:
          pendingEndorsements === null
            ? previous.pendingEndorsements
            : pendingEndorsements,
        pendingCollectionTasks:
          pendingCollectionTasks === null
            ? previous.pendingCollectionTasks
            : pendingCollectionTasks,
        unreadAccounts:
          isAdminRole && accountNotifications.length > 0
            ? accountNotifications.filter(
                (item) => !Boolean(Number(item.is_read)),
              ).length
            : isAdminRole
              ? pendingAccounts
              : 0,
        unreadComplaints:
          complaintNotifications.length > 0
            ? complaintNotifications.filter(
                (item) => !Boolean(Number(item.is_read)),
              ).length
            : pendingComplaints,
      };
    });
  }, [canManageCollectionTasks, canReviewEndorsements, canReviewPayments, isAdminRole, role, userId]);

  useEffect(() => {
    if (!userId) {
      latestRequest.current += 1;
      setCounts(EMPTY_COUNTS);
      return;
    }

    void loadCounts();

    const timer = window.setInterval(
      () => void loadCounts(),
      10000,
    );

    const refreshCounts = () => void loadCounts();

    window.addEventListener(
      ADMIN_ACTION_COUNTS_CHANGED_EVENT,
      refreshCounts,
    );
    window.addEventListener(
      "notifications-changed",
      refreshCounts,
    );
    window.addEventListener(
      "notifications-seen-all",
      refreshCounts,
    );
    window.addEventListener("focus", refreshCounts);

    return () => {
      latestRequest.current += 1;
      window.clearInterval(timer);
      window.removeEventListener(
        ADMIN_ACTION_COUNTS_CHANGED_EVENT,
        refreshCounts,
      );
      window.removeEventListener(
        "notifications-changed",
        refreshCounts,
      );
      window.removeEventListener(
        "notifications-seen-all",
        refreshCounts,
      );
      window.removeEventListener("focus", refreshCounts);
    };
  }, [loadCounts, userId]);

  return counts;
}
