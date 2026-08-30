import { Router } from "express";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

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

      return res.json({
        success: true,
        schedules: rows,
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
 * ADD OR UPDATE COLLECTION SCHEDULE
 */
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Administrator access required.",
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

      const viewer = await getScheduleViewer(
        Number(req.user.id),
      );

      if (viewer?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "An active Barangay Captain account is required.",
        });
      }

      if (!viewer.barangay_id) {
        return res.status(400).json({
          success: false,
          message:
            "Your captain account is not assigned to a barangay.",
        });
      }

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
        requestedBarangayId !==
        Number(viewer.barangay_id)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You may only manage schedules for your assigned barangay.",
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

      await db.query(
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
          requestedBarangayId,
          day_of_week,
          normalizedStartTime,
          normalizedEndTime,
          normalizedNotes || null,
          req.user.id,
        ],
      );

      return res.status(201).json({
        success: true,
        message:
          "Collection schedule saved successfully.",
      });
    } catch (error) {
      console.error(
        "Save collection schedule error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to save collection schedule.",
      });
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
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Administrator access required.",
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

      const viewer = await getScheduleViewer(
        Number(req.user.id),
      );

      if (viewer?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "An active Barangay Captain account is required.",
        });
      }

      if (!viewer.barangay_id) {
        return res.status(400).json({
          success: false,
          message:
            "Your captain account is not assigned to a barangay.",
        });
      }

      const [result]: any =
        await db.query(
          `
          DELETE FROM barangay_collection_schedules
          WHERE id = ?
            AND barangay_id = ?
          `,
          [scheduleId, viewer.barangay_id],
        );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Collection schedule not found.",
        });
      }

      return res.json({
        success: true,
        message:
          "Collection schedule deleted successfully.",
      });
    } catch (error) {
      console.error(
        "Delete collection schedule error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to delete collection schedule.",
      });
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
