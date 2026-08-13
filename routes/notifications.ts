import { Router } from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

function normalizeRole(value?: string) {
  const role = String(value || "")
    .trim()
    .toLowerCase();

  if (role === "leader") {
    return "purok_leader";
  }

  if (role === "household") {
    return "resident";
  }

  return role;
}

function canBroadcast(role?: string) {
  const normalized = normalizeRole(role);

  return (
    normalized === "super_admin" ||
    normalized === "admin" ||
    normalized === "purok_leader"
  );
}

async function loadViewer(userId: number) {
  const [rows] = await db.query<any[]>(
    `
    SELECT
      id,
      role,
      barangay_id,
      purok_id,
      status
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

/**
 * GET /api/notifications
 * Loads notifications visible to the logged-in account.
 */
router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewerId = Number(req.user?.id);

      if (!Number.isInteger(viewerId) || viewerId <= 0) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const viewer = await loadViewer(viewerId);

      if (!viewer || viewer.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive or unavailable.",
        });
      }

      const role = normalizeRole(viewer.role);

      const [rows] = await db.query<any[]>(
        `
        SELECT
          n.id,
          n.recipient_user_id,
          n.recipient_role,
          n.barangay_id,
          n.purok_id,
          n.notification_type,
          n.priority,
          n.title,
          n.message,
          n.related_entity_type,
          n.related_entity_id,
          n.created_by,
          n.is_read,
          n.read_at,
          n.created_at,

          creator.full_name AS created_by_name,
          barangay.name AS barangay_name,
          purok.name AS purok_name

        FROM notifications n

        LEFT JOIN users creator
          ON creator.id = n.created_by

        LEFT JOIN barangays barangay
          ON barangay.id = n.barangay_id

        LEFT JOIN puroks purok
          ON purok.id = n.purok_id

        WHERE
          n.recipient_user_id = ?

          OR (
            n.recipient_user_id IS NULL
            AND n.recipient_role = ?
          )

          OR (
            n.recipient_user_id IS NULL
            AND n.recipient_role IS NULL
            AND n.barangay_id IS NULL
            AND n.purok_id IS NULL
          )

          OR (
            n.recipient_user_id IS NULL
            AND n.barangay_id IS NOT NULL
            AND n.barangay_id = ?
            AND (
              n.recipient_role IS NULL
              OR n.recipient_role = ?
            )
          )

          OR (
            n.recipient_user_id IS NULL
            AND n.purok_id IS NOT NULL
            AND n.purok_id = ?
            AND (
              n.recipient_role IS NULL
              OR n.recipient_role = ?
            )
          )

        ORDER BY
          n.is_read ASC,
          FIELD(n.priority, 'emergency', 'schedule', 'notice'),
          n.created_at DESC,
          n.id DESC

        LIMIT 250
        `,
        [
          viewerId,
          role,
          viewer.barangay_id || 0,
          role,
          viewer.purok_id || 0,
          role,
        ],
      );

      return res.json({
        success: true,
        notifications: rows,
      });
    } catch (error) {
      console.error("Load notifications error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load notifications.",
      });
    }
  },
);

/**
 * POST /api/notifications
 * Admin, Super Admin, and Purok Leader can broadcast a notification.
 */
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!canBroadcast(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message:
            "Only authorized administrators and Purok Leaders can broadcast notifications.",
        });
      }

      const viewerId = Number(req.user?.id);
      const viewer = await loadViewer(viewerId);

      if (!viewer || viewer.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive or unavailable.",
        });
      }

      const title = String(req.body.title || "").trim();
      const message = String(req.body.message || "").trim();

      const priority = String(
        req.body.priority || "notice",
      )
        .trim()
        .toLowerCase();

      const notificationType = String(
        req.body.notificationType || "notice",
      )
        .trim()
        .toLowerCase();

      const recipientRoleRaw =
        req.body.recipientRole === undefined ||
        req.body.recipientRole === null ||
        req.body.recipientRole === ""
          ? null
          : normalizeRole(String(req.body.recipientRole));

      const recipientUserId =
        req.body.recipientUserId === undefined ||
        req.body.recipientUserId === null ||
        req.body.recipientUserId === ""
          ? null
          : Number(req.body.recipientUserId);

      const submittedBarangayId =
        req.body.barangayId === undefined ||
        req.body.barangayId === null ||
        req.body.barangayId === ""
          ? null
          : Number(req.body.barangayId);

      const submittedPurokId =
        req.body.purokId === undefined ||
        req.body.purokId === null ||
        req.body.purokId === ""
          ? null
          : Number(req.body.purokId);

      if (!title || !message) {
        return res.status(400).json({
          success: false,
          message: "Title and message are required.",
        });
      }

      if (
        !["emergency", "schedule", "notice"].includes(priority)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Priority must be emergency, schedule, or notice.",
        });
      }

      const role = normalizeRole(viewer.role);
      const isSuperAdmin = role === "super_admin";
      const isAdmin = role === "admin";

      let barangayId: number | null = null;
      let purokId: number | null = null;

      if (isSuperAdmin) {
        barangayId =
          Number.isInteger(submittedBarangayId) &&
          Number(submittedBarangayId) > 0
            ? Number(submittedBarangayId)
            : null;

        purokId =
          Number.isInteger(submittedPurokId) &&
          Number(submittedPurokId) > 0
            ? Number(submittedPurokId)
            : null;
      } else if (isAdmin) {
        barangayId = viewer.barangay_id
          ? Number(viewer.barangay_id)
          : null;

        purokId =
          Number.isInteger(submittedPurokId) &&
          Number(submittedPurokId) > 0
            ? Number(submittedPurokId)
            : null;
      } else {
        barangayId = viewer.barangay_id
          ? Number(viewer.barangay_id)
          : null;

        purokId = viewer.purok_id
          ? Number(viewer.purok_id)
          : null;
      }

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message: "Your account has no assigned barangay.",
        });
      }

      if (
        recipientUserId !== null &&
        (!Number.isInteger(recipientUserId) ||
          recipientUserId <= 0)
      ) {
        return res.status(400).json({
          success: false,
          message: "Recipient user ID is invalid.",
        });
      }

      const [result]: any = await db.execute(
        `
        INSERT INTO notifications
        (
          recipient_user_id,
          recipient_role,
          barangay_id,
          purok_id,
          notification_type,
          priority,
          title,
          message,
          related_entity_type,
          related_entity_id,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          recipientUserId,
          recipientRoleRaw,
          barangayId,
          purokId,
          notificationType || "notice",
          priority,
          title,
          message,
          req.body.relatedEntityType || null,
          req.body.relatedEntityId || null,
          viewerId,
        ],
      );

      return res.status(201).json({
        success: true,
        message: "Notification broadcast successfully.",
        notificationId: result.insertId,
      });
    } catch (error) {
      console.error("Create notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to broadcast the notification.",
      });
    }
  },
);

