import { Router } from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

/**
 * The database uses "purok_leader", while some frontend
 * code may still use "leader". Supporting both avoids
 * breaking existing accounts during the transition.
 */
function isPurokLeader(role?: string): boolean {
  return (
    role === "purok_leader" ||
    role === "leader"
  );
}

function getAssignedPurokId(
  req: AuthRequest,
): number | null {
  const purokId = Number(
    req.user?.purok_id,
  );

  if (
    !Number.isInteger(purokId) ||
    purokId <= 0
  ) {
    return null;
  }

  return purokId;
}

function validateCoordinates(
  latitudeValue: unknown,
  longitudeValue: unknown,
): {
  latitude: number;
  longitude: number;
} | null {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

/**
 * GET GARBAGE BINS
 *
 * Purok Leader:
 * - sees only bins in the leader's assigned purok
 *
 * Admin and Collector:
 * - may view all garbage bins
 */
router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      let query = `
        SELECT
          gb.id,
          gb.bin_code,
          gb.location_name,
          gb.latitude,
          gb.longitude,
          gb.current_status,
          gb.condition_status,
          gb.last_inspected_at,
          gb.is_active,

          p.id AS purok_id,
          p.name AS purok_name,

          b.id AS barangay_id,
          b.name AS barangay_name,

          sched.day_of_week AS schedule_day,
          sched.start_time AS schedule_start_time,
          sched.end_time AS schedule_end_time,
          sched.notes AS schedule_notes,

          CASE
            WHEN sched.day_of_week = DAYNAME(CURDATE())
            THEN 1
            ELSE 0
          END AS is_scheduled_today

        FROM garbage_bins gb

        LEFT JOIN puroks p
          ON p.id = gb.purok_id

        LEFT JOIN barangays b
          ON b.id = p.barangay_id

        LEFT JOIN barangay_collection_schedules sched
          ON sched.barangay_id = b.id
         AND sched.is_active = 1
         AND sched.day_of_week = DAYNAME(CURDATE())
      `;

      const parameters: number[] = [];

      if (
        isPurokLeader(
          req.user?.role,
        )
      ) {
        const purokId =
          getAssignedPurokId(req);

        if (!purokId) {
          return res.status(400).json({
            success: false,
            message:
              "Your Purok Leader account has no assigned purok.",
          });
        }

        query += `
          WHERE gb.purok_id = ?
        `;

        parameters.push(purokId);
      } else if (req.user?.role === "collector") {
        const barangayId = Number(
          req.user?.barangay_id,
        );

        if (
          !Number.isInteger(barangayId) ||
          barangayId <= 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Your Garbage Collector account has no assigned barangay.",
          });
        }

        query += `
          WHERE b.id = ?
            AND gb.is_active = 1
        `;

        parameters.push(barangayId);
      }

      query += `
        ORDER BY gb.id DESC
      `;

      const [rows] =
        await db.query(
          query,
          parameters,
        );

      return res.json({
        success: true,
        bins: rows,
      });
    } catch (error) {
      console.error(
        "Load garbage bins error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load garbage bins.",
      });
    }
  },
);

