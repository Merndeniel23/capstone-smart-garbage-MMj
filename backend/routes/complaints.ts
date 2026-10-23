import { Router } from "express";
import crypto from "crypto";
import { db } from "../config/db.js";
import { activeRecord, audit, DomainError, revisionsEnabled } from "../services/sgms.js";
import type { PoolConnection } from "mysql2/promise";
import { collectorHasPurok, collectorPurokScope, refreshCollectorScope } from "../services/collectorAssignments.js";
import {
  deleteStoredProof,
  imageExtensionForDataUrl,
  isCloudStorageConfigured,
  signedProofUrl,
  storeProof,
} from "../config/storage.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

// Soft deletes that work without the SGMS migration:
// - complaint_archives: the Admin archives a complaint for everyone. The
//   migration moves these rows into complaints.archived_at.
// - complaint_user_archives: a Collector removes a finished complaint from
//   their own list only; the Admin keeps the full record.
let complaintArchives: Promise<void> | null = null;
function ensureComplaintArchives() {
  if (!complaintArchives) {
    complaintArchives = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS complaint_archives (
          complaint_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          archived_by INT UNSIGNED NOT NULL,
          archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS complaint_user_archives (
          complaint_id BIGINT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (complaint_id, user_id)
        ) ENGINE=InnoDB
      `);
    })().catch((error) => {
      complaintArchives = null;
      throw error;
    });
  }
  return complaintArchives;
}

router.use("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  if (!revisionsEnabled() || !/^\d+$/.test(String(req.params.id))) return next();
  try {
    const [rows] = await db.query<any[]>("SELECT c.admin_only,c.reported_by,c.archived_at,p.barangay_id FROM complaints c LEFT JOIN puroks p ON p.id = c.purok_id WHERE c.id = ?", [req.params.id]);
    const complaint = rows[0];
    if (complaint?.archived_at) return res.status(404).json({message: "Complaint not found."});
    if (Number(complaint?.admin_only)) {
      const user = req.user!;
      if (!(user.role === "super_admin" || (user.role === "admin" && user.barangay_id && Number(user.barangay_id) === Number(complaint.barangay_id)) || (user.role === "resident" && user.id === Number(complaint.reported_by)))) return res.status(404).json({message: "Complaint not found."});
      if (req.path === "/assign") return res.status(409).json({message: "Resident complaints are investigated directly by the Admin and cannot be assigned to a Collector."});
    }
    next();
  } catch { res.status(500).json({message: "Unable to check complaint access."}); }
});

type ComplaintStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "resolved"
  | "cancelled";

type DatabaseUser = {
  id: number;
  role: string;
  purok_id: number | null;
  barangay_id: number | null;
  email: string;
  status: string;
};

type ComplaintScopeRecord = {
  reported_by: number;
  assigned_collector_id: number | null;
  purok_id: number;
  barangay_id: number | null;
};

function normalizeRole(role?: string): string {
  const value = String(role || "")
    .trim()
    .toLowerCase();

  if (value === "household") return "resident";
  if (value === "leader") return "purok_leader";
  if (value === "super admin") return "super_admin";

  return value;
}

function isAdmin(role?: string): boolean {
  const value = normalizeRole(role);

  return value === "admin" || value === "super_admin";
}

function isSuperAdmin(role?: string): boolean {
  return normalizeRole(role) === "super_admin";
}

function isCollector(role?: string): boolean {
  return normalizeRole(role) === "collector";
}

function isPurokLeader(role?: string): boolean {
  return normalizeRole(role) === "purok_leader";
}

function isResident(role?: string): boolean {
  return normalizeRole(role) === "resident";
}

function parsePositiveInteger(
  value: unknown,
): number | null {
  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

function normalizeStatus(
  value: unknown,
): ComplaintStatus | null {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");

  const allowed: ComplaintStatus[] = [
    "pending",
    "assigned",
    "in_progress",
    "completed",
    "resolved",
    "cancelled",
  ];

  return allowed.includes(
    status as ComplaintStatus,
  )
    ? (status as ComplaintStatus)
    : null;
}

/**
 * Authentication middleware has already reloaded this account from MySQL,
 * so authorization uses its fresh role, tenant, and status values directly.
 */
function getCurrentDatabaseUser(
  req: AuthRequest,
): DatabaseUser | null {
  const userId = parsePositiveInteger(
    req.user?.id,
  );

  if (!userId) return null;

  return {
    id: userId,
    role: normalizeRole(req.user?.role),
    purok_id: parsePositiveInteger(req.user?.purok_id),
    barangay_id: parsePositiveInteger(req.user?.barangay_id),
    email: String(req.user?.email || ""),
    status: String(req.user?.status || ""),
  };
}

async function canAccessComplaint(
  viewer: DatabaseUser,
  complaint: ComplaintScopeRecord,
  connection?: PoolConnection,
): Promise<boolean> {
  const role = normalizeRole(viewer.role);

  if (isSuperAdmin(role)) return true;

  if (role === "admin") {
    return (
      viewer.barangay_id !== null &&
      complaint.barangay_id !== null &&
      Number(complaint.barangay_id) === viewer.barangay_id
    );
  }

  if (isPurokLeader(role)) {
    return (
      viewer.purok_id !== null &&
      Number(complaint.purok_id) === viewer.purok_id
    );
  }

  if (isCollector(role)) {
    if (Number(complaint.assigned_collector_id) !== viewer.id || !viewer.barangay_id || Number(complaint.barangay_id) !== viewer.barangay_id) return false;
    return collectorHasPurok(viewer, Number(complaint.purok_id), connection);
  }

  return (
    isResident(role) &&
    Number(complaint.reported_by) === viewer.id
  );
}

type ComplaintNotificationRecipient =
  | { userId: number }
  | { role: "admin" | "super_admin"; barangayId?: number | null };

async function insertComplaintNotification(
  executor: any,
  input: {
    recipient: ComplaintNotificationRecipient;
    notificationType: "new_complaint" | "complaint_message" | "complaint_update";
    title: string;
    message: string;
    complaintId: number;
    createdBy: number;
  },
) {
  const recipientUserId =
    "userId" in input.recipient
      ? input.recipient.userId
      : null;
  const recipientRole =
    "role" in input.recipient
      ? input.recipient.role
      : null;
  const barangayId =
    "barangayId" in input.recipient
      ? input.recipient.barangayId || null
      : null;

  await executor.execute(
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
    VALUES (?, ?, ?, NULL, ?, 'notice', ?, ?, 'complaint', ?, ?)
    `,
    [
      recipientUserId,
      recipientRole,
      barangayId,
      input.notificationType,
      input.title,
      input.message,
      input.complaintId,
      input.createdBy,
    ],
  );
}

async function notifyComplaintParticipants(
  executor: any,
  input: {
    complaintId: number;
    reporterId: number;
    assignedCollectorId?: number | null;
    barangayId?: number | null;
    sender: DatabaseUser;
    notificationType: "new_complaint" | "complaint_message" | "complaint_update";
    title: string;
    message: string;
  },
) {
  const recipients: ComplaintNotificationRecipient[] = [];
  if(revisionsEnabled()) {
    const [privacy]=await executor.query("SELECT admin_only FROM complaints WHERE id = ?",[input.complaintId]);
    if(Number(privacy[0]?.admin_only))input.assignedCollectorId=null;
  }

  if (input.sender.id !== input.reporterId) {
    recipients.push({ userId: input.reporterId });
  }

  if (
    input.assignedCollectorId &&
    input.sender.id !== Number(input.assignedCollectorId)
  ) {
    recipients.push({ userId: Number(input.assignedCollectorId) });
  }

  // Admins need to see messages from residents and collectors.
  if (!isAdmin(input.sender.role) && input.barangayId) {
    recipients.push({ role: "admin", barangayId: input.barangayId });
  }

  for (const recipient of recipients) {
    await insertComplaintNotification(executor, {
      recipient,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message,
      complaintId: input.complaintId,
      createdBy: input.sender.id,
    });
  }
}

// Staff a resident may file a complaint about: their own Purok Leader and the
// Collectors of their barangay.
router.get(
  "/subjects",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      if (!viewer || !isResident(viewer.role) || !revisionsEnabled()) {
        return res.json({ success: true, subjects: [] });
      }

      const [subjects]: any = await db.query(
        `SELECT id, role, full_name FROM users
         WHERE barangay_id = ? AND archived_at IS NULL AND status = 'active'
           AND (role = 'collector' OR (role = 'purok_leader' AND purok_id = ?))
         ORDER BY role DESC, full_name`,
        [viewer.barangay_id, viewer.purok_id],
      );

      return res.json({ success: true, subjects });
    } catch (error) {
      console.error("Complaint subjects error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load barangay staff.",
      });
    }
  },
);

