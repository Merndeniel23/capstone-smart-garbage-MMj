import { Router } from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

const MAX_ACCEPTABLE_ACCURACY_METERS = 1000;

function normalizeRole(value?: string) {
  const role = String(value || "")
    .trim()
    .toLowerCase();

  if (role === "leader") return "purok_leader";
  return role;
}

function isAllowedViewer(role?: string) {
  const normalized = normalizeRole(role);

  return (
    normalized === "admin" ||
    normalized === "super_admin" ||
    normalized === "purok_leader"
  );
}

function validCoordinate(
  latitude: number,
  longitude: number,
) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * COLLECTOR ONLY
 * Save or update the logged-in collector's current location.
 */
router.put(
  "/me",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (normalizeRole(req.user?.role) !== "collector") {
        return res.status(403).json({
          success: false,
          message:
            "Only Garbage Collectors can send a live location.",
        });
      }

      const collectorId = Number(req.user?.id);
      const latitude = Number(req.body.latitude);
      const longitude = Number(req.body.longitude);

      const accuracyMeters =
        req.body.accuracyMeters === undefined ||
        req.body.accuracyMeters === null
          ? null
          : Number(req.body.accuracyMeters);

      const headingDegrees =
        req.body.headingDegrees === undefined ||
        req.body.headingDegrees === null
          ? null
          : Number(req.body.headingDegrees);

      const speedMps =
        req.body.speedMps === undefined ||
        req.body.speedMps === null
          ? null
          : Number(req.body.speedMps);

      const isOnDuty =
        req.body.isOnDuty === undefined
          ? true
          : Boolean(req.body.isOnDuty);

      if (
        !Number.isInteger(collectorId) ||
        collectorId <= 0
      ) {
        return res.status(401).json({
          success: false,
          message: "Collector account is invalid.",
        });
      }

      if (!validCoordinate(latitude, longitude)) {
        return res.status(400).json({
          success: false,
          message:
            "A valid latitude and longitude are required.",
        });
      }

      if (
        !Number.isFinite(accuracyMeters) ||
        accuracyMeters! >
          MAX_ACCEPTABLE_ACCURACY_METERS
      ) {
        return res.status(422).json({
          success: false,
          code: "LOCATION_TOO_INACCURATE",
          message:
            "Location accuracy is too low. Waiting for a more precise GPS fix before saving the collector location.",
          accuracyMeters:
            Number.isFinite(accuracyMeters)
              ? accuracyMeters
              : null,
          maximumAccuracyMeters:
            MAX_ACCEPTABLE_ACCURACY_METERS,
        });
      }

      const [collectorRows] =
        await db.query<any[]>(
          `
          SELECT
            id,
            role,
            status
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [collectorId],
        );

      const collector = collectorRows[0];

      if (
        !collector ||
        normalizeRole(collector.role) !== "collector"
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Garbage Collector account was not found.",
        });
      }

      if (collector.status !== "active") {
        return res.status(403).json({
          success: false,
          message:
            "Inactive collectors cannot share a live location.",
        });
      }

      await db.execute(
        `
        INSERT INTO collector_locations
        (
          collector_id,
          latitude,
          longitude,
          accuracy_meters,
          heading_degrees,
          speed_mps,
          is_on_duty,
          last_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          accuracy_meters = VALUES(accuracy_meters),
          heading_degrees = VALUES(heading_degrees),
          speed_mps = VALUES(speed_mps),
          is_on_duty = VALUES(is_on_duty),
          last_updated_at = NOW()
        `,
        [
          collectorId,
          latitude,
          longitude,
          Number.isFinite(accuracyMeters)
            ? accuracyMeters
            : null,
          Number.isFinite(headingDegrees)
            ? headingDegrees
            : null,
          Number.isFinite(speedMps)
            ? speedMps
            : null,
          isOnDuty ? 1 : 0,
        ],
      );

      if (isOnDuty) {
        await db.execute(
          `
          INSERT INTO collector_location_history
          (collector_id, latitude, longitude, accuracy_meters, heading_degrees, speed_mps, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())
          `,
          [
            collectorId,
            latitude,
            longitude,
            Number.isFinite(accuracyMeters) ? accuracyMeters : null,
            Number.isFinite(headingDegrees) ? headingDegrees : null,
            Number.isFinite(speedMps) ? speedMps : null,
          ],
        );
      }

      return res.json({
        success: true,
        message: isOnDuty
          ? "Collector location updated."
          : "Collector live tracking stopped.",
        location: {
          collectorId,
          latitude,
          longitude,
          accuracyMeters:
            Number.isFinite(accuracyMeters)
              ? accuracyMeters
              : null,
          headingDegrees:
            Number.isFinite(headingDegrees)
              ? headingDegrees
              : null,
          speedMps:
            Number.isFinite(speedMps)
              ? speedMps
              : null,
          isOnDuty,
          lastUpdatedAt:
            new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(
        "Update collector location error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update the collector location.",
      });
    }
  },
);

/**
 * ADMIN, SUPER ADMIN, PUROK LEADER ONLY
 *
 * super_admin: all active collector locations
 * admin: collectors from the same barangay
 * purok_leader/leader: collectors from the same barangay
 */
router.get(
  "/me",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (normalizeRole(req.user?.role) !== "collector") {
        return res.status(403).json({ success: false, message: "Only Garbage Collectors can view their own location." });
      }
      const [rows] = await db.query<any[]>(
        `
        SELECT collector.id AS collector_id, collector.full_name, collector.email, collector.phone,
               collector.barangay_id, barangay.name AS barangay_name,
               CASE
                 WHEN cl.accuracy_meters IS NOT NULL
                   AND cl.accuracy_meters <= 1000
                   THEN cl.latitude
                 ELSE NULL
               END AS latitude,
               CASE
                 WHEN cl.accuracy_meters IS NOT NULL
                   AND cl.accuracy_meters <= 1000
                   THEN cl.longitude
                 ELSE NULL
               END AS longitude,
               cl.accuracy_meters,
               cl.heading_degrees,
               cl.speed_mps,
               CASE
                 WHEN cl.accuracy_meters IS NOT NULL
                   AND cl.accuracy_meters <= 1000
                   THEN cl.is_on_duty
                 ELSE 0
               END AS is_on_duty,
               cl.last_updated_at,
               CASE
                 WHEN cl.accuracy_meters IS NULL
                   OR cl.accuracy_meters > 1000
                   THEN 'unavailable'
                 WHEN cl.is_on_duty <> 1
                   THEN 'offline'
                 WHEN cl.last_updated_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                   THEN 'online'
                 WHEN cl.last_updated_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                   THEN 'idle'
                 ELSE 'offline'
               END AS location_status
        FROM users collector
        LEFT JOIN collector_locations cl ON cl.collector_id = collector.id
        LEFT JOIN barangays barangay ON barangay.id = collector.barangay_id
        WHERE collector.id = ? AND collector.role = 'collector'
        LIMIT 1
        `,
        [req.user!.id],
      );
      return res.json({ success: true, collector: rows[0] || null });
    } catch (error) {
      console.error("Load own collector location error:", error);
      return res.status(500).json({ success: false, message: "Unable to load your current location." });
    }
  },
);

router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const viewerRole =
        normalizeRole(req.user?.role);

      if (!isAllowedViewer(viewerRole)) {
        return res.status(403).json({
          success: false,
          message:
            "Only authorized administrators and Purok Leaders can view collector locations.",
        });
      }

      const viewerId = Number(req.user?.id);

      const [viewerRows] =
        await db.query<any[]>(
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
          [viewerId],
        );

      const viewer = viewerRows[0];

      if (!viewer || viewer.status !== "active") {
        return res.status(403).json({
          success: false,
          message:
            "Your account is inactive or unavailable.",
        });
      }

      const isSuperAdmin =
        normalizeRole(viewer.role) === "super_admin";

      const barangayId =
        viewer.barangay_id === null ||
        viewer.barangay_id === undefined
          ? null
          : Number(viewer.barangay_id);

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message:
            "Your account has no assigned barangay.",
        });
      }

      let whereClause = `
        WHERE collector.role = 'collector'
          AND collector.status = 'active'
          AND cl.is_on_duty = 1
          AND cl.accuracy_meters IS NOT NULL
          AND cl.accuracy_meters <= 1000
      `;

      const params: number[] = [];

      if (!isSuperAdmin) {
        whereClause +=
          " AND collector.barangay_id = ?";
        params.push(barangayId!);
      }

      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            collector.id AS collector_id,
            collector.full_name,
            collector.email,
            collector.phone,
            collector.barangay_id,
            barangay.name AS barangay_name,

            cl.latitude,
            cl.longitude,
            cl.accuracy_meters,
            cl.heading_degrees,
            cl.speed_mps,
            cl.is_on_duty,
            cl.last_updated_at,

            CASE
              WHEN cl.last_updated_at >=
                DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                THEN 'online'
              WHEN cl.last_updated_at >=
                DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                THEN 'idle'
              ELSE 'offline'
            END AS location_status

          FROM collector_locations cl

          INNER JOIN users collector
            ON collector.id = cl.collector_id

          LEFT JOIN barangays barangay
            ON barangay.id =
              collector.barangay_id

          ${whereClause}

          ORDER BY
            cl.last_updated_at DESC,
            collector.full_name ASC
          `,
          params,
        );

      return res.json({
        success: true,
        scope: isSuperAdmin
          ? "municipality"
          : "barangay",
        collectors: rows,
      });
    } catch (error) {
      console.error(
        "Load collector locations error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load collector locations.",
      });
    }
  },
);

