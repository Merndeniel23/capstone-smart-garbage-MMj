import { Router } from "express";
import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import {
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  deleteStoredProof,
  hydratePaymentProofUrls,
  imageExtensionForDataUrl,
  isStorageReference,
  storeProof,
} from "../config/storage.js";

const router = Router();

type PaymentStatus =
  | "pending_leader_verification"
  | "rejected_by_leader"
  | "pending_remittance"
  | "pending_admin_confirmation"
  | "discrepancy"
  | "completed";

const ALLOWED_CATEGORIES = new Set([
  "weekly_fee",
  "special_heavy_trash",
  "hazardous_disposal",
]);

const CATEGORY_AMOUNTS: Record<string, number> = {
  weekly_fee: 5,
  special_heavy_trash: 80,
  hazardous_disposal: 120,
};

const ALLOWED_METHODS = new Set([
  "gcash",
  "maya",
  "over_the_counter",
]);

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function cleanText(
  value: unknown,
  maximum = 500,
) {
  return String(value || "")
    .trim()
    .slice(0, maximum);
}

function createTransactionCode() {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  return `PAY-${date}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function validateImageDataUrl(
  value: unknown,
) {
  const proof = String(value || "").trim();

  if (!proof || proof.length > 4_800_000) {
    return null;
  }

  try {
    imageExtensionForDataUrl(proof);
    return proof;
  } catch {
    return null;
  }
}

async function getViewer(
  userId: number,
  executor: any = db,
  forUpdate = false,
) {
  const [rows] = await executor.query(
    `
    SELECT
      id,
      full_name,
      role,
      barangay_id,
      purok_id
    FROM users
    WHERE id = ?
      AND status = 'active'
    LIMIT 1
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [userId],
  );

  return rows[0] || null;
}

function selectPaymentFields() {
  return `
    SELECT
      pay.id,
      pay.transaction_code,
      pay.resident_id,
      resident.full_name AS resident_name,
      resident.email AS resident_email,
      resident.phone AS resident_phone,
      pay.barangay_id,
      b.name AS barangay_name,
      pay.purok_id,
      p.name AS purok_name,
      pay.category,
      pay.billing_period,
      pay.amount,
      pay.payment_method,
      pay.payment_reference,
      pay.receipt_proof,
      pay.status,
      pay.leader_verified_by,
      leader.full_name AS leader_name,
      pay.leader_verified_at,
      pay.leader_remarks,
      pay.remittance_reference,
      pay.remittance_proof,
      pay.remitted_at,
      pay.admin_confirmed_by,
      administrator.full_name AS admin_name,
      pay.admin_confirmed_at,
      pay.admin_remarks,
      pay.discrepancy_amount,
      pay.created_at,
      pay.updated_at
    FROM payments pay
    INNER JOIN users resident
      ON resident.id = pay.resident_id
    INNER JOIN barangays b
      ON b.id = pay.barangay_id
    INNER JOIN puroks p
      ON p.id = pay.purok_id
    LEFT JOIN users leader
      ON leader.id = pay.leader_verified_by
    LEFT JOIN users administrator
      ON administrator.id = pay.admin_confirmed_by
  `;
}

router.get(
  "/",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    try {
      const userId =
        positiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      const viewer =
        await getViewer(userId);

      if (!viewer) {
        return res.status(401).json({
          success: false,
          message:
            "Your active account was not found.",
        });
      }

      let whereClause = "";
      let parameters: unknown[] = [];

      if (viewer.role === "resident") {
        whereClause =
          "WHERE pay.resident_id = ?";
        parameters = [viewer.id];
      } else if (
        viewer.role === "purok_leader"
      ) {
        if (!viewer.purok_id) {
          return res.status(400).json({
            success: false,
            message:
              "Your account has no assigned purok.",
          });
        }

        whereClause =
          "WHERE pay.purok_id = ?";
        parameters = [viewer.purok_id];
      } else if (viewer.role === "admin") {
        if (!viewer.barangay_id) {
          return res.status(400).json({
            success: false,
            message:
              "Your account has no assigned barangay.",
          });
        }

        whereClause =
          "WHERE pay.barangay_id = ?";
        parameters = [
          viewer.barangay_id,
        ];
      } else if (
        viewer.role !== "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to view payments.",
        });
      }

      const [rows] =
        await db.query<any[]>(
          `
          ${selectPaymentFields()}
          ${whereClause}
          ORDER BY
            pay.created_at DESC,
            pay.id DESC
          `,
          parameters,
        );

      const payments = await hydratePaymentProofUrls(rows);

      return res.json({
        success: true,
        payments,
      });
    } catch (error) {
      console.error(
        "Load payments error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load payments.",
      });
    }
  },
);