router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      if (
        String(viewer.status).toLowerCase() !==
        "active"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your account is inactive.",
        });
      }

      const role = normalizeRole(
        viewer.role,
      );

      let whereClause = "";
      const parameters: number[] = [];

      if (isCollector(role)) {
        await refreshCollectorScope();
        const assignment = collectorPurokScope(viewer, "c.purok_id");
        whereClause = `WHERE c.assigned_collector_id = ? AND p.barangay_id = ? AND ${assignment.sql}`;
        parameters.push(viewer.id, Number(viewer.barangay_id), ...assignment.values);
      } else if (isPurokLeader(role)) {
        const purokId =
          parsePositiveInteger(
            viewer.purok_id,
          );

        if (!purokId) {
          return res.status(400).json({
            success: false,
            message:
              "Your Purok Leader account has no assigned purok.",
          });
        }

        whereClause =
          "WHERE c.purok_id = ?";
        parameters.push(purokId);
      } else if (isResident(role)) {
        whereClause =
          "WHERE c.reported_by = ?";
        parameters.push(viewer.id);
      } else if (role === "admin") {
        const barangayId =
          parsePositiveInteger(
            viewer.barangay_id,
          );

        if (!barangayId) {
          return res.status(400).json({
            success: false,
            message:
              "Your Barangay Captain account has no assigned barangay.",
          });
        }

        whereClause =
          "WHERE p.barangay_id = ?";
        parameters.push(barangayId);
      } else if (!isSuperAdmin(role)) {
        return res.status(403).json({
          success: false,
          message:
            "You are not allowed to view complaints.",
        });
      }

      if (revisionsEnabled()) whereClause += `${whereClause ? "" : "WHERE 1=1"}${activeRecord("c")}${["purok_leader","collector"].includes(role) ? " AND c.admin_only = 0" : ""}`;
      await ensureComplaintArchives();
      whereClause += `${whereClause ? " AND" : "WHERE"} NOT EXISTS (SELECT 1 FROM complaint_archives ca WHERE ca.complaint_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM complaint_user_archives cua WHERE cua.complaint_id = c.id AND cua.user_id = ?)`;
      parameters.push(viewer.id);
      const [complaintRows]: any =
        await db.query(
          `
          SELECT
            c.id,
            c.reported_by,
            reporter.full_name
              AS reporter_name,
            reporter.email
              AS reporter_email,

            c.purok_id,
            p.name AS purok_name,

            b.id AS barangay_id,
            b.name AS barangay_name,

            c.complaint_type,
            c.description,
            c.phone,
            c.photo_url,
            c.status,

            c.assigned_collector_id,
            collector.full_name
              AS assigned_collector_name,
            collector.email
              AS assigned_collector_email,

            c.resolution_remark,
            c.assigned_at,
            c.started_at,
            c.completed_at,
            c.resolved_at,
            c.created_at,
            c.updated_at
            ${revisionsEnabled() ? ", c.subject_role, subject.full_name AS subject_name" : ""}

          FROM complaints c

          INNER JOIN users reporter
            ON reporter.id = c.reported_by

          ${revisionsEnabled() ? "LEFT JOIN users subject ON subject.id = c.subject_user_id" : ""}

          LEFT JOIN puroks p
            ON p.id = c.purok_id

          LEFT JOIN barangays b
            ON b.id = p.barangay_id

          LEFT JOIN users collector
            ON collector.id =
              c.assigned_collector_id

          ${whereClause}

          ORDER BY
            c.created_at DESC,
            c.id DESC
          `,
          parameters,
        );

      const complaintIds =
        complaintRows.map(
          (row: any) =>
            Number(row.id),
        );

      let messagesByComplaint =
        new Map<number, any[]>();

      if (
        complaintIds.length > 0
      ) {
        const placeholders =
          complaintIds
            .map(() => "?")
            .join(", ");

        const [messageRows]: any =
          await db.query(
            `
            SELECT
              cm.id,
              cm.complaint_id,
              cm.sender_id,
              sender.full_name
                AS sender_name,
              sender.role
                AS sender_role,
              cm.message,
              cm.created_at

            FROM complaint_messages cm

            INNER JOIN users sender
              ON sender.id =
                cm.sender_id

            WHERE cm.complaint_id
              IN (${placeholders})

            ORDER BY
              cm.created_at ASC,
              cm.id ASC
            `,
            complaintIds,
          );

        messagesByComplaint =
          messageRows.reduce(
            (
              map:
                Map<number, any[]>,
              message: any,
            ) => {
              const complaintId =
                Number(
                  message.complaint_id,
                );

              const current =
                map.get(complaintId) ||
                [];

              current.push(message);
              map.set(
                complaintId,
                current,
              );

              return map;
            },
            new Map<
              number,
              any[]
            >(),
          );
      }

      const complaints =
        await Promise.all(
          complaintRows.map(
            async (complaint: any) => ({
              ...complaint,
              photo_url:
                await signedProofUrl(
                  complaint.photo_url,
                ),
              messages:
                messagesByComplaint.get(
                  Number(
                    complaint.id,
                  ),
                ) || [],
            }),
          ),
        );

      return res.json({
        success: true,
        viewer: {
          id: viewer.id,
          role,
          purok_id:
            viewer.purok_id,
          barangay_id:
            viewer.barangay_id,
          email: viewer.email,
        },
        complaints,
      });
    } catch (error) {
      if (error instanceof DomainError) return res.status(error.status).json({message: error.message});
      console.error(
        "Load complaints error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load complaints.",
      });
    }
  },
);

