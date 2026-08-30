import express from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = express.Router();

function normalizeStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function needsCollection(status: string): boolean {
  return ["full", "overflowing", "overflow"].includes(status);
}

// GET all inspections
router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const role = String(req.user?.role || "").toLowerCase();

      if (!["purok_leader", "leader", "admin", "super_admin"].includes(role)) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view inspection records.",
        });
      }

      const conditions: string[] = [];
      const values: Array<number> = [];

      if (role === "purok_leader" || role === "leader") {
        const purokId = Number(req.user?.purok_id);

        if (!Number.isInteger(purokId) || purokId <= 0) {
          return res.status(400).json({
            success: false,
            message: "Your Purok Leader account has no assigned purok.",
          });
        }

        conditions.push("gb.purok_id = ?");
        values.push(purokId);
      } else if (role === "admin") {
        const barangayId = Number(req.user?.barangay_id);

        if (!Number.isInteger(barangayId) || barangayId <= 0) {
          return res.status(400).json({
            success: false,
            message: "Your Barangay Captain account has no assigned barangay.",
          });
        }

        conditions.push("p.barangay_id = ?");
        values.push(barangayId);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const [rows] = await db.query(`
        SELECT
          bi.id,
          bi.bin_id,
          gb.bin_code,
          gb.location_name,
          gb.latitude,
          gb.longitude,
          gb.purok_id,
          u.full_name AS inspector,
          bi.status,
          bi.estimated_fill_level,
          bi.remarks,
          bi.photo_path,
          bi.inspected_at
        FROM bin_inspections bi
        LEFT JOIN garbage_bins gb
          ON bi.bin_id = gb.id
        LEFT JOIN users u
          ON bi.purok_leader_id = u.id
        LEFT JOIN puroks p
          ON gb.purok_id = p.id
        ${whereClause}
        ORDER BY bi.inspected_at DESC
        LIMIT 500
      `, values);

      return res.json(rows);
    } catch (error) {
      console.error("Load inspections error:", error);

      return res.status(500).json({
        message: "Failed to load inspections.",
      });
    }
  },
);

// ADD inspection
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const binId = Number(req.body.bin_id);
      const status = normalizeStatus(req.body.status);
      const estimatedFillLevel = Number(
        req.body.estimated_fill_level ?? 0,
      );
      const remarks = String(req.body.remarks || "").trim();
      const photoPath = req.body.photo_path || null;
      const leaderId = req.user?.id;

      if (!["purok_leader", "leader"].includes(String(req.user?.role || "").toLowerCase())) {
        return res.status(403).json({
          success: false,
          message: "Only an assigned Purok Leader can submit bin inspections.",
        });
      }

      if (!Number.isInteger(binId) || binId <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid garbage bin is required.",
        });
      }

      if (!leaderId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated Purok Leader is required.",
        });
      }

      if (remarks.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Inspection remarks cannot exceed 2,000 characters.",
        });
      }

      if (
        photoPath !== null &&
        (typeof photoPath !== "string" ||
          photoPath.length > 255 ||
          !/^(?:https?:\/\/|data:image\/)/i.test(photoPath))
      ) {
        return res.status(400).json({
          success: false,
          message: "Inspection photo must be an HTTPS URL or image data.",
        });
      }

      const allowedStatuses = [
        "empty",
        "half_full",
        "full",
        "overflowing",
        "damaged",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid inspection status.",
        });
      }

      if (
        !Number.isInteger(estimatedFillLevel) ||
        estimatedFillLevel < 0 ||
        estimatedFillLevel > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Estimated fill level must be from 0 to 100.",
        });
      }

      const [binRows] = await connection.query<any[]>(
        `
        SELECT
          gb.id,
          gb.purok_id,
          p.barangay_id,
          gb.bin_code,
          gb.location_name
        FROM garbage_bins gb
        INNER JOIN puroks p
          ON p.id = gb.purok_id
        WHERE gb.id = ?
          AND gb.is_active = 1
        LIMIT 1
        `,
        [binId],
      );

      const bin = binRows[0];

      if (!bin) {
        return res.status(404).json({
          success: false,
          message: "Garbage bin was not found.",
        });
      }

      if (
        (req.user?.role === "purok_leader" ||
          req.user?.role === "leader") &&
        Number(req.user.purok_id) !== Number(bin.purok_id)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You can inspect only bins in your assigned purok.",
        });
      }

      await connection.beginTransaction();

      const [inspectionResult]: any =
        await connection.execute(
          `
          INSERT INTO bin_inspections (
            bin_id,
            purok_leader_id,
            status,
            estimated_fill_level,
            remarks,
            photo_path
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            binId,
            leaderId,
            status,
            estimatedFillLevel,
            remarks || null,
            photoPath,
          ],
        );

      await connection.execute(
        `
        UPDATE garbage_bins
        SET
          current_status = ?,
          last_inspected_at = NOW()
        WHERE id = ?
        `,
        [status, binId],
      );

      let collectionRequestCreated = false;

      if (needsCollection(status)) {
        const [existingRows] =
          await connection.query<any[]>(
            `
            SELECT id
            FROM collection_requests
            WHERE bin_id = ?
              AND status IN (
                'pending',
                'approved',
                'assigned',
                'in_progress'
              )
            LIMIT 1
            `,
            [binId],
          );

        if (!existingRows[0]) {
          const priority =
            status === "overflowing" || status === "overflow"
              ? "urgent"
              : "high";

          const [requestResult]: any = await connection.execute(
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
              inspectionResult.insertId,
              leaderId,
              priority,
              (
                remarks ||
                `Automatic request: ${status.replaceAll(
                  "_",
                  " ",
                )} garbage bin.`
              ).slice(0, 255),
            ],
          );

          collectionRequestCreated = true;

          await connection.execute(
            `
            INSERT INTO notifications (
              recipient_role,
              barangay_id,
              notification_type,
              priority,
              title,
              message,
              related_entity_type,
              related_entity_id,
              created_by
            )
            VALUES (
              'collector',
              ?,
              'collection',
              ?,
              ?,
              ?,
              'collection_request',
              ?,
              ?
            )
            `,
            [
              bin.barangay_id,
              priority === "urgent" ? "emergency" : "schedule",
              `${bin.bin_code} requires collection`,
              `${bin.location_name} was inspected as ${status.replaceAll("_", " ")}.`,
              requestResult.insertId,
              leaderId,
            ],
          );
        }
      }

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: collectionRequestCreated
          ? "Inspection saved and collection request created automatically."
          : "Inspection saved successfully.",
        inspectionId: inspectionResult.insertId,
        collectionRequestCreated,
      });
    } catch (error) {
      await connection.rollback();

      console.error("Save inspection error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to save inspection.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
