import crypto from "crypto";
import { Router } from "express";
import { activeRecord, audit, DomainError } from "../services/sgms.js";
import { snapshotEndorsement } from "../services/endorsementSnapshot.js";
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
  | "barangay_service_endorsement";

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

  if (normalized === "barangay_service_endorsement") {
    return "barangay_service_endorsement";
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
  return `BSE-${new Date().getUTCFullYear()}-${String(
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
      request_type VARCHAR(64) NOT NULL,
      requested_service VARCHAR(255) NULL,
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

  // Keep existing databases compatible while moving every request to the
  // generic barangay-service endorsement purpose.
  await db.query(`
    ALTER TABLE endorsement_requests
      MODIFY request_type VARCHAR(64) NOT NULL
  `);
  await db.query(`
    UPDATE endorsement_requests
    SET request_type = 'barangay_service_endorsement'
    WHERE request_type <> 'barangay_service_endorsement'
  `);

  const [requestedServiceColumns] = await db.query<any[]>(
    `SHOW COLUMNS FROM endorsement_requests LIKE 'requested_service'`,
  );

  if (!requestedServiceColumns[0]) {
    await db.query(`
      ALTER TABLE endorsement_requests
        ADD COLUMN requested_service VARCHAR(255) NULL AFTER request_type
    `);
  }

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
    er.requested_service,
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
    er.updated_at,
    (
      SELECT COUNT(*)
      FROM payments pay
      WHERE pay.resident_id = er.requester_id
        AND pay.status IN ('pending_leader_verification', 'discrepancy')
    ) AS outstanding_payment_count
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

  // The Barangay Captain can read every endorsement in the barangay.
  if (role === "admin") {
    return (
      viewer.barangay_id !== null &&
      Number(request.barangay_id) ===
        Number(viewer.barangay_id)
    );
  }

  return false;
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
    } else if (role === "admin") {
      // Read-only: the Purok Leader remains the one who releases endorsements.
      const barangayId = positiveInteger(viewer.barangay_id);

      if (!barangayId) {
        return res.status(400).json({
          success: false,
          message:
            "Your Barangay Captain account has no assigned barangay.",
        });
      }

      whereClause = "WHERE er.barangay_id = ?";
      parameters = [barangayId];
    } else {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to view endorsements.",
      });
    }

    const [rows] = await db.query<any[]>(
      `
      ${endorsementSelect}
      ${whereClause} ${activeRecord("er")}
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

    const requestedService = cleanText(
      req.body.requestedService ?? req.body.requested_service,
      255,
    );

    const purpose = cleanText(
      req.body.purpose ?? req.body.description,
      1000,
    );

    if (!requestType) {
      return res.status(400).json({
        success: false,
        message: "Select a valid barangay service endorsement type.",
      });
    }

    if (requestedService.length < 2) {
      return res.status(400).json({
        success: false,
        message:
          "Specify the barangay service, document, permit, or assistance you need.",
      });
    }

    if (purpose.length < 10) {
      return res.status(400).json({
        success: false,
        message:
          "Describe the request purpose using at least 10 characters.",
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
        requested_service,
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
      (?, ?, ?, ?, ?, ?, ?, 'pending_leader_review', ?, ?, ?, ?, ?, ?)
      `,
      [
        requestCode,
        viewer.id,
        barangayId,
        purokId,
        requestType,
        requestedService,
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
        "Barangay service request submitted to your Purok Leader.",
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

      if (!["endorse", "approve", "reject"].includes(action)) {
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

      // Legacy requests may be stuck in leader_endorsed while waiting for the
      // now-removed Barangay Captain step. Let the assigned leader finalize them.
      const reviewable = ["pending_leader_review", "leader_endorsed"];
      if (!reviewable.includes(String(request.status))) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "This endorsement has already received a final decision.",
        });
      }

      const approving = action === "approve" || action === "endorse";
      if (approving) {
        // Only payments still waiting for the leader's verification block a
        // release; rejected records stay in history without blocking forever.
        // Do not trust a stale frontend count; verify at the point of approval.
        const [outstandingRows] = await connection.query<any[]>(
          `SELECT COUNT(*) AS total FROM payments
           WHERE resident_id = ? AND status IN ('pending_leader_verification', 'discrepancy')`,
          [request.requester_id],
        );
        const outstanding = Number(outstandingRows[0]?.total || 0);
        if (outstanding > 0) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            message: "Verify or reject this resident's pending payments in Verify Payments before releasing the endorsement.",
            outstandingPaymentCount: outstanding,
          });
        }
      }

      const nextStatus: EndorsementStatus = approving
        ? "approved"
        : "leader_rejected";
      const certificateNumber = approving
        ? generateCertificateNumber(Number(request.barangay_id))
        : null;
      const verificationCode = approving ? generateVerificationCode() : null;

      await connection.execute(
        `UPDATE endorsement_requests
         SET status = ?, leader_reviewed_by = ?, leader_name_snapshot = ?,
             leader_reviewed_at = NOW(), leader_remarks = ?,
             certificate_number = ?, verification_code = ?,
             issued_at = CASE WHEN ? = 'approved' THEN NOW() ELSE NULL END
         WHERE id = ?`,
        [nextStatus, viewer.id, viewer.full_name, remarks || null,
         certificateNumber, verificationCode, nextStatus, requestId],
      );

      if (approving) await snapshotEndorsement(connection, request, viewer.full_name, certificateNumber!);
      await audit(connection, req.user!, approving ? "endorsement_released" : "endorsement_rejected", "endorsement_requests", requestId, {...request, resident_id: request.requester_id});
      await connection.execute(
        `INSERT INTO notifications
         (recipient_user_id, barangay_id, purok_id, title, message, notification_type, created_by)
         VALUES (?, ?, ?, ?, ?, 'endorsement', ?)`,
        [
          request.requester_id,
          request.barangay_id,
          request.purok_id,
          approving ? "Endorsement released" : "Endorsement rejected",
          approving
            ? `Your endorsement ${request.request_code} was released by ${viewer.full_name}. Open Barangay Endorsements to download the PDF.`
            : `Your endorsement ${request.request_code} was rejected: ${remarks}`,
          viewer.id,
        ],
      );
      await appendHistory(connection, {
        requestId,
        actor: viewer,
        action: approving ? "leader_final_approval" : "leader_rejected",
        fromStatus: request.status as EndorsementStatus,
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
          action === "reject"
            ? "Request rejected by the Purok Leader."
            : "Endorsement approved and issued by the Purok Leader.",
        endorsement,
      });
    } catch (error) {
      await connection.rollback();
      if (error instanceof DomainError) return res.status(error.status).json({message: error.message});
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

// Barangay Captain approval is no longer part of the endorsement workflow.
// There is deliberately no /:id/admin-review write endpoint.

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

    if (!viewer || viewer.status !== "active") {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Your account is inactive or unavailable.",
      });
    }

    const role = normalizeRole(viewer.role);

    const request = await loadRequestById(
      connection,
      requestId,
      true,
    );

    if (!request) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Endorsement request was not found.",
      });
    }

    // Residents keep the original workflow: a pending request is withdrawn
    // rather than hard-deleted so staff can retain the audit trail.
    if (role === "resident") {
      if (Number(request.requester_id) !== viewer.id) {
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
    }

    // Final requests are archived by withdrawing them. Keep the request and
    // its history linked so the resident and staff audit trail is preserved.
    if (role === "purok_leader") {
      if (
        !viewer.purok_id ||
        Number(request.purok_id) !== Number(viewer.purok_id)
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Endorsement request was not found in your assigned purok.",
        });
      }

      const archivableStatuses: EndorsementStatus[] = [
        "approved",
        "leader_rejected",
        "admin_rejected",
      ];

      if (
        !archivableStatuses.includes(
          request.status as EndorsementStatus,
        )
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only approved or rejected endorsement requests can be archived.",
        });
      }

      const [result] = await connection.execute<any>(
        `UPDATE endorsement_requests
         SET status = 'withdrawn'
         WHERE id = ?
           AND status IN ('approved', 'leader_rejected', 'admin_rejected')`,
        [requestId],
      );

      if (Number(result.affectedRows) !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The endorsement status changed before archiving. Refresh and try again.",
        });
      }

      await appendHistory(connection, {
        requestId,
        actor: viewer,
        action: "archived",
        fromStatus: request.status as EndorsementStatus,
        toStatus: "withdrawn",
      });
      await connection.commit();

      return res.json({
        success: true,
        archived: true,
        message:
          "Final endorsement request archived. Its history was preserved.",
      });
    }

    await connection.rollback();

    return res.status(403).json({
      success: false,
      message:
        "You do not have permission to delete this endorsement request.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Delete endorsement error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to delete the endorsement request.",
    });
  } finally {
    connection.release();
  }
});

export default router;
