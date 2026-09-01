import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

type ManagedRole = "resident" | "purok_leader" | "collector";

function requireBarangayCaptain(req: AuthRequest, res: any): boolean {
  const role = req.user?.role;

  if (role !== "admin" && role !== "super_admin") {
    res.status(403).json({
      success: false,
      message: "Administrator access is required.",
    });
    return false;
  }

  return true;
}
function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRole(value: unknown): ManagedRole | null {
  const role = String(value || "").trim().toLowerCase();
  return role === "resident" || role === "purok_leader" || role === "collector"
    ? role
    : null;
}

function hasVerifiedResidentProfile(user: any): boolean {
  if (String(user?.role).toLowerCase() !== "resident") {
    return true;
  }

  return Boolean(
    user.email_verified_at &&
      parsePositiveInteger(user.barangay_id) &&
      parsePositiveInteger(user.purok_id) &&
      String(user.phone || "").trim() &&
      String(user.address || "").trim(),
  );
}

function isApprovalReadyAccount(user: any): boolean {
  return (
    String(user?.status).toLowerCase() === "pending" &&
    hasVerifiedResidentProfile(user)
  );
}


router.get(
  "/dashboard-summary",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = parsePositiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const [viewerRows]: any = await db.query(
        `
        SELECT
          id,
          role,
          barangay_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId],
      );

      const viewer = viewerRows[0];

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message: "Administrator account was not found.",
        });
      }

      const isSuperAdmin = viewer.role === "super_admin";
      const barangayId = parsePositiveInteger(viewer.barangay_id);

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message: "The Barangay Captain account has no assigned barangay.",
        });
      }

      const userWhere = isSuperAdmin
        ? ""
        : "AND u.barangay_id = ?";

      const complaintWhere = isSuperAdmin
        ? ""
        : "AND p.barangay_id = ?";

      const binWhere = isSuperAdmin
        ? ""
        : "AND p.barangay_id = ?";

      const userParams = isSuperAdmin ? [] : [barangayId];
      const complaintParams = isSuperAdmin ? [] : [barangayId];
      const binParams = isSuperAdmin ? [] : [barangayId];

      const [
        residentsResult,
        collectorsResult,
        leadersResult,
        pendingAccountsResult,
        binsResult,
        complaintsResult,
      ] = await Promise.all([
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'resident'
            AND u.status = 'active'
            ${userWhere}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'collector'
            AND u.status = 'active'
            ${userWhere}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'purok_leader'
            AND u.status = 'active'
            ${userWhere}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.status = 'pending'
            AND u.role NOT IN ('admin', 'super_admin')
            AND
            (
              u.role <> 'resident'
              OR
              (
                u.email_verified_at IS NOT NULL
                AND u.barangay_id IS NOT NULL
                AND u.purok_id IS NOT NULL
                AND NULLIF(TRIM(u.phone), '') IS NOT NULL
                AND NULLIF(TRIM(u.address), '') IS NOT NULL
              )
            )
            ${userWhere}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM garbage_bins gb
          LEFT JOIN puroks p
            ON p.id = gb.purok_id
          WHERE gb.is_active = 1
            AND gb.latitude IS NOT NULL
            AND gb.longitude IS NOT NULL
            AND gb.latitude BETWEEN -90 AND 90
            AND gb.longitude BETWEEN -180 AND 180
            AND NOT (gb.latitude = 0 AND gb.longitude = 0)
            ${binWhere}
          `,
          binParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM complaints c
          LEFT JOIN puroks p
            ON p.id = c.purok_id
          WHERE c.status = 'pending'
            ${complaintWhere}
          `,
          complaintParams,
        ),
      ]);

      const residentsRows: any = residentsResult[0];
      const collectorsRows: any = collectorsResult[0];
      const leadersRows: any = leadersResult[0];
      const pendingAccountsRows: any = pendingAccountsResult[0];
      const binsRows: any = binsResult[0];
      const complaintsRows: any = complaintsResult[0];

      return res.json({
        success: true,
        scope: isSuperAdmin ? "municipality" : "barangay",
        barangayId: isSuperAdmin ? null : barangayId,
        summary: {
          residents: Number(residentsRows[0]?.total || 0),
          collectors: Number(collectorsRows[0]?.total || 0),
          purokLeaders: Number(leadersRows[0]?.total || 0),
          pendingAccounts: Number(pendingAccountsRows[0]?.total || 0),
          garbageBins: Number(binsRows[0]?.total || 0),
          pendingComplaints: Number(complaintsRows[0]?.total || 0),
        },
      });
    } catch (error) {
      console.error("Admin dashboard summary error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load dashboard summary.",
      });
    }
  },
);


router.get(
  "/recent-activities",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = parsePositiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const [viewerRows]: any = await db.query(
        `
        SELECT
          id,
          role,
          barangay_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId],
      );

      const viewer = viewerRows[0];

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message: "Administrator account was not found.",
        });
      }

      const isSuperAdmin = viewer.role === "super_admin";
      const barangayId = parsePositiveInteger(viewer.barangay_id);

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message: "The Barangay Captain account has no assigned barangay.",
        });
      }

      const userFilter = isSuperAdmin
        ? ""
        : "WHERE u.barangay_id = ?";

      const complaintFilter = isSuperAdmin
        ? ""
        : "WHERE p.barangay_id = ?";

      const inspectionFilter = isSuperAdmin
        ? ""
        : "WHERE p.barangay_id = ?";

      const requestFilter = isSuperAdmin
        ? ""
        : "WHERE p.barangay_id = ?";

      const scopedParams = isSuperAdmin ? [] : [barangayId];

      const results = await Promise.allSettled([
        db.query(
          `
          SELECT
            CONCAT('user-', u.id) AS activity_id,
            'user' AS activity_type,
            u.id AS reference_id,
            u.full_name AS title,
            CONCAT(
              CASE
                WHEN u.role = 'admin' THEN 'Barangay Captain'
                WHEN u.role = 'purok_leader' THEN 'Purok Leader'
                WHEN u.role = 'collector' THEN 'Garbage Collector'
                WHEN u.role = 'super_admin' THEN 'Municipal Administrator'
                ELSE 'Resident'
              END,
              ' account registered'
            ) AS description,
            u.status,
            b.name AS barangay_name,
            p.name AS purok_name,
            u.created_at AS activity_date
          FROM users u
          LEFT JOIN barangays b
            ON b.id = u.barangay_id
          LEFT JOIN puroks p
            ON p.id = u.purok_id
          ${userFilter}
          ORDER BY u.created_at DESC, u.id DESC
          LIMIT 8
          `,
          scopedParams,
        ),

        db.query(
          `
          SELECT
            CONCAT('complaint-', c.id) AS activity_id,
            'complaint' AS activity_type,
            c.id AS reference_id,
            c.complaint_type AS title,
            CONCAT(
              'Complaint submitted by ',
              COALESCE(reporter.full_name, 'Resident')
            ) AS description,
            c.status,
            b.name AS barangay_name,
            p.name AS purok_name,
            c.created_at AS activity_date
          FROM complaints c
          LEFT JOIN users reporter
            ON reporter.id = c.reported_by
          LEFT JOIN puroks p
            ON p.id = c.purok_id
          LEFT JOIN barangays b
            ON b.id = p.barangay_id
          ${complaintFilter}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 8
          `,
          scopedParams,
        ),

        db.query(
          `
          SELECT
            CONCAT('inspection-', bi.id) AS activity_id,
            'inspection' AS activity_type,
            bi.id AS reference_id,
            CONCAT('Bin inspection #', bi.id) AS title,
            CONCAT(
              'Inspection recorded with status ',
              REPLACE(bi.status, '_', ' ')
            ) AS description,
            bi.status,
            b.name AS barangay_name,
            p.name AS purok_name,
            bi.created_at AS activity_date
          FROM bin_inspections bi
          LEFT JOIN garbage_bins gb
            ON gb.id = bi.bin_id
          LEFT JOIN puroks p
            ON p.id = gb.purok_id
          LEFT JOIN barangays b
            ON b.id = p.barangay_id
          ${inspectionFilter}
          ORDER BY bi.created_at DESC, bi.id DESC
          LIMIT 8
          `,
          scopedParams,
        ),

        db.query(
          `
          SELECT
            CONCAT('collection-', cr.id) AS activity_id,
            'collection' AS activity_type,
            cr.id AS reference_id,
            CONCAT('Collection request #', cr.id) AS title,
            CONCAT(
              'Collection request marked ',
              REPLACE(cr.status, '_', ' ')
            ) AS description,
            cr.status,
            b.name AS barangay_name,
            p.name AS purok_name,
            cr.requested_at AS activity_date
          FROM collection_requests cr
          LEFT JOIN garbage_bins gb
            ON gb.id = cr.bin_id
          LEFT JOIN puroks p
            ON p.id = gb.purok_id
          LEFT JOIN barangays b
            ON b.id = p.barangay_id
          ${requestFilter}
          ORDER BY cr.requested_at DESC, cr.id DESC
          LIMIT 8
          `,
          scopedParams,
        ),
      ]);

      const activities: any[] = [];
      const unavailableSources: string[] = [];
      const sourceNames = [
        "users",
        "complaints",
        "inspections",
        "collection requests",
      ];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          const rows: any = result.value[0];

          if (Array.isArray(rows)) {
            activities.push(...rows);
          }
        } else {
          unavailableSources.push(sourceNames[index]);
          console.error(
            `Recent activity source failed: ${sourceNames[index]}`,
            result.reason,
          );
        }
      });

      activities.sort((first, second) => {
        const firstTime = new Date(first.activity_date || 0).getTime();
        const secondTime = new Date(second.activity_date || 0).getTime();
        return secondTime - firstTime;
      });

      return res.json({
        success: true,
        scope: isSuperAdmin ? "municipality" : "barangay",
        barangayId: isSuperAdmin ? null : barangayId,
        activities: activities.slice(0, 12),
        unavailableSources,
      });
    } catch (error) {
      console.error("Admin recent activities error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load recent activities.",
      });
    }
  },
);