/**
 * ADD A NEW GARBAGE BIN
 *
 * Only a Purok Leader may register a bin.
 * The purok is taken from the authenticated account,
 * not from the frontend request.
 */
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (
        !isPurokLeader(
          req.user?.role,
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Purok Leaders can register garbage-bin locations.",
        });
      }

      const purokId =
        getAssignedPurokId(req);

      if (!purokId) {
        return res.status(400).json({
          success: false,
          message:
            "Your account has no assigned purok. Ask the administrator to assign one.",
        });
      }

      const binCode = String(
        req.body.bin_code || "",
      )
        .trim()
        .toUpperCase();

      const locationName = String(
        req.body.location_name || "",
      ).trim();

      const coordinates =
        validateCoordinates(
          req.body.latitude,
          req.body.longitude,
        );

      if (
        !binCode ||
        !locationName
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Bin code and location description are required.",
        });
      }

      if (!coordinates) {
        return res.status(400).json({
          success: false,
          message:
            "Click a valid location on the map.",
        });
      }

      const [result]: any =
        await db.query(
          `
          INSERT INTO garbage_bins
          (
            purok_id,
            bin_code,
            location_name,
            latitude,
            longitude,
            current_status,
            condition_status,
            is_active
          )
          VALUES
          (?, ?, ?, ?, ?, 'empty', 'good', 1)
          `,
          [
            purokId,
            binCode,
            locationName,
            coordinates.latitude,
            coordinates.longitude,
          ],
        );

      return res.status(201).json({
        success: true,
        message:
          "Garbage bin added successfully.",
        id: result.insertId,
      });
    } catch (error: any) {
      console.error(
        "Save garbage bin error:",
        error,
      );

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "That bin code is already in use.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to save garbage bin.",
      });
    }
  },
);

/**
 * UPDATE A GARBAGE BIN
 *
 * A leader can update only a bin belonging
 * to the leader's assigned purok.
 */
router.put(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (
        !isPurokLeader(
          req.user?.role,
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Purok Leaders can update garbage-bin locations.",
        });
      }

      const binId = Number(
        req.params.id,
      );

      const purokId =
        getAssignedPurokId(req);

      if (
        !Number.isInteger(binId) ||
        binId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid garbage bin ID.",
        });
      }

      if (!purokId) {
        return res.status(400).json({
          success: false,
          message:
            "Your account has no assigned purok.",
        });
      }

      const binCode = String(
        req.body.bin_code || "",
      )
        .trim()
        .toUpperCase();

      const locationName = String(
        req.body.location_name || "",
      ).trim();

      const coordinates =
        validateCoordinates(
          req.body.latitude,
          req.body.longitude,
        );

      if (
        !binCode ||
        !locationName
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Bin code and location description are required.",
        });
      }

      if (!coordinates) {
        return res.status(400).json({
          success: false,
          message:
            "The garbage-bin coordinates are invalid.",
        });
      }

      const [result]: any =
        await db.query(
          `
          UPDATE garbage_bins
          SET
            bin_code = ?,
            location_name = ?,
            latitude = ?,
            longitude = ?
          WHERE id = ?
            AND purok_id = ?
          `,
          [
            binCode,
            locationName,
            coordinates.latitude,
            coordinates.longitude,
            binId,
            purokId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Garbage bin not found in your assigned purok.",
        });
      }

      return res.json({
        success: true,
        message:
          "Garbage bin updated successfully.",
      });
    } catch (error: any) {
      console.error(
        "Update garbage bin error:",
        error,
      );

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "That bin code is already in use.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to update garbage bin.",
      });
    }
  },
);

/**
 * DEACTIVATE A GARBAGE BIN
 *
 * This is a soft delete, so previous inspection
 * and collection records remain available.
 */
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (
        !isPurokLeader(
          req.user?.role,
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Purok Leaders can deactivate garbage bins.",
        });
      }

      const binId = Number(
        req.params.id,
      );

      const purokId =
        getAssignedPurokId(req);

      if (
        !Number.isInteger(binId) ||
        binId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid garbage bin ID.",
        });
      }

      if (!purokId) {
        return res.status(400).json({
          success: false,
          message:
            "Your account has no assigned purok.",
        });
      }

      const [result]: any =
        await db.query(
          `
          UPDATE garbage_bins
          SET is_active = 0
          WHERE id = ?
            AND purok_id = ?
          `,
          [
            binId,
            purokId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Garbage bin not found in your assigned purok.",
        });
      }

      return res.json({
        success: true,
        message:
          "Garbage bin deactivated successfully.",
      });
    } catch (error) {
      console.error(
        "Deactivate garbage bin error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to deactivate garbage bin.",
      });
    }
  },
);

export default router;