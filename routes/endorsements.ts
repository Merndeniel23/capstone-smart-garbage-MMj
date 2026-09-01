import crypto from "crypto";
import { Router } from "express";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();

type EndorsementStatus =
  | "pending_leader_review"
  | "leader_endorsed"
  | "leader_rejected"
  | "approved"
  | "admin_rejected"
  | "withdrawn";

type EndorsementType =
  | "barangay_clearance_support"
  | "sanitary_clearance_support";

type DatabaseUser = {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
  status: string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
};

let schemaPreparation: Promise<void> | null = null;

function normalizeRole(value: unknown) {
  const role = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");

  if (role === "household") return "resident";
  if (role === "leader") return "purok_leader";
  return role;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function cleanText(value: unknown, maximum: number) {
  return String(value || "")
    .trim()
    .slice(0, maximum);
}

function normalizeRequestType(
  value: unknown,
): EndorsementType | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");

  if (
    normalized === "barangay_clearance_support" ||
    normalized === "sanitary_clearance_support"
  ) {
    return normalized;
  }

  return null;
}

function generateRequestCode() {
  return `END-${new Date().getUTCFullYear()}-${crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase()}`;
}

function generateCertificateNumber(barangayId: number) {
  return `WCE-${new Date().getUTCFullYear()}-${String(
    barangayId,
  ).padStart(3, "0")}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;
}

function generateVerificationCode() {
  return crypto
    .randomBytes(16)
    .toString("hex")
    .toUpperCase();
}

async function prepareEndorsementSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS endorsement_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      request_code VARCHAR(40) NOT NULL,
      requester_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NOT NULL,
      request_type ENUM(
        'barangay_clearance_support',
        'sanitary_clearance_support'
      ) NOT NULL,
      purpose VARCHAR(1000) NOT NULL,
      status ENUM(
        'pending_leader_review',
        'leader_endorsed',
        'leader_rejected',
        'approved',
        'admin_rejected',
        'withdrawn'
      ) NOT NULL DEFAULT 'pending_leader_review',

      requester_name_snapshot VARCHAR(150) NOT NULL,
      requester_email_snapshot VARCHAR(150) NOT NULL,
      requester_phone_snapshot VARCHAR(30) NULL,
      requester_address_snapshot VARCHAR(255) NOT NULL,
      barangay_name_snapshot VARCHAR(120) NOT NULL,
      purok_name_snapshot VARCHAR(100) NOT NULL,

      leader_reviewed_by INT UNSIGNED NULL,
      leader_name_snapshot VARCHAR(150) NULL,
      leader_reviewed_at DATETIME NULL,
      leader_remarks VARCHAR(1000) NULL,

      admin_reviewed_by INT UNSIGNED NULL,
      admin_name_snapshot VARCHAR(150) NULL,
      admin_reviewed_at DATETIME NULL,
      admin_remarks VARCHAR(1000) NULL,

      certificate_number VARCHAR(64) NULL,
      verification_code VARCHAR(64) NULL,
      issued_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

      PRIMARY KEY (id),
      UNIQUE KEY uq_endorsement_request_code (request_code),
      UNIQUE KEY uq_endorsement_certificate_number (certificate_number),
      UNIQUE KEY uq_endorsement_verification_code (verification_code),
      INDEX idx_endorsement_requester (requester_id, created_at),
      INDEX idx_endorsement_purok_status (purok_id, status, created_at),
      INDEX idx_endorsement_barangay_status (barangay_id, status, created_at),

      CONSTRAINT fk_endorsement_requester
        FOREIGN KEY (requester_id) REFERENCES users(id),
      CONSTRAINT fk_endorsement_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id),
      CONSTRAINT fk_endorsement_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id),
      CONSTRAINT fk_endorsement_leader
        FOREIGN KEY (leader_reviewed_by) REFERENCES users(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_endorsement_admin
        FOREIGN KEY (admin_reviewed_by) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS endorsement_request_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      endorsement_request_id BIGINT UNSIGNED NOT NULL,
      actor_user_id INT UNSIGNED NULL,
      actor_name_snapshot VARCHAR(150) NOT NULL,
      actor_role_snapshot VARCHAR(40) NOT NULL,
      action VARCHAR(40) NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NOT NULL,
      remarks VARCHAR(1000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (id),
      INDEX idx_endorsement_history_request
        (endorsement_request_id, created_at),
      INDEX idx_endorsement_history_actor (actor_user_id),

      CONSTRAINT fk_endorsement_history_request
        FOREIGN KEY (endorsement_request_id)
        REFERENCES endorsement_requests(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_endorsement_history_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureEndorsementSchema() {
  if (!schemaPreparation) {
    schemaPreparation = prepareEndorsementSchema().catch(
      (error) => {
        schemaPreparation = null;
        throw error;
      },
    );
  }

  await schemaPreparation;
}

router.use(async (_req, res, next) => {
  try {
    await ensureEndorsementSchema();
    next();
  } catch (error) {
    console.error(
      "Prepare endorsement schema error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to prepare the endorsement registry.",
    });
  }
});

async function loadCurrentUser(
  userId: number,
  executor: any = db,
): Promise<DatabaseUser | null> {
  const [rows] = await executor.query(
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
      p.name AS purok_name
    FROM users u
    LEFT JOIN barangays b
      ON b.id = u.barangay_id
    LEFT JOIN puroks p
      ON p.id = u.purok_id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

const endorsementSelect = `
  SELECT
    er.id,
    er.request_code,
    er.requester_id,
    er.barangay_id,
    er.purok_id,
    er.request_type,
    er.purpose,
    er.status,
    er.requester_name_snapshot,
    er.requester_email_snapshot,
    er.requester_phone_snapshot,
    er.requester_address_snapshot,
    er.barangay_name_snapshot,
    er.purok_name_snapshot,
    er.leader_reviewed_by,
    er.leader_name_snapshot,
    er.leader_reviewed_at,
    er.leader_remarks,
    er.admin_reviewed_by,
    er.admin_name_snapshot,
    er.admin_reviewed_at,
    er.admin_remarks,
    er.certificate_number,
    er.verification_code,
    er.issued_at,
    er.created_at,
    er.updated_at
  FROM endorsement_requests er
`;

function canViewRequest(
  viewer: DatabaseUser,
  request: any,
) {
  const role = normalizeRole(viewer.role);

  if (role === "resident") {
    return Number(request.requester_id) === viewer.id;
  }

  if (role === "purok_leader") {
    return (
      viewer.purok_id !== null &&
      Number(request.purok_id) ===
        Number(viewer.purok_id)
    );
  }

  if (role === "admin") {
    return false;
  }

  return role === "super_admin";
}

async function loadRequestById(
  executor: any,
  requestId: number,
  forUpdate = false,
) {
  const [rows] = await executor.query(
    `
    ${endorsementSelect}
    WHERE er.id = ?
    LIMIT 1
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [requestId],
  );

  return rows[0] || null;
}

