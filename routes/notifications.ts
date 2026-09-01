import { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

const ALLOWED_RECIPIENT_ROLES = new Set([
  "resident",
  "collector",
  "purok_leader",
  "admin",
  "super_admin",
]);

let notificationReceiptsPreparation: Promise<void> | null = null;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function cleanText(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

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

async function loadViewer(
  userId: number,
  executor: any = db,
  forUpdate = false,
) {
  const [rows] = await executor.query(
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
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [userId],
  );

  return rows[0] || null;
}

function notificationVisibilitySql(alias = "n") {
  return `
    (
      ${alias}.recipient_user_id = ?
      OR (
        ${alias}.recipient_user_id IS NULL
        AND (
          ${alias}.recipient_role IS NULL
          OR ${alias}.recipient_role = ?
        )
        AND (
          (
            ${alias}.purok_id IS NOT NULL
            AND ${alias}.purok_id = ?
          )
          OR (
            ${alias}.purok_id IS NULL
            AND ${alias}.barangay_id IS NOT NULL
            AND ${alias}.barangay_id = ?
          )
          OR (
            ${alias}.purok_id IS NULL
            AND ${alias}.barangay_id IS NULL
          )
        )
      )
    )
  `;
}

function notificationVisibilityParameters(viewer: any) {
  return [
    Number(viewer.id),
    normalizeRole(viewer.role),
    positiveInteger(viewer.purok_id) || 0,
    positiveInteger(viewer.barangay_id) || 0,
  ];
}


/**
 * Per-user notification state.
 *
 * A notification can be broadcast to many accounts, so seen/read
 * state must NOT live only on the shared notifications row.
 * This receipt table lets every account have its own state.
 */
async function ensureNotificationReceiptsTable() {
  if (!notificationReceiptsPreparation) {
    notificationReceiptsPreparation = (async () => {
      await db.execute(
        `
        CREATE TABLE IF NOT EXISTS notification_receipts (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          notification_id BIGINT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          is_seen TINYINT(1) NOT NULL DEFAULT 0,
          seen_at DATETIME NULL,
          is_read TINYINT(1) NOT NULL DEFAULT 0,
          read_at DATETIME NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP,

          PRIMARY KEY (id),
          UNIQUE KEY unique_notification_user
            (notification_id, user_id),
          INDEX idx_notification_receipts_user (user_id),
          INDEX idx_notification_receipts_notification
            (notification_id)
        )
        `,
      );
    })().catch((error) => {
      notificationReceiptsPreparation = null;
      throw error;
    });
  }

  await notificationReceiptsPreparation;
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
      const viewerId = positiveInteger(req.user?.id);

      if (!viewerId) {
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

      await ensureNotificationReceiptsTable();

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

          COALESCE(receipt.is_seen, 0) AS is_seen,
          receipt.seen_at,
          COALESCE(receipt.is_read, 0) AS is_read,
          receipt.read_at,

          n.created_at,

          creator.full_name AS created_by_name,
          barangay.name AS barangay_name,
          purok.name AS purok_name

        FROM notifications n

        LEFT JOIN notification_receipts receipt
          ON receipt.notification_id = n.id
         AND receipt.user_id = ?

        LEFT JOIN users creator
          ON creator.id = n.created_by

        LEFT JOIN barangays barangay
          ON barangay.id = n.barangay_id

        LEFT JOIN puroks purok
          ON purok.id = n.purok_id

        WHERE ${notificationVisibilitySql("n")}

        ORDER BY
          COALESCE(receipt.is_read, 0) ASC,
          FIELD(n.priority, 'emergency', 'schedule', 'notice'),
          n.created_at DESC,
          n.id DESC

        LIMIT 250
        `,
        [
          viewerId, // receipt.user_id
          ...notificationVisibilityParameters(viewer),
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
    let connection: PoolConnection | null = null;

    try {
      if (!canBroadcast(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message:
            "Only authorized administrators and Purok Leaders can broadcast notifications.",
        });
      }

      const viewerId = positiveInteger(req.user?.id);

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      let viewer = await loadViewer(viewerId);

      if (!viewer || viewer.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive or unavailable.",
        });
      }

      const title = cleanText(req.body.title, 180);
      const message = cleanText(req.body.message, 4000);

      const priority = String(
        req.body.priority || "notice",
      )
        .trim()
        .toLowerCase();

      const notificationType = cleanText(
        req.body.notificationType || "notice",
        60,
      ).toLowerCase();

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

      if (
        recipientRoleRaw !== null &&
        !ALLOWED_RECIPIENT_ROLES.has(recipientRoleRaw)
      ) {
        return res.status(400).json({
          success: false,
          message: "Recipient role is invalid.",
        });
      }

      if (
        recipientRoleRaw === "super_admin" &&
        normalizeRole(viewer.role) !== "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only a Municipal Administrator can notify that role.",
        });
      }

      if (
        recipientUserId !== null &&
        !positiveInteger(recipientUserId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Recipient user ID is invalid.",
        });
      }

      if (
        submittedBarangayId !== null &&
        !positiveInteger(submittedBarangayId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Barangay ID is invalid.",
        });
      }

      if (
        submittedPurokId !== null &&
        !positiveInteger(submittedPurokId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Purok ID is invalid.",
        });
      }

      connection = await db.getConnection();

      await connection.beginTransaction();

      viewer = await loadViewer(viewerId, connection, true);

      if (
        !viewer ||
        viewer.status !== "active" ||
        !canBroadcast(viewer.role)
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Your account is not authorized to broadcast notifications.",
        });
      }

      const role = normalizeRole(viewer.role);
      const isSuperAdmin = role === "super_admin";
      const isAdmin = role === "admin";

      if (isAdmin) {
        const viewerBarangayId = positiveInteger(viewer.barangay_id);
        const [barangayRows] = await connection.query<any[]>(
          `SELECT id FROM barangays WHERE id = ? AND is_active = 1 LIMIT 1 FOR UPDATE`,
          [viewerBarangayId || 0],
        );

        if (!viewerBarangayId || !barangayRows[0]) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Your account has no active assigned barangay.",
          });
        }
      } else if (!isSuperAdmin) {
        const viewerBarangayId = positiveInteger(viewer.barangay_id);
        const viewerPurokId = positiveInteger(viewer.purok_id);
        const [purokRows] = await connection.query<any[]>(
          `
          SELECT p.id
          FROM puroks p
          INNER JOIN barangays b ON b.id = p.barangay_id
          WHERE p.id = ?
            AND p.barangay_id = ?
            AND b.is_active = 1
          LIMIT 1
          FOR UPDATE
          `,
          [viewerPurokId || 0, viewerBarangayId || 0],
        );

        if (!viewerBarangayId || !viewerPurokId || !purokRows[0]) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Your Purok Leader account has no valid active assignment.",
          });
        }
      }

      let barangayId: number | null = null;
      let purokId: number | null = null;
      let recipientRole = recipientRoleRaw;

      if (recipientUserId !== null) {
        const [recipientRows] = await connection.query<any[]>(
          `
          SELECT id, role, barangay_id, purok_id, status
          FROM users
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [recipientUserId],
        );

        const recipient = recipientRows[0];

        if (!recipient || recipient.status !== "active") {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Recipient account was not found or is inactive.",
          });
        }

        if (
          isAdmin &&
          (!positiveInteger(viewer.barangay_id) ||
            Number(recipient.barangay_id) !== Number(viewer.barangay_id))
        ) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Recipient account was not found in your barangay.",
          });
        }

        if (
          !isSuperAdmin &&
          !isAdmin &&
          (!positiveInteger(viewer.purok_id) ||
            Number(recipient.purok_id) !== Number(viewer.purok_id))
        ) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Recipient account was not found in your purok.",
          });
        }

        const targetRole = normalizeRole(recipient.role);

        if (recipientRole && recipientRole !== targetRole) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Recipient role does not match the selected account.",
          });
        }

        recipientRole = targetRole;
        barangayId = positiveInteger(recipient.barangay_id);
        purokId = positiveInteger(recipient.purok_id);
      } else if (isSuperAdmin && submittedPurokId !== null) {
        const [purokRows] = await connection.query<any[]>(
          `
          SELECT p.id, p.barangay_id
          FROM puroks p
          INNER JOIN barangays b ON b.id = p.barangay_id
          WHERE p.id = ? AND b.is_active = 1
          LIMIT 1
          FOR UPDATE
          `,
          [submittedPurokId],
        );

        const selectedPurok = purokRows[0];

        if (
          !selectedPurok ||
          (submittedBarangayId !== null &&
            Number(selectedPurok.barangay_id) !== submittedBarangayId)
        ) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "The selected barangay and purok do not match.",
          });
        }

        purokId = Number(selectedPurok.id);
        barangayId = Number(selectedPurok.barangay_id);
      } else if (isSuperAdmin && submittedBarangayId !== null) {
        const [barangayRows] = await connection.query<any[]>(
          `SELECT id FROM barangays WHERE id = ? AND is_active = 1 LIMIT 1 FOR UPDATE`,
          [submittedBarangayId],
        );

        if (!barangayRows[0]) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "The selected barangay was not found or is inactive.",
          });
        }

        barangayId = submittedBarangayId;
      } else if (isAdmin) {
        barangayId = positiveInteger(viewer.barangay_id);

        if (!barangayId) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Your account has no assigned barangay.",
          });
        }

        if (submittedPurokId !== null) {
          const [purokRows] = await connection.query<any[]>(
            `
            SELECT id
            FROM puroks
            WHERE id = ? AND barangay_id = ?
            LIMIT 1
            FOR UPDATE
            `,
            [submittedPurokId, barangayId],
          );

          if (!purokRows[0]) {
            await connection.rollback();
            return res.status(404).json({
              success: false,
              message: "The selected purok was not found in your barangay.",
            });
          }

          purokId = submittedPurokId;
        }
      } else {
        barangayId = positiveInteger(viewer.barangay_id);
        purokId = positiveInteger(viewer.purok_id);

        if (!barangayId || !purokId) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Your Purok Leader account has no valid barangay and purok assignment.",
          });
        }

        const [purokRows] = await connection.query<any[]>(
          `
          SELECT id
          FROM puroks
          WHERE id = ? AND barangay_id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [purokId, barangayId],
        );

        if (!purokRows[0]) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Your assigned purok does not belong to your barangay.",
          });
        }
      }

      const relatedEntityType = cleanText(
        req.body.relatedEntityType,
        60,
      ) || null;

      const relatedEntityId =
        req.body.relatedEntityId === undefined ||
        req.body.relatedEntityId === null ||
        req.body.relatedEntityId === ""
          ? null
          : positiveInteger(req.body.relatedEntityId);

      if (
        req.body.relatedEntityId !== undefined &&
        req.body.relatedEntityId !== null &&
        req.body.relatedEntityId !== "" &&
        relatedEntityId === null
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Related entity ID is invalid.",
        });
      }

      const [result]: any = await connection.execute(
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
          recipientRole,
          barangayId,
          purokId,
          notificationType || "notice",
          priority,
          title,
          message,
          relatedEntityType,
          relatedEntityId,
          viewerId,
        ],
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Notification broadcast successfully.",
        notificationId: result.insertId,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error("Create notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to broadcast the notification.",
      });
    } finally {
      connection?.release();
    }
  },
);


/**
 * PATCH /api/notifications/seen-all
 *
 * Facebook-style behavior:
 * opening the notification center clears the numeric "new" badge,
 * but notifications remain unread until the user explicitly reads them.
 */
router.patch(
  "/seen-all",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const viewerId = positiveInteger(req.user?.id);

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      await ensureNotificationReceiptsTable();
      await connection.beginTransaction();

      const viewer = await loadViewer(viewerId, connection, true);

      if (!viewer || viewer.status !== "active") {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      await connection.execute(
        `
        INSERT INTO notification_receipts
        (
          notification_id,
          user_id,
          is_seen,
          seen_at,
          is_read,
          read_at
        )
        SELECT
          n.id,
          ?,
          1,
          NOW(),
          0,
          NULL
        FROM notifications n
        WHERE ${notificationVisibilitySql("n")}

        ON DUPLICATE KEY UPDATE
          is_seen = 1,
          seen_at = COALESCE(seen_at, NOW())
        `,
        [
          viewerId,
          ...notificationVisibilityParameters(viewer),
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message: "Notifications marked as seen.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Mark notifications seen error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update notification badge state.",
      });
    } finally {
      connection.release();
    }
  },
);

/**
 * PATCH /api/notifications/read-by-type
 *
 * Feature pages (for example Complaints & Tickets and Manage Users) can
 * clear only the notifications that belong to that page. This keeps the
 * notification center's other unread items untouched.
 */
router.patch(
  "/read-by-type",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const viewerId = positiveInteger(req.user?.id);

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const requestedTypes = Array.isArray(req.body?.notificationTypes)
        ? req.body.notificationTypes
        : [];
      const notificationTypes = requestedTypes
        .map((value: unknown) => cleanText(value, 60).toLowerCase())
        .filter((value: string) =>
          [
            "account_approval_request",
            "new_complaint",
            "complaint_message",
            "complaint_update",
          ].includes(value),
        );

      if (notificationTypes.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one valid notification type is required.",
        });
      }

      await ensureNotificationReceiptsTable();
      await connection.beginTransaction();

      const viewer = await loadViewer(viewerId, connection, true);

      if (!viewer || viewer.status !== "active") {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      const placeholders = notificationTypes.map(() => "?").join(", ");

      await connection.execute(
        `
        INSERT INTO notification_receipts
        (
          notification_id,
          user_id,
          is_seen,
          seen_at,
          is_read,
          read_at
        )
        SELECT
          n.id,
          ?,
          1,
          NOW(),
          1,
          NOW()
        FROM notifications n
        WHERE n.notification_type IN (${placeholders})
          AND ${notificationVisibilitySql("n")}

        ON DUPLICATE KEY UPDATE
          is_seen = 1,
          seen_at = COALESCE(seen_at, NOW()),
          is_read = 1,
          read_at = COALESCE(read_at, NOW())
        `,
        [
          viewerId,
          ...notificationTypes,
          ...notificationVisibilityParameters(viewer),
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message: "Selected notifications marked as read.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Mark notifications by type error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message: "Unable to update notification state.",
      });
    } finally {
      connection.release();
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
    const connection = await db.getConnection();

    try {
      const viewerId = positiveInteger(req.user?.id);

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      await ensureNotificationReceiptsTable();
      await connection.beginTransaction();

      const viewer = await loadViewer(viewerId, connection, true);

      if (!viewer || viewer.status !== "active") {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      await connection.execute(
        `
        INSERT INTO notification_receipts
        (
          notification_id,
          user_id,
          is_seen,
          seen_at,
          is_read,
          read_at
        )
        SELECT
          n.id,
          ?,
          1,
          NOW(),
          1,
          NOW()
        FROM notifications n
        WHERE ${notificationVisibilitySql("n")}

        ON DUPLICATE KEY UPDATE
          is_seen = 1,
          seen_at = COALESCE(seen_at, NOW()),
          is_read = 1,
          read_at = COALESCE(read_at, NOW())
        `,
        [
          viewerId,
          ...notificationVisibilityParameters(viewer),
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          "All notifications were marked as read.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Mark all notifications error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to mark notifications as read.",
      });
    } finally {
      connection.release();
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
    const connection = await db.getConnection();

    try {
      const notificationId =
        positiveInteger(req.params.id);

      const viewerId =
        positiveInteger(req.user?.id);

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          message:
            "Notification ID is invalid.",
        });
      }

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      await ensureNotificationReceiptsTable();

      await connection.beginTransaction();

      const viewer = await loadViewer(viewerId, connection, true);

      if (!viewer || viewer.status !== "active") {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "User account was not found.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT id
          FROM notifications n
          WHERE id = ?
            AND ${notificationVisibilitySql("n")}
          LIMIT 1
          FOR UPDATE
          `,
          [
            notificationId,
            ...notificationVisibilityParameters(viewer),
          ],
        );

      if (!rows[0]) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Notification was not found.",
        });
      }

      await connection.execute(
        `
        INSERT INTO notification_receipts
        (
          notification_id,
          user_id,
          is_seen,
          seen_at,
          is_read,
          read_at
        )
        VALUES (?, ?, 1, NOW(), 1, NOW())

        ON DUPLICATE KEY UPDATE
          is_seen = 1,
          seen_at = COALESCE(seen_at, NOW()),
          is_read = 1,
          read_at = COALESCE(read_at, NOW())
        `,
        [
          notificationId,
          viewerId,
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Notification marked as read.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Read notification error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update the notification.",
      });
    } finally {
      connection.release();
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
    const connection = await db.getConnection();

    try {
      const notificationId = positiveInteger(req.params.id);
      const viewerId = positiveInteger(req.user?.id);

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is invalid.",
        });
      }

      if (!viewerId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      await ensureNotificationReceiptsTable();

      await connection.beginTransaction();

      const viewer = await loadViewer(
        viewerId,
        connection,
        true,
      );

      if (!viewer || viewer.status !== "active") {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "User account was not found.",
        });
      }

      const role = normalizeRole(viewer.role);

      const [rows] = await connection.query<any[]>(
        `
        SELECT id, created_by, barangay_id, purok_id
        FROM notifications
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [notificationId],
      );

      const notification = rows[0];

      if (!notification) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Notification was not found.",
        });
      }

      const allowed =
        role === "super_admin" ||
        (role === "admin" &&
          positiveInteger(viewer.barangay_id) !== null &&
          Number(notification.barangay_id) === Number(viewer.barangay_id)) ||
        (role === "purok_leader" &&
          Number(notification.created_by) === viewerId &&
          positiveInteger(viewer.purok_id) !== null &&
          Number(notification.purok_id) === Number(viewer.purok_id));

      if (!allowed) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Notification was not found or cannot be deleted.",
        });
      }

      await connection.execute(
        `
        DELETE FROM notification_receipts
        WHERE notification_id = ?
        `,
        [notificationId],
      );

      const [result]: any = await connection.execute(
        `
        DELETE FROM notifications
        WHERE id = ?
        `,
        [notificationId],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Notification was not found.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message: "Notification deleted.",
      });
    } catch (error) {
      await connection.rollback();

      console.error("Delete notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to delete the notification.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
