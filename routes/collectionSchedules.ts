import { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { signedProofUrl } from "../config/storage.js";

const router = Router();

type ScheduleViewer = {
  id: number;
  role: string;
  barangay_id: number | null;
};

async function getScheduleViewer(
  userId: number,
): Promise<ScheduleViewer | null> {
  const [rows] = await db.query<any[]>(
    `
    SELECT
      u.id,
      u.role,
      COALESCE(u.barangay_id, p.barangay_id) AS barangay_id
    FROM users u
    LEFT JOIN puroks p
      ON p.id = u.purok_id
    WHERE u.id = ?
      AND u.status = 'active'
    LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

/** Lock the current administrator and explicit barangay assignment for a write. */
async function getScheduleManager(userId: number, connection: PoolConnection) {
  const [rows] = await connection.query<any[]>(
    `
    SELECT u.id, u.role, u.barangay_id
    FROM users u
    INNER JOIN barangays b ON b.id = u.barangay_id
    WHERE u.id = ?
      AND u.role = 'admin'
      AND u.status = 'active'
      AND b.is_active = 1
    LIMIT 1
    FOR UPDATE
    `,
    [userId],
  );
  const manager = rows[0];
  const barangayId = Number(manager?.barangay_id);

  if (
    manager?.role !== "admin" ||
    !Number.isSafeInteger(barangayId) ||
    barangayId <= 0
  ) return null;

  return { id: Number(manager.id), barangay_id: barangayId };
}

function normalizeTime(
  value: unknown,
): string | null | undefined {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const time = String(value).trim();
  const match = time.match(
    /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
  );

  if (!match) return undefined;

  return time.length === 5 ? `${time}:00` : time;
}

/**
 * CREATE TABLE AUTOMATICALLY
 */
async function prepareScheduleTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS barangay_collection_schedules (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      barangay_id INT UNSIGNED NOT NULL,
      day_of_week ENUM(
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday'
      ) NOT NULL,
      start_time TIME NULL,
      end_time TIME NULL,
      notes VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY unique_barangay_day (
        barangay_id,
        day_of_week
      )
    )
  `);
}

/**
 * Prepare table before using routes.
 */
router.use(async (_req, res, next) => {
  try {
    await prepareScheduleTable();
    next();
  } catch (error) {
    console.error(
      "Collection schedule table error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to prepare collection schedule table.",
    });
  }
});

/**
 * GET ALL COLLECTION SCHEDULES
 */
router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewer = await getScheduleViewer(
        Number(req.user!.id),
      );

      if (!viewer) {
        return res.status(403).json({
          success: false,
          message: "An active account is required.",
        });
      }

      const supportedRoles = [
        "admin",
        "super_admin",
        "resident",
        "collector",
        "purok_leader",
      ];

      if (!supportedRoles.includes(viewer.role)) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to collection schedules.",
        });
      }

      const isSuperAdmin =
        viewer.role === "super_admin";

      const [rows] = await db.query(`
        SELECT
          schedule.id,
          schedule.barangay_id,
          barangay.name AS barangay_name,
          barangay.address AS barangay_address,
          barangay.image_url AS barangay_image_url,
          schedule.day_of_week,
          schedule.start_time,
          schedule.end_time,
          schedule.notes,
          schedule.is_active

        FROM barangay_collection_schedules schedule

        INNER JOIN barangays barangay
          ON barangay.id = schedule.barangay_id

        WHERE schedule.is_active = 1
          ${isSuperAdmin ? "" : "AND schedule.barangay_id = ?"}

        ORDER BY
          FIELD(
            schedule.day_of_week,
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
            'Sunday'
          ),
          barangay.name ASC
      `, isSuperAdmin ? [] : [viewer.barangay_id]);

      const schedules = await Promise.all(
        (rows as any[]).map(async (row) => ({
          ...row,
          barangay_image_url: await signedProofUrl(row.barangay_image_url),
        })),
      );

      return res.json({
        success: true,
        schedules,
      });
    } catch (error) {
      console.error(
        "Load collection schedules error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load collection schedules.",
      });
    }
  },
);

/**
 * ADD OR UPDATE COLLECTION SCHEDULE IN THE ADMINISTRATOR'S ASSIGNED BARANGAY
 */
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    let connection: PoolConnection | null = null;
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Barangay Administrator access required.",
        });
      }

      const {
        barangay_id,
        day_of_week,
        start_time,
        end_time,
        notes,
      } = req.body;

      const validDays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];

      const requestedBarangayId = Number(
        barangay_id,
      );
      const normalizedStartTime = normalizeTime(
        start_time,
      );
      const normalizedEndTime = normalizeTime(
        end_time,
      );
      const normalizedNotes = String(
        notes || "",
      ).trim();

      if (
        !Number.isInteger(requestedBarangayId) ||
        requestedBarangayId <= 0 ||
        !validDays.includes(day_of_week)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Barangay and collection day are required.",
        });
      }

      if (
        normalizedStartTime === undefined ||
        normalizedEndTime === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Collection times must use a valid 24-hour format.",
        });
      }

      if (
        normalizedStartTime &&
        normalizedEndTime &&
        normalizedEndTime <= normalizedStartTime
      ) {
        return res.status(400).json({
          success: false,
          message: "End time must be later than start time.",
        });
      }

      if (normalizedNotes.length > 255) {
        return res.status(400).json({
          success: false,
          message: "Schedule notes cannot exceed 255 characters.",
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      const manager = await getScheduleManager(Number(req.user.id), connection);

      if (!manager) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "An active Barangay Administrator with an assigned active barangay is required.",
        });
      }

      if (requestedBarangayId !== manager.barangay_id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "You can manage schedules only for your assigned barangay.",
        });
      }

      await connection.query(
        `
        INSERT INTO barangay_collection_schedules
        (
          barangay_id,
          day_of_week,
          start_time,
          end_time,
          notes,
          is_active,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, 1, ?)

        ON DUPLICATE KEY UPDATE
          start_time = VALUES(start_time),
          end_time = VALUES(end_time),
          notes = VALUES(notes),
          is_active = 1,
          created_by = VALUES(created_by)
        `,
        [
          manager.barangay_id,
          day_of_week,
          normalizedStartTime,
          normalizedEndTime,
          normalizedNotes || null,
          manager.id,
        ],
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Collection schedule saved successfully.",
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(
        "Save collection schedule error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to save collection schedule.",
      });
    } finally {
      connection?.release();
    }
  },
);