router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    let uploadedPhotoReference:
      string | null = null;

    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      if (
        !isResident(viewer.role) &&
        !isPurokLeader(viewer.role)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only residents and Purok Leaders can submit complaints.",
        });
      }

      const complaintType =
        String(
          req.body.complaint_type ||
            req.body.type ||
            "",
        ).trim();

      const description = String(
        req.body.description || "",
      ).trim();

      const phone = String(
        req.body.phone || "",
      ).trim();

      const photoInput = String(
        req.body.photo_url ||
          req.body.visualMockUrl ||
          "",
      ).trim();

      if (complaintType.length > 120 || description.length > 5000) {
        return res.status(400).json({
          success: false,
          message: "Complaint type or description is too long.",
        });
      }

      // A contact number remains optional. When provided, require the
      // Philippine 11-digit mobile format used by the frontend (09XXXXXXXXX).
      // Validate on the server as well; a client-side maxLength can be bypassed.
      if (phone && !/^09\d{9}$/.test(phone)) {
        return res.status(400).json({
          success: false,
          message: "Enter an 11-digit mobile number starting with 09 (e.g. 09123456789).",
        });
      }

      let photoReference: string | null = null;

      if (photoInput) {
        if (/^data:image\//i.test(photoInput)) {
          if (!isCloudStorageConfigured()) {
            return res.status(503).json({
              success: false,
              message:
                "Complaint image storage is not configured. Submit without a photo or configure Supabase Storage.",
            });
          }

          let extension: "png" | "jpg" | "webp";

          try {
            extension =
              imageExtensionForDataUrl(
                photoInput,
              );
          } catch {
            return res.status(400).json({
              success: false,
              message:
                "Choose a valid JPG, PNG, or WebP image up to 3.5 MB.",
            });
          }

          const storagePath =
            `complaints/${viewer.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

          try {
            photoReference =
              await storeProof(
                photoInput,
                storagePath,
              );
            uploadedPhotoReference =
              photoReference;
          } catch (storageError) {
            console.error(
              "Complaint photo upload error:",
              storageError,
            );

            return res.status(500).json({
              success: false,
              message:
                "Unable to upload the complaint photo.",
            });
          }
        } else if (/^https:\/\//i.test(photoInput)) {
          // Keep backward compatibility with older API clients that already send HTTPS evidence URLs.
          if (photoInput.length > 255) {
            return res.status(400).json({
              success: false,
              message:
                "Complaint photo URL is too long.",
            });
          }

          photoReference = photoInput;
        } else {
          return res.status(400).json({
            success: false,
            message:
              "Choose a JPG, PNG, or WebP complaint photo.",
          });
        }
      }

      const purokId =
        parsePositiveInteger(
          viewer.purok_id,
        );

      const barangayId =
        parsePositiveInteger(
          viewer.barangay_id,
        );

      if (
        !complaintType ||
        !description
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Complaint type and description are required.",
        });
      }

      if (!purokId || !barangayId) {
        return res.status(400).json({
          success: false,
          message:
            "Complete your registered barangay and purok before submitting a complaint.",
        });
      }

      await connection.beginTransaction();

      const [purokRows]: any =
        await connection.query(
          `
          SELECT id, barangay_id
          FROM puroks
          WHERE id = ?
            AND barangay_id = ?
          LIMIT 1
          `,
          [purokId, barangayId],
        );

      if (!purokRows[0]) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Your registered purok does not belong to your barangay.",
        });
      }

      // A resident may complain about their own Purok Leader or a Collector
      // of their barangay. Such complaints go straight to the Admin.
      const subjectUserId = parsePositiveInteger(req.body.subject_user_id);
      let subject: { id: number; role: string; full_name: string } | null = null;

      if (subjectUserId) {
        if (!revisionsEnabled() || !isResident(viewer.role)) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Only residents can file a complaint about a Purok Leader or Collector.",
          });
        }

        const [subjectRows]: any = await connection.query(
          `SELECT id, role, full_name FROM users
           WHERE id = ? AND barangay_id = ? AND archived_at IS NULL
             AND (role = 'collector' OR (role = 'purok_leader' AND purok_id = ?))
           LIMIT 1`,
          [subjectUserId, barangayId, purokId],
        );
        subject = subjectRows[0] || null;

        if (!subject) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Choose your Purok Leader or a Collector of your barangay.",
          });
        }
      }

      const [result]: any =
        await connection.execute(
          `
          INSERT INTO complaints
          (
            reported_by,
            purok_id,
            complaint_type,
            description,
            phone,
            photo_url,
            status
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'pending'
          )
          `,
          [
            viewer.id,
            purokId,
            complaintType,
            description,
            phone || null,
            photoReference,
          ],
        );

      if (revisionsEnabled()) {
        if (viewer.role === "resident") await connection.execute("UPDATE complaints SET admin_only = 1 WHERE id = ?", [Number(result.insertId)]);
        if (subject) await connection.execute("UPDATE complaints SET subject_user_id = ?, subject_role = ? WHERE id = ?", [subject.id, subject.role, Number(result.insertId)]);
        await audit(connection, req.user!, "complaint_submitted", "complaints", Number(result.insertId), {barangay_id: barangayId, purok_id: purokId, resident_id: viewer.role === "resident" ? viewer.id : null}, subject ? {subjectRole: subject.role, subjectName: subject.full_name} : null);
      }
      await notifyComplaintParticipants(connection, {
        complaintId: Number(result.insertId),
        reporterId: viewer.id,
        barangayId,
        sender: viewer,
        notificationType: "new_complaint",
        title: subject ? "Complaint about barangay staff" : "New sanitation complaint",
        message: subject
          ? `A resident filed a ${complaintType} complaint about ${subject.role === "purok_leader" ? "Purok Leader" : "Collector"} ${subject.full_name}. Resolve it in Complaints & Tickets.`
          : `${
              isPurokLeader(viewer.role)
                ? "A Purok Leader"
                : "A resident"
            } submitted a ${complaintType} complaint. Review and assign it in Complaints & Tickets.`,
      });

      await connection.execute(
        `
        INSERT INTO complaint_messages
        (
          complaint_id,
          sender_id,
          message
        )
        VALUES (?, ?, ?)
        `,
        [
          result.insertId,
          viewer.id,
          "Complaint submitted to barangay monitoring services.",
        ],
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Complaint submitted successfully.",
        complaintId:
          result.insertId,
      });
    } catch (error) {
      await connection.rollback();

      if (uploadedPhotoReference) {
        try {
          await deleteStoredProof(
            uploadedPhotoReference,
          );
        } catch (cleanupError) {
          console.error(
            "Complaint photo cleanup error:",
            cleanupError,
          );
        }
      }

      console.error(
        "Create complaint error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to submit complaint.",
      });
    } finally {
      connection.release();
    }
  },
);

// A Collector removes a finished complaint from their own list (per-user
// soft delete). The complaint and its history stay with the Admin.
router.post(
  "/:id/archive-mine",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewer = getCurrentDatabaseUser(req);
      const complaintId = parsePositiveInteger(req.params.id);

      if (!viewer || !complaintId) {
        return res.status(400).json({
          success: false,
          message: "Invalid complaint ID.",
        });
      }

      if (!isCollector(normalizeRole(viewer.role))) {
        return res.status(403).json({
          success: false,
          message: "Only Collectors can remove a complaint from their own list.",
        });
      }

      await ensureComplaintArchives();

      const [rows]: any = await db.query(
        "SELECT id, assigned_collector_id, status FROM complaints WHERE id = ? LIMIT 1",
        [complaintId],
      );
      const complaint = rows[0];

      if (!complaint || Number(complaint.assigned_collector_id) !== viewer.id) {
        return res.status(404).json({
          success: false,
          message: "Complaint was not found in your assigned list.",
        });
      }

      if (!["completed", "resolved", "cancelled"].includes(String(complaint.status))) {
        return res.status(409).json({
          success: false,
          message: "Finish the task first. Only completed or resolved complaints can be removed from your list.",
        });
      }

      await db.execute(
        "INSERT IGNORE INTO complaint_user_archives (complaint_id, user_id) VALUES (?, ?)",
        [complaintId, viewer.id],
      );

      return res.json({
        success: true,
        message: "Complaint removed from your list. The Barangay Captain keeps the full record.",
      });
    } catch (error) {
      console.error("Archive own complaint error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to remove the complaint from your list.",
      });
    }
  },
);

router.put(
  "/:id/assign",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      if (
        !viewer ||
        !isAdmin(viewer.role)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Barangay Captain access required.",
        });
      }

      const complaintId =
        parsePositiveInteger(
          req.params.id,
        );

      const collectorId =
        parsePositiveInteger(
          req.body.collector_id ??
            req.body.collectorId,
        );

      if (
        !complaintId ||
        !collectorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A valid complaint ID and collector ID are required.",
        });
      }

      await connection.beginTransaction();

      const [complaintRows]: any =
        await connection.query(
          `
          SELECT
            c.id,
            c.reported_by,
            c.purok_id,
            c.assigned_collector_id,
            c.status,
            p.barangay_id
          FROM complaints c
          LEFT JOIN puroks p
            ON p.id = c.purok_id
          WHERE c.id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [complaintId],
        );

      const complaint =
        complaintRows[0];

      if (!complaint) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found.",
        });
      }

      if (!(await canAccessComplaint(viewer, complaint, connection))) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found in your barangay.",
        });
      }

      if (!["pending", "assigned"].includes(String(complaint.status))) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only a pending or not-yet-started complaint can be assigned.",
        });
      }

      const [collectorRows]: any =
        await connection.query(
          `
          SELECT
            id,
            full_name,
            email,
            role,
            status,
            barangay_id
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [collectorId],
        );

      const collector =
        collectorRows[0];

      if (
        !collector ||
        !isCollector(
          collector.role,
        )
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The selected account is not a Garbage Collector.",
        });
      }

      if (
        String(
          collector.status,
        ).toLowerCase() !==
        "active"
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The selected Garbage Collector account is not active.",
        });
      }

      if (!await collectorHasPurok(collector, Number(complaint.purok_id), connection)) throw new DomainError("The Collector must currently be assigned to this complaint's Purok in the same barangay.", 403);
      /*
       * Prevent accidental assignment to a same-name collector
       * from another barangay.
       */
      if (
        !complaint.barangay_id ||
        !collector.barangay_id ||
        Number(collector.barangay_id) !==
          Number(complaint.barangay_id)
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The selected Garbage Collector belongs to a different barangay.",
        });
      }

      const [result]: any =
        await connection.execute(
          `
          UPDATE complaints
          SET
            assigned_collector_id = ?,
            status = 'assigned',
            assigned_at = NOW(),
            started_at = NULL,
            completed_at = NULL,
            resolved_at = NULL
          WHERE id = ?
            AND status IN ('pending', 'assigned')
          `,
          [
            collectorId,
            complaintId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found or can no longer be assigned.",
        });
      }

      await connection.execute(
        `
        INSERT INTO complaint_messages
        (
          complaint_id,
          sender_id,
          message
        )
        VALUES (?, ?, ?)
        `,
        [
          complaintId,
          viewer.id,
          `Assigned to Garbage Collector ${collector.full_name} (${collector.email}).`,
        ],
      );

      await notifyComplaintParticipants(connection, {
        complaintId,
        reporterId: Number(complaint.reported_by),
        assignedCollectorId: Number(collector.id),
        barangayId: parsePositiveInteger(complaint.barangay_id),
        sender: viewer,
        notificationType: "complaint_update",
        title: "Complaint assignment updated",
        message: `Complaint CMP-${complaintId} was assigned to ${collector.full_name}.`,
      });

      await connection.commit();

      return res.json({
        success: true,
        message:
          `Complaint assigned to ${collector.full_name}.`,
        assignedCollector: {
          id: collector.id,
          full_name:
            collector.full_name,
          email: collector.email,
        },
      });
    } catch (error) {
      await connection.rollback();

      if (error instanceof DomainError) return res.status(error.status).json({message: error.message});
      console.error(
        "Assign complaint error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to assign complaint.",
      });
    } finally {
      connection.release();
    }
  },
);

router.put(
  "/:id/status",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      const complaintId =
        parsePositiveInteger(
          req.params.id,
        );

      const status =
        normalizeStatus(
          req.body.status,
        );

      if (
        !viewer ||
        !complaintId ||
        !status
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid complaint and status values are required.",
        });
      }

      const role = normalizeRole(
        viewer.role,
      );

      if (
        !isCollector(role) ||
        !["in_progress", "completed"].includes(status)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only the assigned collector can start or complete a complaint.",
        });
      }

      await connection.beginTransaction();

      const [complaintRows]: any = await connection.query(
        `
        SELECT
          c.id,
          c.reported_by,
          c.purok_id,
          c.assigned_collector_id,
          c.status,
          p.barangay_id
        FROM complaints c
        LEFT JOIN puroks p ON p.id = c.purok_id
        WHERE c.id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [complaintId],
      );

      const complaint = complaintRows[0];

      if (!complaint || !(await canAccessComplaint(viewer, complaint, connection))) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found or is not assigned to your account.",
        });
      }

      const currentStatus = String(complaint.status);
      const legalTransition =
        (currentStatus === "assigned" && status === "in_progress") ||
        (currentStatus === "in_progress" && status === "completed");

      if (!legalTransition) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Complaint status must progress from assigned to in progress, then completed.",
        });
      }

      const [result]: any = await connection.execute(
        `
        UPDATE complaints
        SET
          status = ?,

          started_at = CASE
            WHEN ? = 'in_progress'
              THEN COALESCE(
                started_at,
                NOW()
              )
            ELSE started_at
          END,

          completed_at = CASE
            WHEN ? = 'completed'
              THEN NOW()
            ELSE completed_at
          END

        WHERE id = ?
          AND assigned_collector_id = ?
          AND status = ?
        `,
        [
          status,
          status,
          status,
          complaintId,
          viewer.id,
          currentStatus,
        ],
      );

      if (
        result.affectedRows === 0
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found or is not assigned to your account.",
        });
      }

      await connection.execute(
        `
        INSERT INTO complaint_messages
        (
          complaint_id,
          sender_id,
          message
        )
        VALUES (?, ?, ?)
        `,
        [
          complaintId,
          viewer.id,
          `Complaint status changed to ${status.replaceAll(
            "_",
            " ",
          )}.`,
        ],
      );

      await notifyComplaintParticipants(connection, {
        complaintId,
        reporterId: Number(complaint.reported_by),
        assignedCollectorId: Number(complaint.assigned_collector_id),
        barangayId: parsePositiveInteger(complaint.barangay_id),
        sender: viewer,
        notificationType: "complaint_update",
        title: "Complaint status updated",
        message: `Complaint CMP-${complaintId} status changed to ${status.replaceAll("_", " ")}.`,
      });

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Complaint status updated successfully.",
      });
    } catch (error) {
      await connection.rollback();

      if (error instanceof DomainError) return res.status(error.status).json({message: error.message});
      console.error(
        "Update complaint status error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update complaint status.",
      });
    } finally {
      connection.release();
    }
  },
);

