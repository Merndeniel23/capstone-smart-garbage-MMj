import { Router } from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

const allowedStatuses = [
  "pending",
  "approved",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;

type CollectionStatus = (typeof allowedStatuses)[number];

function normalizeRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "leader") return "purok_leader";
  if (role === "household") return "resident";
  return role;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function canViewRequests(role?: string): boolean {
  return (
    role === "admin" ||
    role === "super_admin" ||
    role === "collector" ||
    role === "purok_leader" ||
    role === "leader"
  );
}

router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!canViewRequests(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to view collection requests.",
        });
      }

      let sql = `
        SELECT
          cr.id,
          cr.bin_id,
          cr.inspection_id,
          cr.requested_by,
          cr.priority,
          cr.status,
          cr.reason,
          cr.assigned_collector_id,
          cr.requested_at,
          cr.completed_at,
          cr.created_at,

          gb.bin_code,
          gb.location_name,
          gb.latitude,
          gb.longitude,
          gb.current_status,
          gb.condition_status,
          gb.purok_id,

          p.name AS purok_name,
          b.name AS barangay_name,

          requester.full_name AS requested_by_name,
          collector.full_name AS assigned_collector_name

        FROM collection_requests cr
        INNER JOIN garbage_bins gb ON gb.id = cr.bin_id
        LEFT JOIN puroks p ON p.id = gb.purok_id
        LEFT JOIN barangays b ON b.id = p.barangay_id
        LEFT JOIN users requester ON requester.id = cr.requested_by
        LEFT JOIN users collector ON collector.id = cr.assigned_collector_id
      `;

      const params: number[] = [];

      const role = normalizeRole(req.user?.role);

      if (role === "collector") {
        if (!req.user!.barangay_id) {
          return res.status(400).json({
            success: false,
            message:
              "Your Garbage Collector account has no assigned barangay.",
          });
        }

        sql += `
          WHERE b.id = ?
            AND (
              cr.assigned_collector_id IS NULL
              OR cr.assigned_collector_id = ?
            )
        `;
        params.push(
          Number(req.user!.barangay_id),
          Number(req.user!.id),
        );
      } else if (role === "purok_leader") {
        if (!req.user!.purok_id) {
          return res.status(400).json({
            success: false,
            message:
              "Your Purok Leader account has no assigned purok.",
          });
        }

        sql += ` WHERE gb.purok_id = ? `;
        params.push(req.user!.purok_id!);
      } else if (role === "admin") {
        const barangayId = positiveInteger(req.user?.barangay_id);

        if (!barangayId) {
          return res.status(400).json({
            success: false,
            message: "Your Barangay Captain account has no assigned barangay.",
          });
        }

        sql += ` WHERE b.id = ? `;
        params.push(barangayId);
      }

      sql += `
        ORDER BY
          FIELD(cr.priority, 'urgent', 'high', 'normal', 'low'),
          cr.requested_at DESC,
          cr.id DESC
      `;

      const [rows] = await db.query<any[]>(sql, params);

      return res.json({
        success: true,
        requests: rows,
      });
    } catch (error) {
      console.error("Load collection requests error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to load collection requests.",
      });
    }
  },
);