router.post(
  "/",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    let connection: PoolConnection | null = null;
    let uploadedReceiptProof: string | null = null;

    try {
      const userId =
        positiveInteger(req.user?.id);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      if (req.user?.role !== "resident") {
        return res.status(403).json({
          success: false,
          message:
            "Only a resident can submit a payment.",
        });
      }

      const category = cleanText(
        req.body.category,
        40,
      );

      const paymentMethod = cleanText(
        req.body.paymentMethod ??
          req.body.payment_method,
        40,
      );

      const billingPeriod = cleanText(
        req.body.billingPeriod ??
          req.body.billing_period,
        80,
      );

      const paymentReference =
        cleanText(
          req.body.paymentReference ??
            req.body.payment_reference,
          120,
        );

      const receiptProof =
        validateImageDataUrl(
          req.body.receiptProof ??
            req.body.receipt_proof,
        );

      const submittedAmount = Number(
        req.body.amount,
      );

      if (!ALLOWED_CATEGORIES.has(category)) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid payment category.",
        });
      }

      const amount = CATEGORY_AMOUNTS[category];

      if (
        !Number.isFinite(submittedAmount) ||
        Math.abs(submittedAmount - amount) > 0.001
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The submitted amount does not match the official fee for this category.",
        });
      }

      if (
        !ALLOWED_METHODS.has(
          paymentMethod,
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Select GCash, Maya, or Over-the-Counter.",
        });
      }

      if (
        !billingPeriod
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A billing period is required.",
        });
      }

      if (!paymentReference) {
        return res.status(400).json({
          success: false,
          message:
            paymentMethod ===
            "over_the_counter"
              ? "Official receipt number is required."
              : "Payment reference number is required.",
        });
      }

      if (!receiptProof) {
        return res.status(400).json({
          success: false,
          message:
            "Upload a valid receipt image smaller than 3.5 MB.",
        });
      }

      connection = await db.getConnection();

      await connection.beginTransaction();

      const viewer = await getViewer(
        userId,
        connection,
        true,
      );

      if (
        !viewer ||
        viewer.role !== "resident"
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Only a resident can submit a payment.",
        });
      }

      if (
        !viewer.barangay_id ||
        !viewer.purok_id
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Complete your barangay and purok assignment before paying.",
        });
      }

      const [locationRows] = await connection.query<any[]>(
        `
        SELECT p.id
        FROM puroks p
        INNER JOIN barangays b ON b.id = p.barangay_id
        WHERE p.id = ?
          AND p.barangay_id = ?
          AND b.is_active = 1
        LIMIT 1
        FOR UPDATE
        `,
        [viewer.purok_id, viewer.barangay_id],
      );

      if (!locationRows[0]) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Your registered purok and barangay assignment is invalid.",
        });
      }

      const transactionCode =
        createTransactionCode();

      uploadedReceiptProof =
        await storeProof(
          receiptProof,
          `payments/${viewer.id}/${transactionCode}/receipt.${imageExtensionForDataUrl(receiptProof)}`,
        );

      const [result] =
        await connection.execute<any>(
          `
          INSERT INTO payments
          (
            transaction_code,
            resident_id,
            barangay_id,
            purok_id,
            category,
            billing_period,
            amount,
            payment_method,
            payment_reference,
            receipt_proof,
            status
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'pending_leader_verification'
          )
          `,
          [
            transactionCode,
            viewer.id,
            viewer.barangay_id,
            viewer.purok_id,
            category,
            billingPeriod,
            amount,
            paymentMethod,
            paymentReference,
            uploadedReceiptProof,
          ],
        );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Payment submitted for Purok Leader verification.",
        paymentId: result.insertId,
        transactionCode,
      });
    } catch (error: any) {
      if (connection) {
        await connection.rollback();
      }

      if (uploadedReceiptProof && isStorageReference(uploadedReceiptProof)) {
        await deleteStoredProof(uploadedReceiptProof).catch(
          (cleanupError) =>
            console.error("Receipt proof cleanup error:", cleanupError),
        );
      }

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "That payment reference has already been submitted.",
        });
      }

      console.error(
        "Submit payment error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to submit the payment.",
      });
    } finally {
      connection?.release();
    }
  },
);