router.put(
  "/:id/resolve",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      if (
        !viewer ||
        !isAdmin(viewer.role)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Barangay Captain access required.",
        });
      }

      const complaintId =
        parsePositiveInteger(
          req.params.id,
        );

      const remarks = String(
        req.body.remarks ||
          req.body
            .resolution_remark ||
          "",
      ).trim();

      if (!complaintId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid complaint ID.",
        });
      }

      if (!remarks) {
        return res.status(400).json({
          success: false,
          message:
            "A resolution remark is required.",
        });
      }

      await connection.beginTransaction();

      const [complaintRows]: any = await connection.query(
        `
        SELECT
          c.id,
          c.reported_by,
          c.purok_id,
          c.assigned_collector_id,
          c.status,
          p.barangay_id
        FROM complaints c
        LEFT JOIN puroks p ON p.id = c.purok_id
        WHERE c.id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [complaintId],
      );

      const complaint = complaintRows[0];

      if (!complaint || !(await canAccessComplaint(viewer, complaint, connection))) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found in your barangay.",
        });
      }

      if (!(revisionsEnabled() ? ["pending","assigned","in_progress","completed"] : ["completed"]).includes(complaint.status)) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only a collector-completed complaint can be resolved.",
        });
      }

      const [result]: any = await connection.execute(
          `
          UPDATE complaints
          SET
            status = 'resolved',
            resolution_remark = ?,
            resolved_at = NOW()
          WHERE id = ?
            AND status = ?
          `,
          [
            remarks,
            complaintId,
            complaint.status,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found or is already closed.",
        });
      }

      await audit(connection,req.user!,"complaint_resolved","complaints",complaintId,{barangay_id:complaint.barangay_id,purok_id:complaint.purok_id,resident_id:complaint.reported_by},{remarks});
      await connection.execute(
        `
        INSERT INTO complaint_messages
        (
          complaint_id,
          sender_id,
          message
        )
        VALUES (?, ?, ?)
        `,
        [
          complaintId,
          viewer.id,
          `Complaint resolved: ${remarks}`,
        ],
      );

      await notifyComplaintParticipants(connection, {
        complaintId,
        reporterId: Number(complaint.reported_by),
        assignedCollectorId: Number(complaint.assigned_collector_id),
        barangayId: parsePositiveInteger(complaint.barangay_id),
        sender: viewer,
        notificationType: "complaint_update",
        title: "Complaint resolved",
        message: `Complaint CMP-${complaintId} has been resolved.`,
      });

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Complaint resolved successfully.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Resolve complaint error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to resolve complaint.",
      });
    } finally {
      connection.release();
    }
  },
);

router.post(
  "/:id/messages",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    try {
      const viewer =
        await getCurrentDatabaseUser(req);

      const complaintId =
        parsePositiveInteger(
          req.params.id,
        );

      const message = String(
        req.body.message || "",
      ).trim();

      if (
        !viewer ||
        !complaintId ||
        !message
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Complaint and message are required.",
        });
      }

      if (message.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Complaint messages cannot exceed 2,000 characters.",
        });
      }

      await connection.beginTransaction();

      const [complaintRows]: any =
        await connection.query(
          `
          SELECT
            reported_by,
            assigned_collector_id,
            c.purok_id,
            p.barangay_id
          FROM complaints c
          LEFT JOIN puroks p ON p.id = c.purok_id
          WHERE c.id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [complaintId],
        );

      const complaint =
        complaintRows[0];

      if (!complaint) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint not found.",
        });
      }

      if (!(await canAccessComplaint(viewer, complaint, connection))) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint not found.",
        });
      }

      const [result]: any =
        await connection.execute(
          `
          INSERT INTO complaint_messages
          (
            complaint_id,
            sender_id,
            message
          )
          VALUES (?, ?, ?)
          `,
          [
            complaintId,
            viewer.id,
            message,
          ],
        );

      await notifyComplaintParticipants(connection, {
        complaintId,
        reporterId: Number(complaint.reported_by),
        assignedCollectorId: Number(complaint.assigned_collector_id),
        barangayId: parsePositiveInteger(complaint.barangay_id),
        sender: viewer,
        notificationType: "complaint_message",
        title: "New complaint message",
        message: `There is a new message on complaint CMP-${complaintId}.`,
      });

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Complaint message sent successfully.",
        messageId:
          result.insertId,
      });
    } catch (error) {
      await connection.rollback();

      if (error instanceof DomainError) return res.status(error.status).json({message: error.message});
      console.error(
        "Send complaint message error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to send complaint message.",
      });
    } finally {
      connection.release();
    }
  },
);