router.get(
  "/reports/summary",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = parsePositiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const [viewerRows]: any = await db.query(
        `
        SELECT
          id,
          role,
          barangay_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId],
      );

      const viewer = viewerRows[0];

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message: "Administrator account was not found.",
        });
      }

      const isSuperAdmin = viewer.role === "super_admin";
      const barangayId = parsePositiveInteger(viewer.barangay_id);

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message: "The Barangay Captain account has no assigned barangay.",
        });
      }

      const userFilter = isSuperAdmin
        ? ""
        : "AND u.barangay_id = ?";

      const complaintFilter = isSuperAdmin
        ? ""
        : "AND p.barangay_id = ?";

      const binFilter = isSuperAdmin
        ? ""
        : "AND p.barangay_id = ?";

      const userParams = isSuperAdmin ? [] : [barangayId];
      const complaintParams = isSuperAdmin ? [] : [barangayId];
      const binParams = isSuperAdmin ? [] : [barangayId];

      const [
        barangaysResult,
        captainsResult,
        leadersResult,
        collectorsResult,
        residentsResult,
        activeUsersResult,
        pendingComplaintsResult,
        resolvedComplaintsResult,
        binsResult,
      ] = await Promise.all([
        db.query(
          isSuperAdmin
            ? `
              SELECT COUNT(*) AS total
              FROM barangays
              WHERE is_active = 1
            `
            : `
              SELECT COUNT(*) AS total
              FROM barangays
              WHERE id = ?
                AND is_active = 1
            `,
          isSuperAdmin ? [] : [barangayId],
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'admin'
            ${userFilter}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'purok_leader'
            ${userFilter}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'collector'
            ${userFilter}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.role = 'resident'
            ${userFilter}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM users u
          WHERE u.status = 'active'
            ${userFilter}
          `,
          userParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM complaints c
          LEFT JOIN puroks p
            ON p.id = c.purok_id
          WHERE c.status = 'pending'
            ${complaintFilter}
          `,
          complaintParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM complaints c
          LEFT JOIN puroks p
            ON p.id = c.purok_id
          WHERE c.status = 'resolved'
            ${complaintFilter}
          `,
          complaintParams,
        ),
        db.query(
          `
          SELECT COUNT(*) AS total
          FROM garbage_bins gb
          LEFT JOIN puroks p
            ON p.id = gb.purok_id
          WHERE gb.is_active = 1
            AND gb.latitude IS NOT NULL
            AND gb.longitude IS NOT NULL
            AND gb.latitude BETWEEN -90 AND 90
            AND gb.longitude BETWEEN -180 AND 180
            AND NOT (gb.latitude = 0 AND gb.longitude = 0)
            ${binFilter}
          `,
          binParams,
        ),
      ]);

      const barangaysRows: any = barangaysResult[0];
      const captainsRows: any = captainsResult[0];
      const leadersRows: any = leadersResult[0];
      const collectorsRows: any = collectorsResult[0];
      const residentsRows: any = residentsResult[0];
      const activeUsersRows: any = activeUsersResult[0];
      const pendingComplaintsRows: any = pendingComplaintsResult[0];
      const resolvedComplaintsRows: any = resolvedComplaintsResult[0];
      const binsRows: any = binsResult[0];

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        scope: isSuperAdmin ? "municipality" : "barangay",
        barangayId: isSuperAdmin ? null : barangayId,
        summary: {
          barangays: Number(barangaysRows[0]?.total || 0),
          captains: Number(captainsRows[0]?.total || 0),
          leaders: Number(leadersRows[0]?.total || 0),
          collectors: Number(collectorsRows[0]?.total || 0),
          residents: Number(residentsRows[0]?.total || 0),
          activeUsers: Number(activeUsersRows[0]?.total || 0),
          pendingComplaints: Number(
            pendingComplaintsRows[0]?.total || 0,
          ),
          resolvedComplaints: Number(
            resolvedComplaintsRows[0]?.total || 0,
          ),
          garbageBins: Number(binsRows[0]?.total || 0),
        },
      });
    } catch (error) {
      console.error("Admin reports summary error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to generate the reports summary.",
      });
    }
  },
);


