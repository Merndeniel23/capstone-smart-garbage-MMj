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
          FROM garbage_bins gb
          LEFT JOIN puroks p
            ON p.id = gb.purok_id
          WHERE 1 = 1
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
          WHERE 1 = 1
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

router.get("/users", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireBarangayCaptain(req, res)) return;

    const [rows]: any = await db.query(`
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
      ORDER BY
        FIELD(u.role, 'admin', 'purok_leader', 'collector', 'resident'),
        u.full_name ASC
    `);

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

    const [barangays]: any = await db.query(`
      SELECT id, name
      FROM barangays
      WHERE is_active = 1
      ORDER BY name ASC
    `);

    const [puroks]: any = await db.query(`
      SELECT
        p.id,
        p.barangay_id,
        p.name,
        b.name AS barangay_name
      FROM puroks p
      INNER JOIN barangays b ON b.id = p.barangay_id
      ORDER BY b.name ASC, p.name ASC
    `);

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

    const [rows]: any = await db.query(`
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
      ORDER BY u.full_name ASC
    `);

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

    await connection.beginTransaction();

    const [userRows]: any = await connection.query(
      `SELECT id, full_name, role, status FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );

    const user = userRows[0];

    if (!user) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User was not found." });
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

    const [result]: any = await db.execute(
      `UPDATE users
       SET status = ?
       WHERE id = ?
         AND role NOT IN ('admin', 'super_admin')`,
      [status, userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User was not found or cannot be updated.",
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
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only the Municipal Administrator can create Barangay Captains.",
      });
    }

    const {
      fullName,
      email,
      recoveryEmail,
      phone,
      barangayId,
      password,
      temporaryPassword,
    } = req.body;

    const plainPassword = password || temporaryPassword;

    if (!fullName || !email || !barangayId || !plainPassword) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    const [existing]: any = await db.query(
      "SELECT id FROM users WHERE email=? LIMIT 1",
      [email]
    );

    if (existing.length) {
      return res.status(400).json({
        success: false,
        message: "Email already exists.",
      });
    }

    const [captain]: any = await db.query(
      "SELECT id FROM users WHERE role='admin' AND barangay_id=? LIMIT 1",
      [barangayId]
    );

    if (captain.length) {
      return res.status(400).json({
        success: false,
        message: "This barangay already has a Barangay Captain.",
      });
    }

    const hash = await bcrypt.hash(plainPassword, 10);

    await db.execute(
      `INSERT INTO users
      (full_name,email,phone,password_hash,recovery_email,role,barangay_id,status,must_change_password)
      VALUES (?,?,?,?,?,'admin',?,'active',1)`,
      [
        fullName,
        email.toLowerCase(),
        phone || null,
        hash,
        recoveryEmail || null,
        Number(barangayId),
      ]
    );

    return res.json({
      success: true,
      message: "Barangay Captain account created successfully.",
    });
  } catch (error) {
    console.error("Create Barangay Captain error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create Barangay Captain.",
    });
  }
});
router.delete(
  "/users/:id",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (!requireBarangayCaptain(req, res)) return;

      const userId = Number(req.params.id);

      if (!Number.isInteger(userId)) {
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
        SELECT id, role, full_name
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

      if (
        rows[0].role === "admin" ||
        rows[0].role === "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "Administrator accounts cannot be deleted.",
        });
      }

      await db.execute(
        `
        DELETE FROM users
        WHERE id = ?
        `,
        [userId],
      );

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

export default router;