router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const role = normalizeRole(req.user?.role);

      if (
        !["purok_leader", "collector", "admin", "super_admin"].includes(
          role,
        )
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to create collection tasks.",
        });
      }

      const binId = Number(req.body.bin_id);
      const inspectionId =
        req.body.inspection_id === null ||
        req.body.inspection_id === undefined ||
        req.body.inspection_id === ""
          ? null
          : Number(req.body.inspection_id);
      const priority = String(
        req.body.priority || "normal",
      ).toLowerCase();
      const reason = String(req.body.reason || "").trim();

      if (!Number.isInteger(binId) || binId <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid garbage bin is required.",
        });
      }

      if (
        !["low", "normal", "high", "urgent"].includes(
          priority,
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Priority must be low, normal, high, or urgent.",
        });
      }

      if (reason.length > 255) {
        return res.status(400).json({
          success: false,
          message: "Collection-task reason cannot exceed 255 characters.",
        });
      }

      if (
        inspectionId !== null &&
        (!Number.isInteger(inspectionId) || inspectionId <= 0)
      ) {
        return res.status(400).json({
          success: false,
          message: "The linked inspection ID is invalid.",
        });
      }

      await connection.beginTransaction();

      const [binRows] = await connection.query<any[]>(
        `
        SELECT
          gb.id,
          gb.purok_id,
          p.barangay_id
        FROM garbage_bins gb
        INNER JOIN puroks p ON p.id = gb.purok_id
        WHERE gb.id = ? AND gb.is_active = 1
        LIMIT 1
        FOR UPDATE
        `,
        [binId],
      );

      const bin = binRows[0];

      if (!bin) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Garbage bin was not found.",
        });
      }

      const assignedPurokId = positiveInteger(req.user?.purok_id);
      const assignedBarangayId = positiveInteger(req.user?.barangay_id);
      const outsideScope =
        (role === "purok_leader" &&
          assignedPurokId !== Number(bin.purok_id)) ||
        (["collector", "admin"].includes(role) &&
          assignedBarangayId !== Number(bin.barangay_id));

      if (outsideScope) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Garbage bin was not found in your assigned area.",
        });
      }

      if (inspectionId !== null) {
        const [inspectionRows] = await connection.query<any[]>(
          `
          SELECT id
          FROM bin_inspections
          WHERE id = ?
            AND bin_id = ?
          LIMIT 1
          `,
          [inspectionId, binId],
        );

        if (!inspectionRows[0]) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "The linked inspection does not belong to this bin.",
          });
        }
      }

      const [existingRows] = await connection.query<any[]>(
        `
        SELECT id, status
        FROM collection_requests
        WHERE bin_id = ?
          AND status IN ('pending', 'approved', 'assigned', 'in_progress')
        ORDER BY id DESC
        LIMIT 1
        `,
        [binId],
      );

      if (existingRows.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This garbage bin already has an active collection task.",
          requestId: existingRows[0].id,
        });
      }

      const [result]: any = await connection.execute(
        `
        INSERT INTO collection_requests (
          bin_id,
          inspection_id,
          requested_by,
          priority,
          status,
          reason,
          requested_at
        )
        VALUES (?, ?, ?, ?, 'pending', ?, NOW())
        `,
        [
          binId,
          inspectionId,
          req.user!.id,
          priority,
          reason || null,
        ],
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Collection task created successfully.",
        requestId: result.insertId,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Create collection request error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to create collection request.",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/status",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const requestId = Number(req.params.id);
      const nextStatus = String(
        req.body.status || "",
      ).toLowerCase() as CollectionStatus;

      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          message:
            "A valid collection request ID is required.",
        });
      }

      if (!allowedStatuses.includes(nextStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid collection request status.",
        });
      }

      const role = normalizeRole(req.user?.role);

      if (!["admin", "super_admin", "collector"].includes(role)) {
        return res.status(403).json({
          success: false,
          message:
            "Only collectors and administrators can update request status.",
        });
      }

      await connection.beginTransaction();

      const [requestRows] = await connection.query<any[]>(
        `
        SELECT
          cr.id,
          cr.bin_id,
          cr.status,
          cr.assigned_collector_id,
          p.barangay_id
        FROM collection_requests cr
        INNER JOIN garbage_bins gb ON gb.id = cr.bin_id
        INNER JOIN puroks p ON p.id = gb.purok_id
        WHERE cr.id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [requestId],
      );

      const request = requestRows[0];

      if (!request) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Collection request was not found.",
        });
      }

      if (role === "collector") {
        if (!req.user!.barangay_id) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Your Garbage Collector account has no assigned barangay.",
          });
        }

        if (
          Number(request.barangay_id) !==
          Number(req.user!.barangay_id)
        ) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message:
              "Collection request was not found in your assigned barangay.",
          });
        }
      } else if (role === "admin") {
        const barangayId = positiveInteger(req.user?.barangay_id);

        if (!barangayId || Number(request.barangay_id) !== barangayId) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Collection request was not found in your barangay.",
          });
        }
      }

      if (
        role === "collector" &&
        request.assigned_collector_id &&
        Number(request.assigned_collector_id) !==
          Number(req.user!.id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "This collection request is assigned to another collector.",
        });
      }

      const transitions: Record<string, CollectionStatus[]> =
        role === "collector"
          ? {
              pending: ["assigned"],
              approved: ["assigned", "in_progress"],
              assigned: ["in_progress"],
              in_progress: ["completed"],
            }
          : {
              pending: ["approved", "cancelled"],
              approved: ["cancelled"],
              assigned: ["cancelled"],
            };

      if (!transitions[String(request.status)]?.includes(nextStatus)) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: `Cannot change a ${request.status} collection request to ${nextStatus}.`,
        });
      }

      const assignedCollectorId =
        role === "collector"
          ? req.user!.id
          : request.assigned_collector_id;

      const [updateResult]: any = await connection.execute(
        `
        UPDATE collection_requests
        SET
          status = ?,
          assigned_collector_id = ?,
          completed_at = CASE
            WHEN ? = 'completed' THEN NOW()
            ELSE NULL
          END
        WHERE id = ?
          AND status = ?
        `,
        [
          nextStatus,
          assignedCollectorId || null,
          nextStatus,
          requestId,
          request.status,
        ],
      );

      if (Number(updateResult.affectedRows) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "The collection request changed. Refresh and try again.",
        });
      }

      if (nextStatus === "completed") {
        await connection.execute(
          `
          UPDATE garbage_bins
          SET
            current_status = 'empty',
            condition_status = CASE
              WHEN condition_status IN ('needs_repair', 'out_of_service')
                THEN condition_status
              ELSE 'good'
            END
          WHERE id = ?
          `,
          [request.bin_id],
        );
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          nextStatus === "completed"
            ? "Collection completed and the bin was reset to empty."
            : "Collection request status updated.",
      });
    } catch (error) {
      await connection.rollback();
      console.error(
        "Update collection request status error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update collection request status.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