router.get(
  "/analytics",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = parsePositiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const [viewerRows]: any = await db.query(
        `
        SELECT id, role, barangay_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId],
      );

      const viewer = viewerRows[0];

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message: "Administrator account was not found.",
        });
      }

      const isSuperAdmin = viewer.role === "super_admin";
      const barangayId = parsePositiveInteger(viewer.barangay_id);

      if (!isSuperAdmin && !barangayId) {
        return res.status(400).json({
          success: false,
          message: "The Barangay Captain account has no assigned barangay.",
        });
      }

      const userFilter = isSuperAdmin ? "" : "AND u.barangay_id = ?";
      const complaintFilter = isSuperAdmin ? "" : "AND p.barangay_id = ?";
      const binFilter = isSuperAdmin ? "" : "AND p.barangay_id = ?";
      const collectionFilter = isSuperAdmin ? "" : "AND p.barangay_id = ?";

      const userParams = isSuperAdmin ? [] : [barangayId];
      const complaintParams = isSuperAdmin ? [] : [barangayId];
      const binParams = isSuperAdmin ? [] : [barangayId];
      const collectionParams = isSuperAdmin ? [] : [barangayId];

      const results = await Promise.allSettled([
        db.query(
          `
          SELECT u.role, COUNT(*) AS total
          FROM users u
          WHERE u.role IN ('resident', 'collector', 'purok_leader', 'admin')
            ${userFilter}
          GROUP BY u.role
          `,
          userParams,
        ),
        db.query(
          `
          SELECT
            DATE_FORMAT(c.created_at, '%Y-%m') AS month_key,
            DATE_FORMAT(c.created_at, '%b %Y') AS month_label,
            COUNT(*) AS total
          FROM complaints c
          LEFT JOIN puroks p ON p.id = c.purok_id
          WHERE c.created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
            ${complaintFilter}
          GROUP BY
            DATE_FORMAT(c.created_at, '%Y-%m'),
            DATE_FORMAT(c.created_at, '%b %Y')
          ORDER BY month_key ASC
          `,
          complaintParams,
        ),
        db.query(
          `
          SELECT
            DATE_FORMAT(u.created_at, '%Y-%m') AS month_key,
            DATE_FORMAT(u.created_at, '%b %Y') AS month_label,
            COUNT(*) AS total
          FROM users u
          WHERE u.created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
            ${userFilter}
          GROUP BY
            DATE_FORMAT(u.created_at, '%Y-%m'),
            DATE_FORMAT(u.created_at, '%b %Y')
          ORDER BY month_key ASC
          `,
          userParams,
        ),
        db.query(
          `
          SELECT gb.current_status AS status, COUNT(*) AS total
          FROM garbage_bins gb
          LEFT JOIN puroks p ON p.id = gb.purok_id
          WHERE 1 = 1
            ${binFilter}
          GROUP BY gb.current_status
          ORDER BY gb.current_status ASC
          `,
          binParams,
        ),
        db.query(
          `
          SELECT
            DATE_FORMAT(cr.requested_at, '%Y-%m') AS month_key,
            DATE_FORMAT(cr.requested_at, '%b %Y') AS month_label,
            COUNT(*) AS total,
            SUM(cr.status = 'completed') AS completed
          FROM collection_requests cr
          INNER JOIN garbage_bins gb ON gb.id = cr.bin_id
          LEFT JOIN puroks p ON p.id = gb.purok_id
          WHERE cr.requested_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
            ${collectionFilter}
          GROUP BY
            DATE_FORMAT(cr.requested_at, '%Y-%m'),
            DATE_FORMAT(cr.requested_at, '%b %Y')
          ORDER BY month_key ASC
          `,
          collectionParams,
        ),
        db.query(
          `
          SELECT c.status, COUNT(*) AS total
          FROM complaints c
          LEFT JOIN puroks p ON p.id = c.purok_id
          WHERE 1 = 1
            ${complaintFilter}
          GROUP BY c.status
          ORDER BY c.status ASC
          `,
          complaintParams,
        ),
      ]);

      const sourceNames = [
        "usersByRole",
        "complaintsPerMonth",
        "registrationsPerMonth",
        "binsByStatus",
        "collectionsPerMonth",
        "complaintsByStatus",
      ];

      const analytics: Record<string, any[]> = {
        usersByRole: [],
        complaintsPerMonth: [],
        registrationsPerMonth: [],
        binsByStatus: [],
        collectionsPerMonth: [],
        complaintsByStatus: [],
      };

      const unavailableSources: string[] = [];

      results.forEach((result, index) => {
        const key = sourceNames[index];

        if (result.status === "fulfilled") {
          const rows: any = result.value[0];
          analytics[key] = Array.isArray(rows) ? rows : [];
        } else {
          unavailableSources.push(key);
          console.error(`Analytics source failed: ${key}`, result.reason);
        }
      });

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        scope: isSuperAdmin ? "municipality" : "barangay",
        barangayId: isSuperAdmin ? null : barangayId,
        analytics,
        unavailableSources,
      });
    } catch (error) {
      console.error("Admin analytics error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to load analytics.",
      });
    }
  },
);

router.get("/purok-members", requireAuth, async (req: AuthRequest, res) => {
  try {
    const viewerId = parsePositiveInteger(req.user?.id);

    if (!viewerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const [viewerRows]: any = await db.query(
      `
      SELECT id, role, barangay_id, purok_id
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [viewerId],
    );

    const viewer = viewerRows[0];

    if (!viewer) {
      return res.status(401).json({
        success: false,
        message: "User account was not found.",
      });
    }

    if (viewer.role !== "purok_leader") {
      return res.status(403).json({
        success: false,
        message: "Purok Leader access is required.",
      });
    }

    const purokId = parsePositiveInteger(viewer.purok_id);

    if (!purokId) {
      return res.status(400).json({
        success: false,
        message: "The Purok Leader account has no assigned purok.",
      });
    }

    const [rows]: any = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.address,
        u.role,
        u.status,
        u.barangay_id,
        b.name AS barangay_name,
        u.purok_id,
        p.name AS purok_name,
        u.created_at
      FROM users u
      LEFT JOIN barangays b ON b.id = u.barangay_id
      LEFT JOIN puroks p ON p.id = u.purok_id
      WHERE u.role = 'resident'
        AND u.purok_id = ?
      ORDER BY u.full_name ASC
      `,
      [purokId],
    );

    return res.json({
      success: true,
      users: rows,
    });
  } catch (error) {
    console.error("Load purok members error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load purok members.",
    });
  }
});

router.get("/users", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireBarangayCaptain(req, res)) return;

    const viewerId = parsePositiveInteger(req.user?.id);
    const viewerRole = String(req.user?.role || "").toLowerCase();
    const barangayId = parsePositiveInteger(req.user?.barangay_id);

    if (!viewerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const isSuperAdmin = viewerRole === "super_admin";

    if (!isSuperAdmin && !barangayId) {
      return res.status(400).json({
        success: false,
        message: "The Barangay Captain account has no assigned barangay.",
      });
    }

    const scopeWhere = isSuperAdmin
      ? ""
      : `WHERE u.barangay_id = ?
         AND u.role IN ('resident', 'collector', 'purok_leader')`;

    const params = isSuperAdmin ? [] : [barangayId];

    const [rows]: any = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.address,
        u.role,
        u.status,
        CASE
          WHEN u.email_verified_at IS NOT NULL THEN 1
          ELSE 0
        END AS email_verified,
        CASE
          WHEN u.status <> 'pending' THEN 0
          WHEN u.role <> 'resident' THEN 1
          WHEN u.email_verified_at IS NOT NULL
            AND u.barangay_id IS NOT NULL
            AND u.purok_id IS NOT NULL
            AND NULLIF(TRIM(u.phone), '') IS NOT NULL
            AND NULLIF(TRIM(u.address), '') IS NOT NULL
            THEN 1
          ELSE 0
        END AS approval_ready,
        u.barangay_id,
        b.name AS barangay_name,
        u.purok_id,
        p.name AS purok_name,
        u.created_at
      FROM users u
      LEFT JOIN barangays b ON b.id = u.barangay_id
      LEFT JOIN puroks p ON p.id = u.purok_id
      ${scopeWhere}
      ORDER BY
        FIELD(u.role, 'admin', 'purok_leader', 'collector', 'resident'),
        u.full_name ASC
      `,
      params,
    );

    return res.json({ success: true, users: rows });
  } catch (error) {
    console.error("Admin load users error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load users.",
    });
  }
});