/**
 * PATCH /api/notifications/read-all
 */
router.patch(
  "/read-all",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewerId = Number(req.user?.id);
      const viewer = await loadViewer(viewerId);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      const role = normalizeRole(viewer.role);

      await db.execute(
        `
        UPDATE notifications
        SET
          is_read = 1,
          read_at = COALESCE(read_at, NOW())
        WHERE
          recipient_user_id = ?

          OR (
            recipient_user_id IS NULL
            AND recipient_role = ?
          )

          OR (
            recipient_user_id IS NULL
            AND recipient_role IS NULL
            AND barangay_id IS NULL
            AND purok_id IS NULL
          )

          OR (
            recipient_user_id IS NULL
            AND barangay_id = ?
            AND (
              recipient_role IS NULL
              OR recipient_role = ?
            )
          )

          OR (
            recipient_user_id IS NULL
            AND purok_id = ?
            AND (
              recipient_role IS NULL
              OR recipient_role = ?
            )
          )
        `,
        [
          viewerId,
          role,
          viewer.barangay_id || 0,
          role,
          viewer.purok_id || 0,
          role,
        ],
      );

      return res.json({
        success: true,
        message: "All notifications were marked as read.",
      });
    } catch (error) {
      console.error("Mark all notifications error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to mark notifications as read.",
      });
    }
  },
);

/**
 * PATCH /api/notifications/:id/read
 */
router.patch(
  "/:id/read",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const notificationId = Number(req.params.id);
      const viewerId = Number(req.user?.id);

      if (
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is invalid.",
        });
      }

      const viewer = await loadViewer(viewerId);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      const role = normalizeRole(viewer.role);

      const [rows] = await db.query<any[]>(
        `
        SELECT id
        FROM notifications
        WHERE id = ?
          AND (
            recipient_user_id = ?

            OR (
              recipient_user_id IS NULL
              AND recipient_role = ?
            )

            OR (
              recipient_user_id IS NULL
              AND recipient_role IS NULL
              AND barangay_id IS NULL
              AND purok_id IS NULL
            )

            OR (
              recipient_user_id IS NULL
              AND barangay_id = ?
              AND (
                recipient_role IS NULL
                OR recipient_role = ?
              )
            )

            OR (
              recipient_user_id IS NULL
              AND purok_id = ?
              AND (
                recipient_role IS NULL
                OR recipient_role = ?
              )
            )
          )
        LIMIT 1
        `,
        [
          notificationId,
          viewerId,
          role,
          viewer.barangay_id || 0,
          role,
          viewer.purok_id || 0,
          role,
        ],
      );

      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          message: "Notification was not found.",
        });
      }

      await db.execute(
        `
        UPDATE notifications
        SET
          is_read = 1,
          read_at = NOW()
        WHERE id = ?
        `,
        [notificationId],
      );

      return res.json({
        success: true,
        message: "Notification marked as read.",
      });
    } catch (error) {
      console.error("Read notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to update the notification.",
      });
    }
  },
);

/**
 * DELETE /api/notifications/:id
 * Only the creator, Admin, or Super Admin may delete.
 */
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const notificationId = Number(req.params.id);
      const viewerId = Number(req.user?.id);

      if (
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is invalid.",
        });
      }

      const viewer = await loadViewer(viewerId);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      const role = normalizeRole(viewer.role);

      const [rows] = await db.query<any[]>(
        `
        SELECT id, created_by
        FROM notifications
        WHERE id = ?
        LIMIT 1
        `,
        [notificationId],
      );

      const notification = rows[0];

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification was not found.",
        });
      }

      if (
        role !== "super_admin" &&
        role !== "admin" &&
        Number(notification.created_by) !== viewerId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to delete this notification.",
        });
      }

      await db.execute(
        `
        DELETE FROM notifications
        WHERE id = ?
        `,
        [notificationId],
      );

      return res.json({
        success: true,
        message: "Notification deleted.",
      });
    } catch (error) {
      console.error("Delete notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to delete the notification.",
      });
    }
  },
);

export default router;