router.patch(
  "/:id/leader-review",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    const connection =
      await db.getConnection();

    try {
      const userId =
        positiveInteger(req.user?.id);

      const paymentId =
        positiveInteger(req.params.id);

      if (!userId || !paymentId) {
        return res.status(400).json({
          success: false,
          message:
            "A valid payment is required.",
        });
      }

      let viewer =
        await getViewer(userId);

      if (
        !viewer ||
        viewer.role !==
          "purok_leader"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Purok Leader access is required.",
        });
      }

      const action = cleanText(
        req.body.action,
        20,
      ).toLowerCase();

      const remarks = cleanText(
        req.body.remarks,
        500,
      );

      if (
        action !== "approve" &&
        action !== "reject"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Action must be approve or reject.",
        });
      }

      if (action === "reject" && remarks.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            "Provide a short reason when rejecting a payment.",
        });
      }

      await connection.beginTransaction();

      viewer = await getViewer(
        userId,
        connection,
        true,
      );

      if (
        !viewer ||
        viewer.role !== "purok_leader" ||
        !viewer.purok_id
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Purok Leader access with an assigned purok is required.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT
            id,
            purok_id,
            status
          FROM payments
          WHERE id = ?
          FOR UPDATE
          `,
          [paymentId],
        );

      const payment = rows[0];

      if (!payment) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Payment was not found.",
        });
      }

      if (
        Number(payment.purok_id) !==
        Number(viewer.purok_id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "You can only review payments from your assigned purok.",
        });
      }

      if (
        payment.status !==
        "pending_leader_verification"
      ) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This payment has already been reviewed.",
        });
      }

      const nextStatus: PaymentStatus =
        action === "approve"
          ? "pending_remittance"
          : "rejected_by_leader";

      const [result] = await connection.execute<any>(
        `
        UPDATE payments
        SET
          status = ?,
          leader_verified_by = ?,
          leader_verified_at = NOW(),
          leader_remarks = ?
        WHERE id = ?
          AND status = 'pending_leader_verification'
        `,
        [
          nextStatus,
          viewer.id,
          remarks || null,
          paymentId,
        ],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This payment was changed before the review could be saved.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          action === "approve"
            ? "Payment verified. It is now pending remittance to the barangay."
            : "Payment rejected by the Purok Leader.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Leader payment review error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to review the payment.",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/remit",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    const connection =
      await db.getConnection();
    let uploadedRemittanceProof: string | null = null;

    try {
      const userId =
        positiveInteger(req.user?.id);

      const paymentId =
        positiveInteger(req.params.id);

      if (!userId || !paymentId) {
        return res.status(400).json({
          success: false,
          message:
            "A valid payment is required.",
        });
      }

      let viewer =
        await getViewer(userId);

      if (
        !viewer ||
        viewer.role !==
          "purok_leader"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Purok Leader access is required.",
        });
      }

      const reference = cleanText(
        req.body.remittanceReference ??
          req.body.remittance_reference,
        120,
      );

      const proof = validateImageDataUrl(
        req.body.remittanceProof ??
          req.body.remittance_proof,
      );

      if (!reference || !proof) {
        return res.status(400).json({
          success: false,
          message:
            "Remittance reference and proof image are required.",
        });
      }

      await connection.beginTransaction();

      viewer = await getViewer(
        userId,
        connection,
        true,
      );

      if (
        !viewer ||
        viewer.role !== "purok_leader" ||
        !viewer.purok_id
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Purok Leader access with an assigned purok is required.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT
            id,
            purok_id,
            status
          FROM payments
          WHERE id = ?
          FOR UPDATE
          `,
          [paymentId],
        );

      const payment = rows[0];

      if (!payment) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Payment was not found.",
        });
      }

      if (
        Number(payment.purok_id) !==
        Number(viewer.purok_id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "You can only remit payments from your assigned purok.",
        });
      }

      if (
        payment.status !==
        "pending_remittance"
      ) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This payment is not pending remittance.",
        });
      }

      uploadedRemittanceProof =
        await storeProof(
          proof,
          `payments/${paymentId}/remittance/${viewer.id}-${crypto.randomUUID()}.${imageExtensionForDataUrl(proof)}`,
        );

      const [result] = await connection.execute<any>(
        `
        UPDATE payments
        SET
          status = 'pending_admin_confirmation',
          remittance_reference = ?,
          remittance_proof = ?,
          remitted_at = NOW()
        WHERE id = ?
          AND status = 'pending_remittance'
        `,
        [
          reference,
          uploadedRemittanceProof,
          paymentId,
        ],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();

        if (uploadedRemittanceProof && isStorageReference(uploadedRemittanceProof)) {
          await deleteStoredProof(uploadedRemittanceProof).catch(
            (cleanupError) =>
              console.error("Remittance proof cleanup error:", cleanupError),
          );
        }

        return res.status(409).json({
          success: false,
          message:
            "This payment was changed before the remittance could be saved.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Remittance submitted for Barangay Admin confirmation.",
      });
    } catch (error) {
      await connection.rollback();

      if (uploadedRemittanceProof && isStorageReference(uploadedRemittanceProof)) {
        await deleteStoredProof(uploadedRemittanceProof).catch(
          (cleanupError) =>
            console.error("Remittance proof cleanup error:", cleanupError),
        );
      }

      console.error(
        "Submit remittance error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to submit the remittance.",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/admin-review",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    const connection =
      await db.getConnection();

    try {
      const userId =
        positiveInteger(req.user?.id);

      const paymentId =
        positiveInteger(req.params.id);

      if (!userId || !paymentId) {
        return res.status(400).json({
          success: false,
          message:
            "A valid payment is required.",
        });
      }

      let viewer =
        await getViewer(userId);

      if (
        !viewer ||
        !["admin", "super_admin"].includes(
          viewer.role,
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Barangay Admin access is required.",
        });
      }

      const action = cleanText(
        req.body.action,
        20,
      ).toLowerCase();

      const remarks = cleanText(
        req.body.remarks,
        500,
      );

      const discrepancyAmount = Number(
        req.body.discrepancyAmount ??
          req.body.discrepancy_amount ??
          0,
      );

      if (
        action !== "confirm" &&
        action !== "discrepancy"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Action must be confirm or discrepancy.",
        });
      }

      if (
        action === "discrepancy" &&
        (!Number.isFinite(
          discrepancyAmount,
        ) ||
          discrepancyAmount <= 0)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter the missing or mismatched amount.",
        });
      }

      if (action === "discrepancy" && remarks.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            "Provide a short explanation for the discrepancy.",
        });
      }

      await connection.beginTransaction();

      viewer = await getViewer(
        userId,
        connection,
        true,
      );

      if (
        !viewer ||
        !["admin", "super_admin"].includes(viewer.role) ||
        (viewer.role === "admin" && !viewer.barangay_id)
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message:
            "Barangay Admin access with an assigned barangay is required.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT
            id,
            barangay_id,
            amount,
            status,
            admin_remarks,
            discrepancy_amount
          FROM payments
          WHERE id = ?
          FOR UPDATE
          `,
          [paymentId],
        );

      const payment = rows[0];

      if (!payment) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "Payment was not found.",
        });
      }

      if (
        viewer.role === "admin" &&
        Number(payment.barangay_id) !==
          Number(viewer.barangay_id)
      ) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message:
            "You can only confirm remittances from your assigned barangay.",
        });
      }

      const legalTransition =
        payment.status === "pending_admin_confirmation" ||
        (payment.status === "discrepancy" && action === "confirm");

      if (!legalTransition) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This remittance is not awaiting admin confirmation.",
        });
      }

      if (
        action === "discrepancy" &&
        Number.isFinite(Number(payment.amount)) &&
        discrepancyAmount > Number(payment.amount)
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Discrepancy cannot exceed the original payment amount.",
        });
      }

      const nextStatus: PaymentStatus =
        action === "confirm"
          ? "completed"
          : "discrepancy";

      const [result] = await connection.execute<any>(
        `
        UPDATE payments
        SET
          status = ?,
          admin_confirmed_by = ?,
          admin_confirmed_at = NOW(),
          admin_remarks = ?,
          discrepancy_amount = ?
        WHERE id = ?
          AND status = ?
        `,
        [
          nextStatus,
          viewer.id,
          remarks || payment.admin_remarks || null,
          action === "discrepancy"
            ? discrepancyAmount
            : payment.discrepancy_amount ?? null,
          paymentId,
          payment.status,
        ],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "This remittance changed before the review could be saved.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          action === "confirm"
            ? "Remittance confirmed. Payment is completed."
            : "A remittance discrepancy was recorded.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Admin remittance review error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to review the remittance.",
      });
    } finally {
      connection.release();
    }
  },
);

export default router;