router.get("/locations", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireBarangayCaptain(req, res)) return;

    const viewerId = parsePositiveInteger(req.user?.id);
    const [viewerRows]: any = await db.query(
      `SELECT id, role, barangay_id FROM users WHERE id = ? LIMIT 1`,
      [viewerId],
    );

    const viewer = viewerRows[0];
    const isSuperAdmin = viewer?.role === "super_admin";
    const barangayId = parsePositiveInteger(viewer?.barangay_id);

    if (!viewer) {
      return res.status(401).json({
        success: false,
        message: "Administrator account was not found.",
      });
    }

    if (!isSuperAdmin && !barangayId) {
      return res.status(400).json({
        success: false,
        message: "The Barangay Captain account has no assigned barangay.",
      });
    }

    const [barangays]: any = isSuperAdmin
      ? await db.query(`
          SELECT id, name
          FROM barangays
          WHERE is_active = 1
          ORDER BY name ASC
        `)
      : await db.query(
          `SELECT id, name FROM barangays WHERE id = ? AND is_active = 1`,
          [barangayId],
        );

    const [puroks]: any = isSuperAdmin
      ? await db.query(`
          SELECT p.id, p.barangay_id, p.name, b.name AS barangay_name
          FROM puroks p
          INNER JOIN barangays b ON b.id = p.barangay_id
          ORDER BY b.name ASC, p.name ASC
        `)
      : await db.query(
          `
          SELECT p.id, p.barangay_id, p.name, b.name AS barangay_name
          FROM puroks p
          INNER JOIN barangays b ON b.id = p.barangay_id
          WHERE p.barangay_id = ?
          ORDER BY p.name ASC
          `,
          [barangayId],
        );

    return res.json({ success: true, barangays, puroks });
  } catch (error) {
    console.error("Admin load locations error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load barangays and puroks.",
    });
  }
});

