import { Router } from "express";
import { db } from "../config/db.js";
import { audit, DomainError, positiveId, requiredText, transaction } from "../services/sgms.js";
import { collectionRunProgress, collectorPurokScope, lockCollector, requireCollectionSetup } from "../services/collectorAssignments.js";
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

      await requireCollectionSetup();
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

      const assignment = collectorPurokScope(req.user!, "gb.purok_id");
      const [binRows]: any = await db.query(
        `
          SELECT COUNT(*) AS total
          FROM garbage_bins gb
          INNER JOIN puroks p
            ON p.id = gb.purok_id
          JOIN household_bins hb ON hb.bin_id = gb.id JOIN users u ON u.id = hb.resident_id
          WHERE p.barangay_id = ?
            AND gb.is_active = 1
            AND ${assignment.sql}
            AND gb.archived_at IS NULL AND u.archived_at IS NULL AND u.role = 'resident' AND u.status = 'active'
            AND u.purok_id = gb.purok_id AND u.barangay_id = p.barangay_id
        `,
        [barangayId, ...assignment.values],
      );

      const [assignedPuroks] = await db.query<any[]>(`SELECT p.id, p.name FROM puroks p
        JOIN collector_purok_assignments a ON a.purok_id = p.id
        WHERE a.collector_id = ? AND a.is_active = 1 AND p.barangay_id = ? AND p.archived_at IS NULL ORDER BY p.name`, [collectorUserId, barangayId]);
      const progress = run ? await collectionRunProgress(Number(run.id), collectorUserId, barangayId) : null;

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
        collectionPointCount: progress ? progress.required : Number(binRows[0]?.total || 0),
        assignedPuroks,
        progress,
      });
    } catch (error) {
      console.error("Load today's collection run error:", error);

      return res.status(error instanceof DomainError ? error.status : 500).json({
        success: false,
        message: error instanceof DomainError ? error.message : "Unable to load today's collection operation.",
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

      await lockCollector(connection, req.user!);

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

      const [puroks] = await connection.query<any[]>(`SELECT p.id FROM puroks p
        JOIN collector_purok_assignments a ON a.purok_id = p.id
        WHERE a.collector_id = ? AND a.is_active = 1 AND p.barangay_id = ? AND p.archived_at IS NULL FOR UPDATE`, [collectorUserId, barangayId]);
      if (!puroks.length) throw new DomainError("Ask your Barangay Admin to assign Puroks before starting collection.", 409);
      const assignment = collectorPurokScope(req.user!, "gb.purok_id");
      const [bins] = await connection.query<any[]>(`SELECT gb.id AS bin_id, hb.resident_id, gb.purok_id FROM household_bins hb
        JOIN garbage_bins gb ON gb.id = hb.bin_id JOIN users u ON u.id = hb.resident_id JOIN puroks p ON p.id = gb.purok_id
        WHERE gb.is_active = 1 AND gb.archived_at IS NULL AND u.status = 'active' AND u.role = 'resident' AND u.archived_at IS NULL
          AND u.purok_id = gb.purok_id AND u.barangay_id = p.barangay_id AND p.barangay_id = ? AND p.archived_at IS NULL
          AND ${assignment.sql} FOR UPDATE`, [barangayId, ...assignment.values]);
      if (!bins.length) throw new DomainError("No active registered household bins are available in your assigned Puroks.", 409);
      const [conflicts] = await connection.query<any[]>(`SELECT cr.id FROM collection_requests cr
        WHERE cr.bin_id IN (${bins.map(() => "?").join(",")}) AND cr.status IN ('pending','approved','assigned','in_progress')
          AND cr.assigned_collector_id IS NOT NULL AND cr.assigned_collector_id <> ? LIMIT 1 FOR UPDATE`, [...bins.map(bin => bin.bin_id), collectorUserId]);
      if (conflicts[0]) throw new DomainError("A required bin has an unfinished task assigned to another Collector. Request an authorized task review before starting the run.", 409);

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

      const runId = Number(result.insertId);
      for (const purok of puroks) await connection.execute("INSERT INTO collection_run_puroks (run_id,purok_id) VALUES (?,?)", [runId, purok.id]);
      await connection.execute(`INSERT INTO collection_run_bins (run_id,bin_id,resident_id,purok_id) VALUES ${bins.map(() => "(?,?,?,?)").join(",")}`,
        bins.flatMap(bin => [runId, bin.bin_id, bin.resident_id, bin.purok_id]));
      await audit(connection, req.user!, "collection_run_started", "collection_runs", runId, {barangay_id: barangayId}, {purokIds: puroks.map(p => p.id), requiredBins: bins.length});

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

      return res.status(error instanceof DomainError ? error.status : 500).json({
        success: false,
        message: error instanceof DomainError ? error.message : "Unable to start today's collection operation.",
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

      await lockCollector(connection, req.user!);

      const [runRows]: any = await connection.query(
        `
          SELECT
            id,
            collector_user_id,
            barangay_id,
            collection_date,
            collection_date = CURDATE() AS is_today,
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

      if (!Number(run.is_today)) {
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

      const [coverage] = await connection.query<any[]>(`SELECT rp.purok_id FROM collection_run_puroks rp
        JOIN puroks p ON p.id = rp.purok_id
        WHERE rp.run_id = ? AND p.barangay_id = ? FOR UPDATE`, [runId, currentBarangayId]);
      if (!coverage.length) throw new DomainError("This run has no saved Purok coverage. Historical coverage will not be guessed; request an authorized records review.", 409);
      const assignment = collectorPurokScope(req.user!, "rp.purok_id");
      const [revoked] = await connection.query<any[]>(`SELECT rp.purok_id FROM collection_run_puroks rp
        WHERE rp.run_id = ? AND NOT (${assignment.sql}) LIMIT 1`, [runId, ...assignment.values]);
      if (revoked.length) throw new DomainError("The run's Purok authorization changed. Request an authorized review.", 409);
      const progress = await collectionRunProgress(runId, collectorUserId, currentBarangayId, connection);
      if (!progress.required || progress.remaining) throw new DomainError(`Collection is incomplete: ${progress.remaining} of ${progress.required} required bins still need a verified QR result. Not Collected requires a reason.`, 409);

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

      await audit(connection, req.user!, "collection_run_completed", "collection_runs", runId, {barangay_id: currentBarangayId}, progress);
      await connection.commit();

      return res.json({
        success: true,
        message: "Run completed. Every required bin has a verified result; Not Collected bins and their requests remain unchanged.",
        status: "completed",
        progress,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Complete collection run error:", error);

      return res.status(error instanceof DomainError ? error.status : 500).json({
        success: false,
        message: error instanceof DomainError ? error.message : "Unable to complete today's collection operation.",
      });
    } finally {
      connection.release();
    }
  },
);

// Recovery closes an unusable active run, never completes or reopens it.
router.get("/recovery", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== "admin" || !req.user.barangay_id) throw new DomainError("Only your assigned Barangay Admin can recover collection runs.", 403);
    await requireCollectionSetup();
    const [runs] = await db.query<any[]>(`SELECT r.id, r.collection_date, r.collector_user_id, u.full_name AS collector_name,
      r.collection_date < CURDATE() AS overnight,
      (NOT EXISTS(SELECT 1 FROM collection_run_puroks rp WHERE rp.run_id = r.id)
        OR NOT EXISTS(SELECT 1 FROM collection_run_bins rb WHERE rb.run_id = r.id)) AS missing_coverage
      FROM collection_runs r LEFT JOIN users u ON u.id = r.collector_user_id
      WHERE r.barangay_id = ? AND r.status = 'in_progress' AND r.collection_date <= CURDATE()
        AND (r.collection_date < CURDATE() OR NOT EXISTS(SELECT 1 FROM collection_run_puroks rp WHERE rp.run_id = r.id)
          OR NOT EXISTS(SELECT 1 FROM collection_run_bins rb WHERE rb.run_id = r.id)) ORDER BY r.collection_date, r.id`, [req.user.barangay_id]);
    res.json({runs});
  } catch (error) {
    res.status(error instanceof DomainError ? error.status : 500).json({message: error instanceof DomainError ? error.message : "Unable to list recoverable runs."});
  }
});

router.post("/:id/recover", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== "admin" || !req.user.barangay_id) throw new DomainError("Only your assigned Barangay Admin can recover collection runs.", 403);
    await requireCollectionSetup();
    const id = positiveId(req.params.id), reason = requiredText(req.body.reason, 1000);
    await transaction(async connection => {
      const [admins] = await connection.query<any[]>("SELECT id FROM users WHERE id = ? AND role = 'admin' AND status = 'active' AND barangay_id = ? AND archived_at IS NULL FOR UPDATE", [req.user!.id, req.user!.barangay_id]);
      if (!admins[0]) throw new DomainError("Your active Barangay Admin assignment is required.", 403);
      const [owners] = await connection.query<any[]>("SELECT collector_user_id FROM collection_runs WHERE id = ? AND barangay_id = ?", [id, req.user!.barangay_id]);
      if (!owners[0]) throw new DomainError("Collection run not found in your barangay.", 404);
      // Same Collector -> run lock order as QR submission/completion. A former
      // Collector may now be inactive/reassigned; this does not grant them access.
      await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [owners[0].collector_user_id]);
      const [runs] = await connection.query<any[]>(`SELECT id, collector_user_id, barangay_id, status, collection_date, started_at, completed_at,
        collection_date < CURDATE() AS overnight, collection_date > CURDATE() AS future_run
        FROM collection_runs WHERE id = ? AND barangay_id = ? FOR UPDATE`, [id, req.user!.barangay_id]);
      const run = runs[0];
      if (!run || Number(run.collector_user_id) !== Number(owners[0].collector_user_id) || run.status !== "in_progress" || Number(run.future_run)) throw new DomainError("Only an eligible active legacy/overnight run can be recovered.", 409);
      const [puroks] = await connection.query<any[]>("SELECT purok_id FROM collection_run_puroks WHERE run_id = ? FOR UPDATE", [id]);
      const [bins] = await connection.query<any[]>("SELECT bin_id FROM collection_run_bins WHERE run_id = ? FOR UPDATE", [id]);
      const missingCoverage = !puroks.length || !bins.length;
      if (!Number(run.overnight) && !missingCoverage) throw new DomainError("Today's run has saved coverage. Complete it through verified bin results; it is not eligible for administrative recovery.", 409);
      const [results] = await connection.query<any[]>("SELECT id FROM household_collections WHERE run_id = ? FOR UPDATE", [id]);
      const [changed]: any = await connection.execute("UPDATE collection_runs SET status = 'cancelled' WHERE id = ? AND status = 'in_progress'", [id]);
      if (Number(changed.affectedRows) !== 1) throw new DomainError("The run changed. Refresh before recovery.", 409);
      await audit(connection, req.user!, "collection_run_recovered", "collection_runs", id, {barangay_id: Number(run.barangay_id)}, {
        reason, previousStatus: run.status, recoveryStatus: "cancelled", collectionDate: run.collection_date,
        previousStartedAt: run.started_at, previousCompletedAt: run.completed_at,
        overnight: Boolean(Number(run.overnight)), missingCoverage, requiredBins: bins.length, preservedResults: results.length,
      });
    });
    res.json({status: "cancelled", message: "Run closed as cancelled, not completed. Evidence, bins and requests are unchanged. The same-day run slot remains reserved."});
  } catch (error) {
    res.status(error instanceof DomainError ? error.status : 500).json({message: error instanceof DomainError ? error.message : "Unable to recover the run."});
  }
});

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