async function appendHistory(
  executor: any,
  input: {
    requestId: number;
    actor: DatabaseUser;
    action: string;
    fromStatus: EndorsementStatus | null;
    toStatus: EndorsementStatus;
    remarks?: string | null;
  },
) {
  await executor.execute(
    `
    INSERT INTO endorsement_request_history
    (
      endorsement_request_id,
      actor_user_id,
      actor_name_snapshot,
      actor_role_snapshot,
      action,
      from_status,
      to_status,
      remarks
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.requestId,
      input.actor.id,
      input.actor.full_name,
      normalizeRole(input.actor.role),
      input.action,
      input.fromStatus,
      input.toStatus,
      input.remarks || null,
    ],
  );
}

/**
 * Public certificate verification. The high-entropy verification code is
 * printed on an approved certificate and reveals only certificate metadata.
 */
router.get("/verify/:code", async (req, res) => {
  try {
    const code = cleanText(req.params.code, 64).toUpperCase();

    if (!/^[A-Z0-9-]{12,64}$/.test(code)) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Verification code is invalid.",
      });
    }

    const [rows] = await db.query<any[]>(
      `
      SELECT
        certificate_number,
        verification_code,
        request_type,
        requester_name_snapshot,
        barangay_name_snapshot,
        purok_name_snapshot,
        leader_name_snapshot,
        admin_name_snapshot,
        issued_at
      FROM endorsement_requests
      WHERE status = 'approved'
        AND verification_code = ?
      LIMIT 1
      `,
      [code],
    );

    const certificate = rows[0];

    if (!certificate) {
      return res.status(404).json({
        success: false,
        valid: false,
        message:
          "No approved certificate matches this verification code.",
      });
    }

    return res.json({
      success: true,
      valid: true,
      certificate,
    });
  } catch (error) {
    console.error("Verify endorsement error:", error);

    return res.status(500).json({
      success: false,
      valid: false,
      message: "Unable to verify the certificate.",
    });
  }
});

router.use(requireAuth);

// Endorsements are not a Barangay Captain workflow. Keep the legacy mutation
// endpoint blocked so older clients cannot approve or reject requests.
router.use((req, res, next) => {
  if (
    req.method === "PATCH" &&
    /^\/\d+\/admin-review\/?$/.test(req.path)
  ) {
    return res.status(403).json({
      success: false,
      message:
        "Barangay Captain endorsement access is disabled.",
    });
  }

  next();
});

router.get("/", async (req: AuthRequest, res) => {
  try {
    const viewerId = positiveInteger(req.user?.id);

    if (!viewerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const viewer = await loadCurrentUser(viewerId);

    if (!viewer || viewer.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is inactive or unavailable.",
      });
    }

    const role = normalizeRole(viewer.role);
    let whereClause = "";
    let parameters: number[] = [];

    if (role === "resident") {
      whereClause = "WHERE er.requester_id = ?";
      parameters = [viewer.id];
    } else if (role === "purok_leader") {
      const purokId = positiveInteger(viewer.purok_id);

      if (!purokId) {
        return res.status(400).json({
          success: false,
          message:
            "Your Purok Leader account has no assigned purok.",
        });
      }

      whereClause = "WHERE er.purok_id = ?";
      parameters = [purokId];
    } else if (role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to view endorsements.",
      });
    }

    const [rows] = await db.query<any[]>(
      `
      ${endorsementSelect}
      ${whereClause}
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT 250
      `,
      parameters,
    );

    return res.json({
      success: true,
      viewer: {
        id: viewer.id,
        full_name: viewer.full_name,
        role,
        email: viewer.email,
        phone: viewer.phone,
        address: viewer.address,
        barangay_id: viewer.barangay_id,
        barangay_name: viewer.barangay_name,
        purok_id: viewer.purok_id,
        purok_name: viewer.purok_name,
        account_code: `RES-${viewer.id}`,
      },
      endorsements: rows,
    });
  } catch (error) {
    console.error("Load endorsements error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load endorsements.",
    });
  }
});

router.get(
  "/:id/history",
  async (req: AuthRequest, res) => {
    try {
      const viewerId = positiveInteger(req.user?.id);
      const requestId = positiveInteger(req.params.id);

      if (!viewerId || !requestId) {
        return res.status(400).json({
          success: false,
          message: "A valid endorsement request is required.",
        });
      }

      const viewer = await loadCurrentUser(viewerId);

      if (!viewer || viewer.status !== "active") {
        return res.status(403).json({
          success: false,
          message:
            "Your account is inactive or unavailable.",
        });
      }

      const request = await loadRequestById(
        db,
        requestId,
      );

      if (!request || !canViewRequest(viewer, request)) {
        return res.status(404).json({
          success: false,
          message: "Endorsement request was not found.",
        });
      }

      const [history] = await db.query<any[]>(
        `
        SELECT
          id,
          endorsement_request_id,
          actor_name_snapshot,
          actor_role_snapshot,
          action,
          from_status,
          to_status,
          remarks,
          created_at
        FROM endorsement_request_history
        WHERE endorsement_request_id = ?
        ORDER BY created_at ASC, id ASC
        `,
        [requestId],
      );

      return res.json({
        success: true,
        history,
      });
    } catch (error) {
      console.error("Load endorsement history error:", error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load endorsement history.",
      });
    }
  },
);

router.post("/", async (req: AuthRequest, res) => {
  const connection = await db.getConnection();

  try {
    const viewerId = positiveInteger(req.user?.id);

    if (!viewerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const viewer = await loadCurrentUser(
      viewerId,
      connection,
    );

    if (
      !viewer ||
      viewer.status !== "active" ||
      normalizeRole(viewer.role) !== "resident"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only an active resident can submit an endorsement request.",
      });
    }

    const requestType = normalizeRequestType(
      req.body.requestType ?? req.body.request_type,
    );

    const purpose = cleanText(
      req.body.purpose ?? req.body.description,
      1000,
    );

    if (!requestType) {
      return res.status(400).json({
        success: false,
        message: "Select a valid endorsement type.",
      });
    }

    if (purpose.length < 10) {
      return res.status(400).json({
        success: false,
        message:
          "Describe the endorsement purpose using at least 10 characters.",
      });
    }

    const barangayId = positiveInteger(
      viewer.barangay_id,
    );
    const purokId = positiveInteger(viewer.purok_id);
    const address = cleanText(viewer.address, 255);

    if (!barangayId || !purokId || !address) {
      return res.status(400).json({
        success: false,
        message:
          "Complete your registered barangay, purok, and address before requesting an endorsement.",
      });
    }

    const [locationRows] = await connection.query<any[]>(
      `
      SELECT
        p.id AS purok_id,
        p.name AS purok_name,
        b.id AS barangay_id,
        b.name AS barangay_name
      FROM puroks p
      INNER JOIN barangays b
        ON b.id = p.barangay_id
      WHERE p.id = ?
        AND b.id = ?
        AND b.is_active = 1
      LIMIT 1
      `,
      [purokId, barangayId],
    );

    const location = locationRows[0];

    if (!location) {
      return res.status(400).json({
        success: false,
        message:
          "Your registered barangay and purok assignment is invalid.",
      });
    }

    await connection.beginTransaction();

    const requestCode = generateRequestCode();

    const [result] = await connection.execute<any>(
      `
      INSERT INTO endorsement_requests
      (
        request_code,
        requester_id,
        barangay_id,
        purok_id,
        request_type,
        purpose,
        status,
        requester_name_snapshot,
        requester_email_snapshot,
        requester_phone_snapshot,
        requester_address_snapshot,
        barangay_name_snapshot,
        purok_name_snapshot
      )
      VALUES
      (?, ?, ?, ?, ?, ?, 'pending_leader_review', ?, ?, ?, ?, ?, ?)
      `,
      [
        requestCode,
        viewer.id,
        barangayId,
        purokId,
        requestType,
        purpose,
        viewer.full_name,
        viewer.email,
        viewer.phone || null,
        address,
        location.barangay_name,
        location.purok_name,
      ],
    );

    const requestId = Number(result.insertId);

    await appendHistory(connection, {
      requestId,
      actor: viewer,
      action: "submitted",
      fromStatus: null,
      toStatus: "pending_leader_review",
      remarks: purpose,
    });

    await connection.commit();

    const endorsement = await loadRequestById(
      db,
      requestId,
    );

    return res.status(201).json({
      success: true,
      message:
        "Endorsement request submitted to your Purok Leader.",
      endorsement,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create endorsement error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to submit the endorsement request.",
    });
  } finally {
    connection.release();
  }
});

router.patch(
  "/:id/leader-review",
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const viewerId = positiveInteger(req.user?.id);
      const requestId = positiveInteger(req.params.id);
      const action = cleanText(req.body.action, 20)
        .toLowerCase();
      const remarks = cleanText(req.body.remarks, 1000);

      if (!viewerId || !requestId) {
        return res.status(400).json({
          success: false,
          message: "A valid endorsement request is required.",
        });
      }

      if (action !== "endorse" && action !== "reject") {
        return res.status(400).json({
          success: false,
          message: "Action must be endorse or reject.",
        });
      }

      if (action === "reject" && remarks.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            "Provide a short reason when rejecting a request.",
        });
      }

      await connection.beginTransaction();

      const viewer = await loadCurrentUser(
        viewerId,
        connection,
      );

      if (
        !viewer ||
        viewer.status !== "active" ||
        normalizeRole(viewer.role) !== "purok_leader"
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Purok Leader access is required.",
        });
      }

      const request = await loadRequestById(
        connection,
        requestId,
        true,
      );

      if (
        !request ||
        !viewer.purok_id ||
        Number(request.purok_id) !==
          Number(viewer.purok_id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Endorsement request was not found in your assigned purok.",
        });
      }

      if (request.status !== "pending_leader_review") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "Only a request awaiting Purok Leader review can be processed.",
        });
      }

      const nextStatus: EndorsementStatus =
        action === "endorse"
          ? "leader_endorsed"
          : "leader_rejected";

      await connection.execute(
        `
        UPDATE endorsement_requests
        SET
          status = ?,
          leader_reviewed_by = ?,
          leader_name_snapshot = ?,
          leader_reviewed_at = NOW(),
          leader_remarks = ?
        WHERE id = ?
        `,
        [
          nextStatus,
          viewer.id,
          viewer.full_name,
          remarks || null,
          requestId,
        ],
      );

      await appendHistory(connection, {
        requestId,
        actor: viewer,
        action:
          action === "endorse"
            ? "leader_endorsed"
            : "leader_rejected",
        fromStatus: "pending_leader_review",
        toStatus: nextStatus,
        remarks: remarks || null,
      });

      await connection.commit();

      const endorsement = await loadRequestById(
        db,
        requestId,
      );

      return res.json({
        success: true,
        message:
          action === "endorse"
            ? "Request endorsed to the Barangay Captain."
            : "Request rejected by the Purok Leader.",
        endorsement,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Leader endorsement review error:", error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to complete the Purok Leader review.",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/admin-review",
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const viewerId = positiveInteger(req.user?.id);
      const requestId = positiveInteger(req.params.id);
      const action = cleanText(req.body.action, 20)
        .toLowerCase();
      const remarks = cleanText(req.body.remarks, 1000);

      if (!viewerId || !requestId) {
        return res.status(400).json({
          success: false,
          message: "A valid endorsement request is required.",
        });
      }

      if (action !== "approve" && action !== "reject") {
        return res.status(400).json({
          success: false,
          message: "Action must be approve or reject.",
        });
      }

      if (action === "reject" && remarks.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            "Provide a short reason when rejecting a request.",
        });
      }

      await connection.beginTransaction();

      const viewer = await loadCurrentUser(
        viewerId,
        connection,
      );

      if (
        !viewer ||
        viewer.status !== "active" ||
        normalizeRole(viewer.role) !== "admin"
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Barangay Captain access is required.",
        });
      }

      const request = await loadRequestById(
        connection,
        requestId,
        true,
      );

      if (
        !request ||
        !viewer.barangay_id ||
        Number(request.barangay_id) !==
          Number(viewer.barangay_id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Endorsement request was not found in your assigned barangay.",
        });
      }

      if (request.status !== "leader_endorsed") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "Barangay review requires a Purok Leader endorsement first.",
        });
      }

      const nextStatus: EndorsementStatus =
        action === "approve"
          ? "approved"
          : "admin_rejected";

      const certificateNumber =
        action === "approve"
          ? generateCertificateNumber(
              Number(request.barangay_id),
            )
          : null;

      const verificationCode =
        action === "approve"
          ? generateVerificationCode()
          : null;

      await connection.execute(
        `
        UPDATE endorsement_requests
        SET
          status = ?,
          admin_reviewed_by = ?,
          admin_name_snapshot = ?,
          admin_reviewed_at = NOW(),
          admin_remarks = ?,
          certificate_number = ?,
          verification_code = ?,
          issued_at = CASE
            WHEN ? = 'approved' THEN NOW()
            ELSE NULL
          END
        WHERE id = ?
        `,
        [
          nextStatus,
          viewer.id,
          viewer.full_name,
          remarks ||
            (action === "approve"
              ? "Approved after barangay review."
              : null),
          certificateNumber,
          verificationCode,
          nextStatus,
          requestId,
        ],
      );

      await appendHistory(connection, {
        requestId,
        actor: viewer,
        action:
          action === "approve"
            ? "certificate_issued"
            : "admin_rejected",
        fromStatus: "leader_endorsed",
        toStatus: nextStatus,
        remarks: remarks || null,
      });

      await connection.commit();

      const endorsement = await loadRequestById(
        db,
        requestId,
      );

      return res.json({
        success: true,
        message:
          action === "approve"
            ? "Certificate approved and issued successfully."
            : "Request rejected by the Barangay Captain.",
        endorsement,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Admin endorsement review error:", error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to complete the Barangay Captain review.",
      });
    } finally {
      connection.release();
    }
  },
);

/**
 * Residents may withdraw only their own request while it is still waiting
 * for leader review. Records and history are retained; nothing is hard-deleted.
 */
router.delete("/:id", async (req: AuthRequest, res) => {
  const connection = await db.getConnection();

  try {
    const viewerId = positiveInteger(req.user?.id);
    const requestId = positiveInteger(req.params.id);

    if (!viewerId || !requestId) {
      return res.status(400).json({
        success: false,
        message: "A valid endorsement request is required.",
      });
    }

    await connection.beginTransaction();

    const viewer = await loadCurrentUser(
      viewerId,
      connection,
    );

    if (
      !viewer ||
      viewer.status !== "active" ||
      normalizeRole(viewer.role) !== "resident"
    ) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message:
          "Only the requesting resident can withdraw this request.",
      });
    }

    const request = await loadRequestById(
      connection,
      requestId,
      true,
    );

    if (
      !request ||
      Number(request.requester_id) !== viewer.id
    ) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Endorsement request was not found.",
      });
    }

    if (request.status !== "pending_leader_review") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "Only a request awaiting Purok Leader review can be withdrawn.",
      });
    }

    await connection.execute(
      `
      UPDATE endorsement_requests
      SET status = 'withdrawn'
      WHERE id = ?
      `,
      [requestId],
    );

    await appendHistory(connection, {
      requestId,
      actor: viewer,
      action: "withdrawn",
      fromStatus: "pending_leader_review",
      toStatus: "withdrawn",
    });

    await connection.commit();

    return res.json({
      success: true,
      message: "Endorsement request withdrawn.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Withdraw endorsement error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to withdraw the endorsement request.",
    });
  } finally {
    connection.release();
  }
});

export default router;