router.get("/collectors", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireBarangayCaptain(req, res)) return;

    const viewerId = parsePositiveInteger(req.user?.id);
    const [viewerRows]: any = await db.query(
      `SELECT id, role, barangay_id FROM users WHERE id = ? LIMIT 1`,
      [viewerId],
    );

    const viewer = viewerRows[0];
    const isSuperAdmin = viewer?.role === "super_admin";
    const barangayId = parsePositiveInteger(viewer?.barangay_id);

    if (!viewer) {
      return res.status(401).json({
        success: false,
        message: "Administrator account was not found.",
      });
    }

    if (!isSuperAdmin && !barangayId) {
      return res.status(400).json({
        success: false,
        message: "The Barangay Captain account has no assigned barangay.",
      });
    }

    const scopeSql = isSuperAdmin ? "" : "AND u.barangay_id = ?";
    const params = isSuperAdmin ? [] : [barangayId];

    const [rows]: any = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.barangay_id,
        b.name AS barangay_name,
        u.status
      FROM users u
      LEFT JOIN barangays b ON b.id = u.barangay_id
      WHERE u.role = 'collector'
        AND u.status = 'active'
        ${scopeSql}
      ORDER BY u.full_name ASC
      `,
      params,
    );

    return res.json({ success: true, collectors: rows });
  } catch (error) {
    console.error("Admin load collectors error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load garbage collectors.",
    });
  }
});

router.patch("/users/:id/role", requireAuth, async (req: AuthRequest, res) => {
  const connection = await db.getConnection();

  try {
    if (!requireBarangayCaptain(req, res)) return;

    const userId = parsePositiveInteger(req.params.id);
    const role = normalizeRole(req.body.role);
    const barangayId = parsePositiveInteger(
      req.body.barangayId ?? req.body.barangay_id,
    );
    const purokId = parsePositiveInteger(
      req.body.purokId ?? req.body.purok_id,
    );

    if (!userId || !role) {
      return res.status(400).json({
        success: false,
        message: "A valid user and role are required.",
      });
    }

    if (Number(req.user?.id) === userId) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot change their own role.",
      });
    }

    const viewerRole = String(req.user?.role || "").toLowerCase();
    const viewerBarangayId = parsePositiveInteger(req.user?.barangay_id);
    const isSuperAdmin = viewerRole === "super_admin";

    if (!isSuperAdmin && !viewerBarangayId) {
      return res.status(403).json({
        success: false,
        message: "The Barangay Captain account has no assigned barangay.",
      });
    }

    await connection.beginTransaction();

    const [userRows]: any = await connection.query(
      `
      SELECT
        id,
        full_name,
        role,
        status,
        email_verified_at,
        phone,
        address,
        barangay_id,
        purok_id
      FROM users
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [userId],
    );

    const user = userRows[0];

    if (!user) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User was not found." });
    }

    if (
      !isSuperAdmin &&
      Number(user.barangay_id) !== viewerBarangayId
    ) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User was not found in your barangay.",
      });
    }

    if (
      user.role === "admin" ||
      user.role === "super_admin"
    ) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Protected administrator accounts cannot be modified here.",
      });
    }

    if (
      String(user.role).toLowerCase() === "resident" &&
      String(user.status).toLowerCase() !== "active" &&
      (
        (
          String(user.status).toLowerCase() === "pending" &&
          !hasVerifiedResidentProfile(user)
        ) ||
        !user.email_verified_at
      )
    ) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "This resident must verify their email and complete their profile before approval.",
      });
    }

    let finalBarangayId: number | null = barangayId;
    let finalPurokId: number | null = purokId;

    if (role === "collector") {
      if (!barangayId) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Select an assigned barangay for the garbage collector.",
        });
      }

      if (!isSuperAdmin && barangayId !== viewerBarangayId) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Barangay Captains cannot move accounts to another barangay.",
        });
      }

      finalPurokId = null;
    }

    if (role === "purok_leader" || role === "resident") {
      if (!purokId) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Select a valid purok for this account.",
        });
      }

      const [purokRows]: any = await connection.query(
        `SELECT id, barangay_id FROM puroks WHERE id = ? LIMIT 1`,
        [purokId],
      );

      const purok = purokRows[0];

      if (!purok) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "The selected purok was not found.",
        });
      }

      finalBarangayId = Number(purok.barangay_id);
      finalPurokId = Number(purok.id);

      if (!isSuperAdmin && finalBarangayId !== viewerBarangayId) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "The selected purok is outside your barangay.",
        });
      }
    }

    if (finalBarangayId) {
      const [barangayRows]: any = await connection.query(
        `SELECT id FROM barangays WHERE id = ? AND is_active = 1 LIMIT 1`,
        [finalBarangayId],
      );

      if (!barangayRows[0]) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "The selected barangay was not found or is inactive.",
        });
      }
    }

    await connection.execute(
      `UPDATE users
       SET role = ?, barangay_id = ?, purok_id = ?, status = 'active'
       WHERE id = ?`,
      [role, finalBarangayId, finalPurokId, userId],
    );

    await connection.commit();

    const roleLabel =
      role === "purok_leader"
        ? "Purok Leader"
        : role === "collector"
          ? "Garbage Collector"
          : "Civilian";

    return res.json({
      success: true,
      message: `${user.full_name} is now assigned as ${roleLabel}.`,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Admin update role error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update the user's role.",
    });
  } finally {
    connection.release();
  }
});

