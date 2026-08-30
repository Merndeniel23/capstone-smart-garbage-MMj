import { Router } from "express";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireCollector(req: AuthRequest, res: any): boolean {
  if (req.user?.role !== "collector") {
    res.status(403).json({
      success: false,
      message: "Garbage Collector access is required.",
    });
    return false;
  }

  return true;
}

async function loadCollectorContext(userId: number) {
  const [rows]: any = await db.query(
    `
      SELECT
        u.id AS collector_user_id,
        u.full_name AS collector_name,
        u.barangay_id,
        b.name AS barangay_name,
        gt.id AS truck_id,
        gt.truck_code,
        gt.plate_number,
        gt.vehicle_description,
        gt.status AS truck_status
      FROM users u
      LEFT JOIN barangays b
        ON b.id = u.barangay_id
      LEFT JOIN garbage_trucks gt
        ON gt.collector_user_id = u.id
       AND gt.barangay_id = u.barangay_id
       AND gt.status = 'active'
      WHERE u.id = ?
        AND u.role = 'collector'
        AND u.status = 'active'
      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

async function loadTodaySchedule(barangayId: number) {
  const [rows]: any = await db.query(
    `
      SELECT
        s.id AS schedule_id,
        s.barangay_id,
        s.day_of_week,
        s.start_time,
        s.end_time,
        s.notes,
        s.is_active
      FROM barangay_collection_schedules s
      WHERE s.barangay_id = ?
        AND s.is_active = 1
        AND s.day_of_week = DAYNAME(CURDATE())
      LIMIT 1
    `,
    [barangayId],
  );

  return rows[0] || null;
}

async function loadTodayRun(barangayId: number, collectorUserId: number) {
  const [rows]: any = await db.query(
    `
      SELECT
        cr.id,
        cr.schedule_id,
        cr.barangay_id,
        cr.truck_id,
        cr.collector_user_id,
        cr.collection_date,
        cr.status,
        cr.started_at,
        cr.completed_at,
        cr.notes,
        cr.created_at,
        cr.updated_at
      FROM collection_runs cr
      WHERE cr.barangay_id = ?
        AND cr.collector_user_id = ?
        AND cr.collection_date = CURDATE()
      LIMIT 1
    `,
    [barangayId, collectorUserId],
  );

  return rows[0] || null;
}

router.get(
  "/today",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireCollector(req, res)) return;

      const collectorUserId = parsePositiveInteger(req.user?.id);

      if (!collectorUserId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const collector = await loadCollectorContext(collectorUserId);

      if (!collector) {
        return res.status(404).json({
          success: false,
          message: "Collector account was not found or is inactive.",
        });
      }

      const barangayId = parsePositiveInteger(collector.barangay_id);

      if (!barangayId) {
        return res.status(400).json({
          success: false,
          message: "Your Garbage Collector account has no assigned barangay.",
        });
      }

      const schedule = await loadTodaySchedule(barangayId);
      const run = await loadTodayRun(barangayId, collectorUserId);

      const [binRows]: any = await db.query(
        `
          SELECT COUNT(*) AS total
          FROM garbage_bins gb
          INNER JOIN puroks p
            ON p.id = gb.purok_id
          WHERE p.barangay_id = ?
            AND gb.is_active = 1
        `,
        [barangayId],
      );

      return res.json({
        success: true,
        hasScheduleToday: Boolean(schedule),
        collector: {
          id: Number(collector.collector_user_id),
          fullName: collector.collector_name,
        },
        barangay: {
          id: barangayId,
          name: collector.barangay_name,
        },
        truck: collector.truck_id
          ? {
              id: Number(collector.truck_id),
              truckCode: collector.truck_code,
              plateNumber: collector.plate_number,
              vehicleDescription: collector.vehicle_description,
              status: collector.truck_status,
            }
          : null,
        schedule,
        run,
        collectionPointCount: Number(binRows[0]?.total || 0),
      });
    } catch (error) {
      console.error("Load today's collection run error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load today's collection operation.",
      });
    }
  },
);

router.post(
  "/start",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      if (!requireCollector(req, res)) return;

      const collectorUserId = parsePositiveInteger(req.user?.id);

      if (!collectorUserId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      await connection.beginTransaction();

      const [collectorRows]: any = await connection.query(
        `
          SELECT
            u.id AS collector_user_id,
            u.barangay_id,
            gt.id AS truck_id,
            gt.truck_code
          FROM users u
          LEFT JOIN garbage_trucks gt
            ON gt.collector_user_id = u.id
           AND gt.barangay_id = u.barangay_id
           AND gt.status = 'active'
          WHERE u.id = ?
            AND u.role = 'collector'
            AND u.status = 'active'
          LIMIT 1
          FOR UPDATE
        `,
        [collectorUserId],
      );

      const collector = collectorRows[0];

      if (!collector) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Collector account was not found or is inactive.",
        });
      }

      const barangayId = parsePositiveInteger(collector.barangay_id);
      const truckId = parsePositiveInteger(collector.truck_id);

      if (!barangayId) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Your collector account has no assigned barangay.",
        });
      }

      if (!truckId) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message:
            "No active collection truck is assigned to your collector account and barangay.",
        });
      }

      const [scheduleRows]: any = await connection.query(
        `
          SELECT
            id,
            barangay_id,
            day_of_week,
            start_time,
            end_time,
            notes
          FROM barangay_collection_schedules
          WHERE barangay_id = ?
            AND is_active = 1
            AND day_of_week = DAYNAME(CURDATE())
          LIMIT 1
        `,
        [barangayId],
      );

      const schedule = scheduleRows[0];

      if (!schedule) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "There is no active collection schedule for your barangay today.",
        });
      }

      const [existingRows]: any = await connection.query(
        `
          SELECT id, status, started_at, completed_at
          FROM collection_runs
          WHERE barangay_id = ?
            AND collection_date = CURDATE()
          LIMIT 1
          FOR UPDATE
        `,
        [barangayId],
      );

      const existingRun = existingRows[0];

      if (existingRun) {
        await connection.rollback();

        if (existingRun.status === "completed") {
          return res.status(409).json({
            success: false,
            message: "Today's scheduled collection has already been completed.",
            run: existingRun,
          });
        }

        if (existingRun.status === "in_progress") {
          return res.status(409).json({
            success: false,
            message: "Today's scheduled collection is already in progress.",
            run: existingRun,
          });
        }

        return res.status(409).json({
          success: false,
          message: `Today's collection operation already exists with status ${existingRun.status}.`,
          run: existingRun,
        });
      }

      const notes = String(req.body?.notes || "").trim() || schedule.notes || null;

      const [result]: any = await connection.execute(
        `
          INSERT INTO collection_runs (
            schedule_id,
            barangay_id,
            truck_id,
            collector_user_id,
            collection_date,
            status,
            started_at,
            notes
          )
          VALUES (?, ?, ?, ?, CURDATE(), 'in_progress', NOW(), ?)
        `,
        [Number(schedule.id), barangayId, truckId, collectorUserId, notes],
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Today's scheduled collection has started.",
        runId: Number(result.insertId),
        status: "in_progress",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Start collection run error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to start today's collection operation.",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/complete",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      if (!requireCollector(req, res)) return;

      const collectorUserId = parsePositiveInteger(req.user?.id);
      const runId = parsePositiveInteger(req.params.id);

      if (!collectorUserId || !runId) {
        return res.status(400).json({
          success: false,
          message: "A valid collection run is required.",
        });
      }

      await connection.beginTransaction();

      const [runRows]: any = await connection.query(
        `
          SELECT
            id,
            collector_user_id,
            barangay_id,
            collection_date,
            status
          FROM collection_runs
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [runId],
      );

      const run = runRows[0];

      if (!run) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Collection operation was not found.",
        });
      }

      if (Number(run.collector_user_id) !== collectorUserId) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "This collection operation belongs to another collector.",
        });
      }

      const currentBarangayId = parsePositiveInteger(req.user?.barangay_id);

      if (
        !currentBarangayId ||
        Number(run.barangay_id) !== currentBarangayId
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Collection operation was not found in your current barangay.",
        });
      }

      const [todayRows]: any = await connection.query(`SELECT CURDATE() AS today`);
      const today = String(todayRows[0]?.today || "").slice(0, 10);
      const runDate = String(run.collection_date || "").slice(0, 10);

      if (runDate !== today) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Only today's collection operation can be completed here.",
        });
      }

      if (run.status === "completed") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "This collection operation is already completed.",
        });
      }

      if (run.status !== "in_progress") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Start the collection before marking it completed.",
        });
      }

      const [runResult]: any = await connection.execute(
        `
          UPDATE collection_runs
          SET
            status = 'completed',
            completed_at = NOW()
          WHERE id = ?
            AND status = 'in_progress'
        `,
        [runId],
      );

      if (Number(runResult.affectedRows) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "The collection operation changed. Refresh and try again.",
        });
      }

      const [requestResult]: any = await connection.execute(
        `
          UPDATE collection_requests cr
          INNER JOIN garbage_bins gb ON gb.id = cr.bin_id
          INNER JOIN puroks p ON p.id = gb.purok_id
          SET
            cr.status = 'completed',
            cr.assigned_collector_id = COALESCE(
              cr.assigned_collector_id,
              ?
            ),
            cr.completed_at = NOW()
          WHERE p.barangay_id = ?
            AND cr.status IN ('pending', 'approved', 'assigned', 'in_progress')
        `,
        [collectorUserId, currentBarangayId],
      );

      const [binResult]: any = await connection.execute(
        `
          UPDATE garbage_bins gb
          INNER JOIN puroks p ON p.id = gb.purok_id
          SET
            gb.current_status = 'empty',
            gb.condition_status = CASE
              WHEN gb.condition_status IN ('needs_repair', 'out_of_service')
                THEN gb.condition_status
              ELSE 'good'
            END
          WHERE p.barangay_id = ?
            AND gb.is_active = 1
        `,
        [currentBarangayId],
      );

      await connection.commit();

      return res.json({
        success: true,
        message: "Today's scheduled barangay collection was completed.",
        status: "completed",
        completedRequests: Number(requestResult.affectedRows || 0),
        resetBins: Number(binResult.affectedRows || 0),
      });
    } catch (error) {
      await connection.rollback();
      console.error("Complete collection run error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to complete today's collection operation.",
      });
    } finally {
      connection.release();
    }
  },
);

router.get(
  "/history",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireCollector(req, res)) return;

      const collectorUserId = parsePositiveInteger(req.user?.id);

      if (!collectorUserId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const [rows]: any = await db.query(
        `
          SELECT
            cr.id,
            cr.collection_date,
            cr.status,
            cr.started_at,
            cr.completed_at,
            cr.notes,
            b.name AS barangay_name,
            gt.truck_code,
            gt.plate_number
          FROM collection_runs cr
          LEFT JOIN barangays b
            ON b.id = cr.barangay_id
          LEFT JOIN garbage_trucks gt
            ON gt.id = cr.truck_id
          WHERE cr.collector_user_id = ?
          ORDER BY cr.collection_date DESC, cr.id DESC
          LIMIT 30
        `,
        [collectorUserId],
      );

      return res.json({
        success: true,
        runs: rows,
      });
    } catch (error) {
      console.error("Load collection run history error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load collection history.",
      });
    }
  },
);

export default router;