router.delete(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection =
      await db.getConnection();

    try {
      const viewer =
        getCurrentDatabaseUser(req);

      const complaintId =
        parsePositiveInteger(
          req.params.id,
        );

      if (
        !viewer ||
        !complaintId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid complaint ID.",
        });
      }

      const role = normalizeRole(viewer.role);

      if (!isResident(role) && !isAdmin(role)) {
        return res.status(403).json({
          success: false,
          message:
            "You are not allowed to delete or cancel complaints.",
        });
      }

      // DDL commits implicitly, so prepare the archive table before the transaction.
      await ensureComplaintArchives();
      await connection.beginTransaction();

      const [complaintRows]: any = await connection.query(
        `
        SELECT
          c.id,
          c.reported_by,
          c.purok_id,
          c.assigned_collector_id,
          c.status,
          c.photo_url,
          p.barangay_id
        FROM complaints c
        LEFT JOIN puroks p ON p.id = c.purok_id
        WHERE c.id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [complaintId],
      );

      const complaint = complaintRows[0];

      if (!complaint || !(await canAccessComplaint(viewer, complaint, connection))) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Complaint was not found or is outside your assigned area.",
        });
      }

      if (isAdmin(role)) {
        if (!["completed", "resolved"].includes(String(complaint.status))) {
          await connection.rollback();

          return res.status(409).json({
            success: false,
            message:
              "Only completed or resolved complaints can be archived.",
          });
        }

        // Soft delete only: the complaint, its messages, notifications and
        // photo are preserved; it is just hidden from complaint lists.
        const [archiveResult]: any = await connection.execute(
          "INSERT IGNORE INTO complaint_archives (complaint_id, archived_by) VALUES (?, ?)",
          [complaintId, viewer.id],
        );

        await connection.commit();

        return res.json({
          success: true,
          message: archiveResult.affectedRows
            ? "Complaint archived. Its messages and history are preserved."
            : "Complaint was already archived.",
        });
      }

      if (complaint.status !== "pending") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Residents can cancel only pending complaints.",
        });
      }

      const [result]: any = await connection.execute(
        `
        UPDATE complaints
        SET status = 'cancelled'
        WHERE id = ?
          AND status = 'pending'
        `,
        [complaintId],
      );

      if (
        result.affectedRows !== 1
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Complaint status changed before cancellation. Refresh and try again.",
        });
      }

      await connection.execute(
        `
        INSERT INTO complaint_messages
          (complaint_id, sender_id, message)
        VALUES (?, ?, ?)
        `,
        [complaintId, viewer.id, "Complaint cancelled."],
      );

      await notifyComplaintParticipants(connection, {
        complaintId,
        reporterId: Number(complaint.reported_by),
        assignedCollectorId: Number(complaint.assigned_collector_id),
        barangayId: parsePositiveInteger(complaint.barangay_id),
        sender: viewer,
        notificationType: "complaint_update",
        title: "Complaint cancelled",
        message: `Complaint CMP-${complaintId} was cancelled.`,
      });

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Complaint cancelled successfully.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Delete or cancel complaint error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update the complaint.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