router.patch("/users/:id/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireBarangayCaptain(req, res)) return;

    const userId = parsePositiveInteger(req.params.id);
    const status = String(req.body.status || "").trim().toLowerCase();

    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    if (status !== "active" && status !== "inactive") {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive.",
      });
    }

    if (Number(req.user?.id) === userId) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot deactivate their own account.",
      });
    }

    const viewerRole = String(req.user?.role || "").toLowerCase();
    const isSuperAdmin = viewerRole === "super_admin";
    const barangayId = parsePositiveInteger(req.user?.barangay_id);

    if (!isSuperAdmin && !barangayId) {
      return res.status(403).json({
        success: false,
        message: "The Barangay Captain account has no assigned barangay.",
      });
    }

    const scopeSql = isSuperAdmin ? "" : "AND barangay_id = ?";
    const lookupParams = isSuperAdmin
      ? [userId]
      : [userId, barangayId];

    const [userRows]: any = await db.query(
      `
      SELECT
        id,
        role,
        status,
        email_verified_at,
        phone,
        address,
        barangay_id,
        purok_id
      FROM users
      WHERE id = ?
        AND role NOT IN ('admin', 'super_admin')
        ${scopeSql}
      LIMIT 1
      `,
      lookupParams,
    );

    const targetUser = userRows[0];

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User was not found in your barangay or cannot be updated.",
      });
    }

    const targetStatus = String(targetUser.status).toLowerCase();
    const targetIsResident =
      String(targetUser.role).toLowerCase() === "resident";
    const pendingResidentIsNotReady =
      targetIsResident &&
      targetStatus === "pending" &&
      !hasVerifiedResidentProfile(targetUser);
    const inactiveResidentEmailIsNotVerified =
      targetIsResident &&
      targetStatus === "inactive" &&
      status === "active" &&
      !targetUser.email_verified_at;

    if (
      pendingResidentIsNotReady ||
      inactiveResidentEmailIsNotVerified
    ) {
      return res.status(409).json({
        success: false,
        message:
          "This resident must verify their email and complete their profile before approval.",
      });
    }

    if (
      String(targetUser.role).toLowerCase() === "resident" &&
      String(targetUser.status).toLowerCase() === "active" &&
      !targetUser.email_verified_at
    ) {
      await db.execute(
        `
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE id = ?
        `,
        [userId],
      );
    }

    const params = isSuperAdmin
      ? [status, userId]
      : [status, userId, barangayId];

    const [result]: any = await db.execute(
      `UPDATE users
       SET status = ?
       WHERE id = ?
         AND role NOT IN ('admin', 'super_admin')
         ${scopeSql}`,
      params,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User was not found in your barangay or cannot be updated.",
      });
    }

    return res.json({
      success: true,
      message:
        status === "active"
          ? "Account activated successfully."
          : "Account deactivated successfully.",
    });
  } catch (error) {
    console.error("Admin update account status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update account status.",
    });
  }
});