/**
 * UPDATE COLLECTION SCHEDULE
 * Only the assigned Barangay Administrator may edit a published schedule.
 */
router.put(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    let connection: PoolConnection | null = null;
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Barangay Administrator access required.",
        });
      }

      const scheduleId = Number(req.params.id);
      const requestedBarangayId = Number(req.body.barangay_id);
      const dayOfWeek = String(req.body.day_of_week || "");
      const normalizedStartTime = normalizeTime(req.body.start_time);
      const normalizedEndTime = normalizeTime(req.body.end_time);
      const normalizedNotes = String(req.body.notes || "").trim();

      const validDays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];

      if (
        !Number.isInteger(scheduleId) ||
        scheduleId <= 0 ||
        !Number.isInteger(requestedBarangayId) ||
        requestedBarangayId <= 0 ||
        !validDays.includes(dayOfWeek)
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid schedule, barangay, and collection day are required.",
        });
      }

      if (
        normalizedStartTime === undefined ||
        normalizedEndTime === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Collection times must use a valid 24-hour format.",
        });
      }

      if (
        normalizedStartTime &&
        normalizedEndTime &&
        normalizedEndTime <= normalizedStartTime
      ) {
        return res.status(400).json({
          success: false,
          message: "End time must be later than start time.",
        });
      }

      if (normalizedNotes.length > 255) {
        return res.status(400).json({
          success: false,
          message: "Schedule notes cannot exceed 255 characters.",
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      const manager = await getScheduleManager(Number(req.user.id), connection);

      if (!manager) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "An active Barangay Administrator with an assigned active barangay is required.",
        });
      }

      if (requestedBarangayId !== manager.barangay_id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "You can manage schedules only for your assigned barangay.",
        });
      }

      const [result]: any = await connection.execute(
        `
          UPDATE barangay_collection_schedules
          SET
            day_of_week = ?,
            start_time = ?,
            end_time = ?,
            notes = ?,
            is_active = 1,
            created_by = ?
          WHERE id = ? AND barangay_id = ?
        `,
        [
          dayOfWeek,
          normalizedStartTime,
          normalizedEndTime,
          normalizedNotes || null,
          manager.id,
          scheduleId,
          manager.barangay_id,
        ],
      );

      if (Number(result.affectedRows) !== 1) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Collection schedule not found.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message: "Collection schedule updated successfully.",
      });
    } catch (error: any) {
      if (connection) await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "That barangay already has a collection schedule for the selected weekday.",
        });
      }

      console.error("Update collection schedule error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update collection schedule.",
      });
    } finally {
      connection?.release();
    }
  },
);

/**
 * DELETE COLLECTION SCHEDULE
 */
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    let connection: PoolConnection | null = null;
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Barangay Administrator access required.",
        });
      }

      const scheduleId = Number(
        req.params.id,
      );

      if (
        !Number.isInteger(scheduleId) ||
        scheduleId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid collection schedule ID.",
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      const manager = await getScheduleManager(Number(req.user.id), connection);

      if (!manager) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "An active Barangay Administrator with an assigned active barangay is required.",
        });
      }

      const [result]: any =
        await connection.query(
          `
          DELETE FROM barangay_collection_schedules
          WHERE id = ? AND barangay_id = ?
          `,
          [scheduleId, manager.barangay_id],
        );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Collection schedule not found.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Collection schedule deleted successfully.",
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(
        "Delete collection schedule error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to delete collection schedule.",
      });
    } finally {
      connection?.release();
    }
  },
);
/**
 * GET MY BARANGAY COLLECTION SCHEDULE
 */
router.get(
  "/my-schedule",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const purokId = req.user?.purok_id;

      if (!purokId) {
        return res.status(400).json({
          success: false,
          message: "No assigned purok.",
        });
      }

      const [rows]: any = await db.query(
        `
        SELECT
          b.name AS barangay_name,
          s.day_of_week,
          s.start_time,
          s.end_time,
          s.notes

        FROM puroks p

        INNER JOIN barangays b
          ON b.id = p.barangay_id

        INNER JOIN barangay_collection_schedules s
          ON s.barangay_id = b.id

        WHERE p.id = ?

        LIMIT 1
        `,
        [purokId],
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "No collection schedule found.",
        });
      }

      return res.json({
        success: true,
        schedule: rows[0],
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "Failed to load schedule.",
      });
    }
  },
);
export default router;