/**
 * COLLECTOR ONLY
 * Mark collector as off duty without deleting the last known point.
 */
router.get(
  "/history",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const role = normalizeRole(req.user?.role);
      const requestedCollectorId = req.query.collectorId === undefined ? null : Number(req.query.collectorId);
      let allowedCollectorIds: number[] = [];

      if (role === "collector") {
        allowedCollectorIds = [Number(req.user!.id)];
      } else if (isAllowedViewer(role)) {
        const [viewerRows] = await db.query<any[]>(
          `SELECT id, role, barangay_id, status FROM users WHERE id = ? LIMIT 1`,
          [req.user!.id],
        );
        const viewer = viewerRows[0];
        if (!viewer || viewer.status !== "active") {
          return res.status(403).json({ success: false, message: "Your account is inactive or unavailable." });
        }
        const isSuperAdmin = normalizeRole(viewer.role) === "super_admin";
        if (isSuperAdmin) {
          const [collectorRows] = await db.query<any[]>(
            `SELECT id FROM users WHERE role = 'collector' AND status = 'active'`,
          );
          allowedCollectorIds = collectorRows.map((row) => Number(row.id));
        } else {
          const barangayId = Number(viewer.barangay_id);
          if (!barangayId) {
            return res.status(400).json({ success: false, message: "Your account has no assigned barangay." });
          }
          const [collectorRows] = await db.query<any[]>(
            `SELECT id FROM users WHERE role = 'collector' AND status = 'active' AND barangay_id = ?`,
            [barangayId],
          );
          allowedCollectorIds = collectorRows.map((row) => Number(row.id));
        }
      } else {
        return res.status(403).json({ success: false, message: "You do not have permission to view route history." });
      }

      if (requestedCollectorId && !allowedCollectorIds.includes(requestedCollectorId)) {
        return res.status(403).json({ success: false, message: "You cannot view this collector's route history." });
      }

      const selectedIds = requestedCollectorId ? [requestedCollectorId] : allowedCollectorIds;
      if (selectedIds.length === 0) {
        return res.json({ success: true, history: [] });
      }

      const placeholders = selectedIds.map(() => "?").join(",");
      const [rows] = await db.query<any[]>(
        `
        SELECT h.id, h.collector_id, u.full_name, h.latitude, h.longitude,
               h.accuracy_meters, h.heading_degrees, h.speed_mps, h.recorded_at
        FROM collector_location_history h
        INNER JOIN users u ON u.id = h.collector_id
        WHERE h.collector_id IN (${placeholders})
          AND h.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND h.accuracy_meters IS NOT NULL
          AND h.accuracy_meters <= 1000
        ORDER BY h.collector_id ASC, h.recorded_at ASC
        LIMIT 2000
        `,
        selectedIds,
      );
      return res.json({ success: true, history: rows });
    } catch (error) {
      console.error("Load collector route history error:", error);
      return res.status(500).json({ success: false, message: "Unable to load collector route history." });
    }
  },
);

router.patch(
  "/me/off-duty",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (normalizeRole(req.user?.role) !== "collector") {
        return res.status(403).json({
          success: false,
          message:
            "Only Garbage Collectors can stop their own tracking.",
        });
      }

      await db.execute(
        `
        UPDATE collector_locations
        SET
          is_on_duty = 0,
          last_updated_at = NOW()
        WHERE collector_id = ?
        `,
        [req.user!.id],
      );

      return res.json({
        success: true,
        message:
          "Collector live tracking stopped.",
      });
    } catch (error) {
      console.error(
        "Stop collector tracking error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to stop collector live tracking.",
      });
    }
  },
);

export default router;