router.post("/barangay-captains", requireAuth, async (req: AuthRequest, res) => {
  const connection = await db.getConnection();

  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only the Municipal Administrator can create Barangay Captains.",
      });
    }

    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const recoveryEmail =
      String(req.body.recoveryEmail || "").trim().toLowerCase() || null;
    const phone = String(req.body.phone || "").trim() || null;
    const barangayId = parsePositiveInteger(req.body.barangayId);
    const plainPassword = String(
      req.body.temporaryPassword || req.body.password || "",
    );

    if (!fullName || !email || !barangayId || !plainPassword) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      fullName.length > 150 ||
      email.length > 150 ||
      !validEmail.test(email) ||
      (recoveryEmail &&
        (recoveryEmail.length > 150 || !validEmail.test(recoveryEmail))) ||
      (phone && !/^\+?\d{7,15}$/.test(phone))
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter valid captain identity and contact information.",
      });
    }

    if (
      plainPassword.length < 12 ||
      !/[A-Z]/.test(plainPassword) ||
      !/[a-z]/.test(plainPassword) ||
      !/\d/.test(plainPassword) ||
      !/[^A-Za-z0-9]/.test(plainPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Temporary password must be at least 12 characters and include uppercase, lowercase, number, and symbol.",
      });
    }

    const hash = await bcrypt.hash(plainPassword, 12);

    await connection.beginTransaction();

    // Lock the barangay row so two concurrent requests cannot create two
    // captains for the same barangay.
    const [barangayRows]: any = await connection.query(
      `
      SELECT id
      FROM barangays
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      FOR UPDATE
      `,
      [barangayId],
    );

    if (!barangayRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "The selected barangay was not found or is inactive.",
      });
    }

    const [existing]: any = await connection.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
      [email],
    );

    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Email already exists.",
      });
    }

    const [captain]: any = await connection.query(
      "SELECT id FROM users WHERE role = 'admin' AND barangay_id = ? LIMIT 1 FOR UPDATE",
      [barangayId],
    );

    if (captain.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "This barangay already has a Barangay Captain.",
      });
    }

    await connection.execute(
      `INSERT INTO users
      (full_name,email,phone,password_hash,recovery_email,role,barangay_id,status,must_change_password)
      VALUES (?,?,?,?,?,'admin',?,'active',1)`,
      [
        fullName,
        email.toLowerCase(),
        phone || null,
        hash,
        recoveryEmail || null,
        barangayId,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Barangay Captain account created successfully.",
    });
  } catch (error: any) {
    await connection.rollback();
    console.error("Create Barangay Captain error:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "The captain email or barangay assignment already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create Barangay Captain.",
    });
  } finally {
    connection.release();
  }
});
router.delete(
  "/users/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = parsePositiveInteger(req.params.id);

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      if (req.user?.id === userId) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own account.",
        });
      }

      const [rows]: any = await db.query(
        `
        SELECT id, role, full_name, barangay_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId],
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      const isSuperAdmin = req.user?.role === "super_admin";
      const viewerBarangayId = parsePositiveInteger(
        req.user?.barangay_id,
      );

      if (!isSuperAdmin && !viewerBarangayId) {
        return res.status(403).json({
          success: false,
          message: "The Barangay Captain account has no assigned barangay.",
        });
      }

      if (
        !isSuperAdmin &&
        Number(rows[0].barangay_id) !== viewerBarangayId
      ) {
        return res.status(404).json({
          success: false,
          message: "User was not found in your barangay.",
        });
      }

      if (
        rows[0].role === "admin" ||
        rows[0].role === "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "Administrator accounts cannot be deleted.",
        });
      }

      const scopeSql = isSuperAdmin ? "" : "AND barangay_id = ?";
      const parameters = isSuperAdmin
        ? [userId]
        : [userId, viewerBarangayId];

      const [result]: any = await db.execute(
        `
        DELETE FROM users
        WHERE id = ?
          AND role NOT IN ('admin', 'super_admin')
          ${scopeSql}
        `,
        parameters,
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "User was not found in your barangay or cannot be deleted.",
        });
      }

      return res.json({
        success: true,
        message: "User deleted successfully.",
      });
    } catch (error) {
      console.error("Delete user error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to delete user.",
      });
    }
  },
);


// -----------------------------------------------------------------------------
// Municipal Truck & Crew Management (Super Admin only)
// -----------------------------------------------------------------------------
function requireSuperAdmin(req: AuthRequest, res: any): boolean {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({
      success: false,
      message:
        "Only the Municipal Administrator can manage collection trucks and crews.",
    });
    return false;
  }

  return true;
}

router.get("/truck-crews", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const [truckRows]: any = await db.query(`
      SELECT
        gt.id,
        gt.truck_code,
        gt.plate_number,
        gt.vehicle_description,
        gt.barangay_id,
        b.name AS barangay_name,
        gt.collector_user_id,
        u.full_name AS collector_name,
        u.email AS collector_email,
        u.phone AS collector_phone,
        gt.status,
        gt.created_at,
        gt.updated_at
      FROM garbage_trucks gt
      LEFT JOIN barangays b
        ON b.id = gt.barangay_id
      LEFT JOIN users u
        ON u.id = gt.collector_user_id
      ORDER BY
        FIELD(gt.status, 'active', 'maintenance', 'inactive'),
        b.name ASC,
        gt.truck_code ASC
    `);

    const [crewRows]: any = await db.query(`
      SELECT
        id,
        truck_id,
        full_name,
        crew_role,
        phone,
        status,
        created_at
      FROM truck_crew_members
      ORDER BY
        truck_id ASC,
        FIELD(crew_role, 'driver', 'crew_leader', 'loader', 'helper'),
        full_name ASC
    `);

    const crewByTruck = new Map<number, any[]>();

    for (const member of crewRows) {
      const truckId = Number(member.truck_id);
      const current = crewByTruck.get(truckId) || [];
      current.push(member);
      crewByTruck.set(truckId, current);
    }

    const trucks = truckRows.map((truck: any) => ({
      ...truck,
      crew_members:
        crewByTruck.get(Number(truck.id)) || [],
    }));

    return res.json({
      success: true,
      trucks,
    });
  } catch (error) {
    console.error("Load truck crews error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to load municipal truck and crew records.",
    });
  }
});

router.post("/truck-crews", requireAuth, async (req: AuthRequest, res) => {
  const connection = await db.getConnection();

  try {
    if (!requireSuperAdmin(req, res)) return;

    const truckCode = String(
      req.body.truckCode || "",
    ).trim();

    const plateNumber = String(
      req.body.plateNumber || "",
    ).trim();

    const vehicleDescription =
      String(
        req.body.vehicleDescription || "",
      ).trim() || null;

    const barangayId = parsePositiveInteger(
      req.body.barangayId,
    );

    const collector = req.body.collector || {};

    // Supports both the original "create collector" flow and the newer
    // "select existing collector" UI.
    const existingCollectorId = parsePositiveInteger(
      req.body.existingCollectorId ??
        req.body.collectorUserId ??
        req.body.collectorId ??
        collector.userId ??
        collector.id,
    );

    const collectorName = String(
      collector.fullName || "",
    ).trim();

    const collectorEmail = String(
      collector.email || "",
    )
      .trim()
      .toLowerCase();

    const collectorPhone =
      String(collector.phone || "").trim() || null;

    const temporaryPassword = String(
      collector.temporaryPassword ||
        req.body.temporaryPassword ||
        "",
    );

    const collectorCrewRole =
      collector.crewRole === "crew_leader" ||
      req.body.collectorCrewRole === "crew_leader"
        ? "crew_leader"
        : "driver";

    const crewMembers = Array.isArray(
      req.body.crewMembers,
    )
      ? req.body.crewMembers
      : [];

    if (!truckCode || !plateNumber || !barangayId) {
      return res.status(400).json({
        success: false,
        message:
          "Complete the truck code, plate number, and assigned barangay.",
      });
    }

    if (
      !existingCollectorId &&
      (!collectorName ||
        !collectorEmail ||
        !temporaryPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Select an existing collector or complete the new collector account fields.",
      });
    }

    if (
      !existingCollectorId &&
      (
        temporaryPassword.length < 12 ||
        !/[A-Z]/.test(temporaryPassword) ||
        !/[a-z]/.test(temporaryPassword) ||
        !/\d/.test(temporaryPassword) ||
        !/[^A-Za-z0-9]/.test(temporaryPassword)
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Temporary password must be at least 12 characters and include uppercase, lowercase, number, and symbol.",
      });
    }

    if (
      truckCode.length > 40 ||
      plateNumber.length > 30 ||
      (vehicleDescription && vehicleDescription.length > 255) ||
      crewMembers.length > 20 ||
      (!existingCollectorId &&
        (
          collectorName.length > 150 ||
          collectorEmail.length > 150 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collectorEmail) ||
          (collectorPhone && !/^\+?\d{7,15}$/.test(collectorPhone))
        ))
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter valid truck, collector, and crew information.",
      });
    }

    await connection.beginTransaction();

    const [barangayRows]: any =
      await connection.query(
        `
        SELECT id, name
        FROM barangays
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
        `,
        [barangayId],
      );

    if (!barangayRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Selected barangay was not found or is inactive.",
      });
    }

    const [assignedTruckRows]: any =
      await connection.query(
        `
        SELECT id, truck_code
        FROM garbage_trucks
        WHERE barangay_id = ?
          AND status IN ('active', 'maintenance')
        LIMIT 1
        `,
        [barangayId],
      );

    if (assignedTruckRows.length) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          `This barangay already has truck ${assignedTruckRows[0].truck_code} assigned. Deactivate that assignment first.`,
      });
    }

    const [duplicateTruckRows]: any =
      await connection.query(
        `
        SELECT id
        FROM garbage_trucks
        WHERE truck_code = ?
           OR plate_number = ?
        LIMIT 1
        `,
        [truckCode, plateNumber],
      );

    if (duplicateTruckRows.length) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Truck code or plate number already exists.",
      });
    }

    let collectorUserId: number;
    let finalCollectorName: string;
    let finalCollectorPhone: string | null;

    if (existingCollectorId) {
      const [collectorRows]: any =
        await connection.query(
          `
          SELECT
            id,
            full_name,
            phone,
            role,
            status,
            barangay_id
          FROM users
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [existingCollectorId],
        );

      const selectedCollector = collectorRows[0];

      if (
        !selectedCollector ||
        selectedCollector.role !== "collector"
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "The selected Garbage Collector account was not found.",
        });
      }

      if (selectedCollector.status !== "active") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The selected Garbage Collector account is not active.",
        });
      }

      if (
        Number(selectedCollector.barangay_id) !==
        Number(barangayId)
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The selected collector must belong to the assigned barangay.",
        });
      }

      const [collectorTruckRows]: any =
        await connection.query(
          `
          SELECT id, truck_code
          FROM garbage_trucks
          WHERE collector_user_id = ?
            AND status IN ('active', 'maintenance')
          LIMIT 1
          `,
          [existingCollectorId],
        );

      if (collectorTruckRows.length) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            `The selected collector is already assigned to truck ${collectorTruckRows[0].truck_code}.`,
        });
      }

      collectorUserId = Number(selectedCollector.id);
      finalCollectorName = String(
        selectedCollector.full_name || "Collector",
      );
      finalCollectorPhone =
        selectedCollector.phone || null;
    } else {
      const [existingUserRows]: any =
        await connection.query(
          `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
          `,
          [collectorEmail],
        );

      if (existingUserRows.length) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The driver/crew leader email already belongs to an existing account.",
        });
      }

      const passwordHash = await bcrypt.hash(
        temporaryPassword,
        12,
      );

      const [collectorResult]: any =
        await connection.execute(
          `
          INSERT INTO users
          (
            full_name,
            email,
            phone,
            password_hash,
            role,
            barangay_id,
            purok_id,
            status,
            must_change_password
          )
          VALUES (?, ?, ?, ?, 'collector', ?, NULL, 'active', 1)
          `,
          [
            collectorName,
            collectorEmail,
            collectorPhone,
            passwordHash,
            barangayId,
          ],
        );

      collectorUserId = Number(
        collectorResult.insertId,
      );
      finalCollectorName = collectorName;
      finalCollectorPhone = collectorPhone;
    }

    const [truckResult]: any =
      await connection.execute(
        `
        INSERT INTO garbage_trucks
        (
          truck_code,
          plate_number,
          vehicle_description,
          barangay_id,
          collector_user_id,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'active')
        `,
        [
          truckCode,
          plateNumber,
          vehicleDescription,
          barangayId,
          collectorUserId,
        ],
      );

    const truckId = Number(truckResult.insertId);

    await connection.execute(
      `
      INSERT INTO truck_crew_members
      (
        truck_id,
        full_name,
        crew_role,
        phone,
        status
      )
      VALUES (?, ?, ?, ?, 'active')
      `,
      [
        truckId,
        finalCollectorName,
        collectorCrewRole,
        finalCollectorPhone,
      ],
    );

    for (const rawMember of crewMembers) {
      const fullName = String(
        rawMember?.fullName || "",
      ).trim();

      if (!fullName) continue;

      const role =
        rawMember?.role === "loader"
          ? "loader"
          : "helper";

      const phone =
        String(rawMember?.phone || "").trim() ||
        null;

      await connection.execute(
        `
        INSERT INTO truck_crew_members
        (
          truck_id,
          full_name,
          crew_role,
          phone,
          status
        )
        VALUES (?, ?, ?, ?, 'active')
        `,
        [truckId, fullName, role, phone],
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: existingCollectorId
        ? `${truckCode} was registered and assigned to the selected Garbage Collector.`
        : `${truckCode} and its collection crew were registered successfully. The new driver/crew leader must change the temporary password on first login.`,
      truckId,
      collectorUserId,
    });
  } catch (error: any) {
    await connection.rollback();
    console.error("Create truck crew error:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message:
          "Truck code, plate number, or account email already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to register the collection truck and crew.",
    });
  } finally {
    connection.release();
  }
});

router.patch(
  "/truck-crews/:id/status",
  requireAuth,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      if (!requireSuperAdmin(req, res)) return;

      const truckId = parsePositiveInteger(
        req.params.id,
      );

      const status = String(
        req.body.status || "",
      )
        .trim()
        .toLowerCase();

      if (
        !truckId ||
        ![
          "active",
          "maintenance",
          "inactive",
        ].includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A valid truck and status are required.",
        });
      }

      await connection.beginTransaction();

      const [truckRows]: any =
        await connection.query(
          `
          SELECT
            id,
            truck_code,
            barangay_id,
            collector_user_id
          FROM garbage_trucks
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [truckId],
        );

      const truck = truckRows[0];

      if (!truck) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Truck was not found.",
        });
      }

      if (
        status !== "inactive" &&
        truck.barangay_id
      ) {
        const [conflictRows]: any =
          await connection.query(
            `
            SELECT id, truck_code
            FROM garbage_trucks
            WHERE barangay_id = ?
              AND id <> ?
              AND status IN ('active', 'maintenance')
            LIMIT 1
            `,
            [truck.barangay_id, truckId],
          );

        if (conflictRows.length) {
          await connection.rollback();

          return res.status(400).json({
            success: false,
            message:
              `Barangay is already assigned to truck ${conflictRows[0].truck_code}.`,
          });
        }
      }

      await connection.execute(
        `
        UPDATE garbage_trucks
        SET status = ?
        WHERE id = ?
        `,
        [status, truckId],
      );

      if (truck.collector_user_id) {
        await connection.execute(
          `
          UPDATE users
          SET status = ?
          WHERE id = ?
            AND role = 'collector'
          `,
          [
            status === "inactive"
              ? "inactive"
              : "active",
            truck.collector_user_id,
          ],
        );
      }

      await connection.execute(
        `
        UPDATE truck_crew_members
        SET status = ?
        WHERE truck_id = ?
        `,
        [
          status === "inactive"
            ? "inactive"
            : "active",
          truckId,
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          `${truck.truck_code} status updated to ${status}.`,
      });
    } catch (error) {
      await connection.rollback();
      console.error(
        "Update truck status error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update truck status.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
