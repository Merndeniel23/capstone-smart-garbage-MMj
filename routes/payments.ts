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

import { paymentCategories } from "../config/paymentFees.js";

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
      purok_id,
      created_at
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


function defaultWeeklyFee() {
  const option = paymentCategories.find(
    (item: any) => item.value === "weekly_fee",
  );

  const amount = Number(option?.amount);

  return Number.isFinite(amount) && amount > 0
    ? amount
    : 5;
}

function localDateString(
  value: Date | string,
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1,
  ).padStart(2, "0");
  const day = String(
    date.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfLocalDay(
  value: Date | string,
) {
  const date =
    value instanceof Date
      ? new Date(value)
      : new Date(value);

  date.setHours(0, 0, 0, 0);
  return date;
}

let weeklyFeeTableReady: Promise<void> | null = null;

async function ensureWeeklyFeeTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS purok_weekly_fees (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      purok_id INT UNSIGNED NOT NULL,
      weekly_fee DECIMAL(10,2) NOT NULL,
      effective_from DATE NOT NULL,
      set_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purok_weekly_fee_date (purok_id, effective_from),
      KEY idx_purok_weekly_fee_lookup (purok_id, effective_from),
      CONSTRAINT fk_purok_weekly_fee_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE CASCADE,
      CONSTRAINT fk_purok_weekly_fee_set_by
        FOREIGN KEY (set_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);
}

async function weeklyFeeHistory(
  purokId: number,
  executor: any = db,
) {
  const [rows] = await executor.query(
    `
    SELECT
      id,
      purok_id,
      weekly_fee,
      effective_from,
      set_by,
      created_at
    FROM purok_weekly_fees
    WHERE purok_id = ?
    ORDER BY effective_from ASC, id ASC
    `,
    [purokId],
  );

  return rows as any[];
}

function feeForDate(
  history: any[],
  date: Date,
) {
  const dateKey = localDateString(date);
  let amount = defaultWeeklyFee();

  for (const row of history) {
    const effectiveKey =
      localDateString(row.effective_from);

    if (effectiveKey > dateKey) {
      break;
    }

    const candidate =
      Number(row.weekly_fee);

    if (
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      amount = candidate;
    }
  }

  return amount;
}

async function paymentFeeInfo(
  purokId: number,
  executor: any = db,
) {
  const history =
    await weeklyFeeHistory(
      purokId,
      executor,
    );

  const amount =
    feeForDate(
      history,
      new Date(),
    );

  const currentRecord =
    [...history]
      .reverse()
      .find(
        (row) =>
          localDateString(
            row.effective_from,
          ) <=
          localDateString(
            new Date(),
          ),
      );

  return {
    amount,
    effective_from:
      currentRecord?.effective_from ||
      null,
    uses_default:
      !currentRecord,
  };
}

async function residentPaymentReminder(
  viewer: any,
) {
  if (
    viewer.role !== "resident" ||
    !viewer.purok_id
  ) {
    return null;
  }

  const [paymentRows] =
    await db.query<any[]>(
      `
      SELECT
        amount,
        COALESCE(
          admin_confirmed_at,
          updated_at,
          created_at
        ) AS completed_at
      FROM payments
      WHERE resident_id = ?
        AND category = 'weekly_fee'
        AND status = 'completed'
      ORDER BY
        COALESCE(
          admin_confirmed_at,
          updated_at,
          created_at
        ) DESC,
        id DESC
      LIMIT 1
      `,
      [viewer.id],
    );

  const lastPayment =
    paymentRows[0] || null;

  const accountStart =
    viewer.created_at
      ? startOfLocalDay(
          viewer.created_at,
        )
      : startOfLocalDay(
          new Date(),
        );

  const baseDate =
    lastPayment?.completed_at
      ? startOfLocalDay(
          lastPayment.completed_at,
        )
      : accountStart;

  const today =
    startOfLocalDay(new Date());

  const weekMs =
    7 * 24 * 60 * 60 * 1000;

  const elapsedMs =
    Math.max(
      0,
      today.getTime() -
        baseDate.getTime(),
    );

  const missedCount =
    Math.floor(
      elapsedMs / weekMs,
    );

  const history =
    await weeklyFeeHistory(
      Number(viewer.purok_id),
    );

  const missedPeriods: {
    due_date: string;
    fee: number;
  }[] = [];

  let outstandingBalance = 0;

  for (
    let index = 1;
    index <= missedCount;
    index += 1
  ) {
    const dueDate =
      new Date(
        baseDate.getTime() +
          index * weekMs,
      );

    const fee =
      feeForDate(
        history,
        dueDate,
      );

    outstandingBalance += fee;

    missedPeriods.push({
      due_date:
        localDateString(
          dueDate,
        ),
      fee:
        Math.round(
          fee * 100,
        ) / 100,
    });
  }

  const feeInfo =
    await paymentFeeInfo(
      Number(viewer.purok_id),
    );

  return {
    current_weekly_fee:
      Math.round(
        Number(feeInfo.amount) * 100,
      ) / 100,
    last_completed_payment_at:
      lastPayment?.completed_at ||
      null,
    last_completed_amount:
      lastPayment
        ? Number(lastPayment.amount)
        : null,
    missed_payment_count:
      missedCount,
    outstanding_balance:
      Math.round(
        outstandingBalance * 100,
      ) / 100,
    counting_from:
      localDateString(
        baseDate,
      ),
    missed_periods:
      missedPeriods,
  };
}

async function ensureWeeklyFeeTableOnce() {
  if (!weeklyFeeTableReady) {
    weeklyFeeTableReady = ensureWeeklyFeeTable().catch((error) => {
      weeklyFeeTableReady = null;
      throw error;
    });
  }

  await weeklyFeeTableReady;
}

router.use(async (_req, res, next) => {
  try {
    await ensureWeeklyFeeTableOnce();
    next();
  } catch (error) {
    console.error(
      "Weekly pickup fee table error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to prepare weekly pickup fee settings.",
    });
  }
});

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


type ContributionSummaryRow = {
  scope_id: number;
  scope_name: string;
  parent_name: string | null;
  total_records: number;
  completed_records: number;
  pending_records: number;
  to_confirm_records: number;
  rejected_records: number;
  discrepancy_records: number;
  confirmed_contribution: number;
  pending_contribution: number;
  to_confirm_amount: number;
};

async function loadContributionSummary(
  viewer: any,
): Promise<ContributionSummaryRow[]> {
  if (viewer.role === "super_admin") {
    const [rows] = await db.query<any[]>(`
      SELECT
        b.id AS scope_id,
        b.name AS scope_name,
        NULL AS parent_name,
        COUNT(pay.id) AS total_records,
        SUM(CASE WHEN pay.status = 'completed' THEN 1 ELSE 0 END) AS completed_records,
        SUM(
          CASE
            WHEN pay.status IN (
              'pending_leader_verification',
              'pending_remittance',
              'pending_admin_confirmation'
            )
            THEN 1
            ELSE 0
          END
        ) AS pending_records,
        SUM(CASE WHEN pay.status = 'pending_admin_confirmation' THEN 1 ELSE 0 END) AS to_confirm_records,
        SUM(CASE WHEN pay.status = 'rejected_by_leader' THEN 1 ELSE 0 END) AS rejected_records,
        SUM(CASE WHEN pay.status = 'discrepancy' THEN 1 ELSE 0 END) AS discrepancy_records,
        COALESCE(
          SUM(CASE WHEN pay.status = 'completed' THEN pay.amount ELSE 0 END),
          0
        ) AS confirmed_contribution,
        COALESCE(
          SUM(
            CASE
              WHEN pay.status IN (
                'pending_leader_verification',
                'pending_remittance',
                'pending_admin_confirmation'
              )
              THEN pay.amount
              ELSE 0
            END
          ),
          0
        ) AS pending_contribution,
        COALESCE(
          SUM(
            CASE
              WHEN pay.status = 'pending_admin_confirmation'
              THEN pay.amount
              ELSE 0
            END
          ),
          0
        ) AS to_confirm_amount
      FROM barangays b
      LEFT JOIN payments pay
        ON pay.barangay_id = b.id
      GROUP BY b.id, b.name
      ORDER BY b.name ASC
    `);

    return rows.map((row: any) => ({
      scope_id: Number(row.scope_id),
      scope_name: String(row.scope_name || ""),
      parent_name: null,
      total_records: Number(row.total_records || 0),
      completed_records: Number(row.completed_records || 0),
      pending_records: Number(row.pending_records || 0),
      to_confirm_records: Number(row.to_confirm_records || 0),
      rejected_records: Number(row.rejected_records || 0),
      discrepancy_records: Number(row.discrepancy_records || 0),
      confirmed_contribution: Number(row.confirmed_contribution || 0),
      pending_contribution: Number(row.pending_contribution || 0),
      to_confirm_amount: Number(row.to_confirm_amount || 0),
    }));
  }

  if (viewer.role === "admin") {
    if (!viewer.barangay_id) {
      throw new Error("Barangay Captain account has no assigned barangay.");
    }

    const [rows] = await db.query<any[]>(
      `
      SELECT
        p.id AS scope_id,
        p.name AS scope_name,
        b.name AS parent_name,
        COUNT(pay.id) AS total_records,
        SUM(CASE WHEN pay.status = 'completed' THEN 1 ELSE 0 END) AS completed_records,
        SUM(
          CASE
            WHEN pay.status IN (
              'pending_leader_verification',
              'pending_remittance',
              'pending_admin_confirmation'
            )
            THEN 1
            ELSE 0
          END
        ) AS pending_records,
        SUM(CASE WHEN pay.status = 'pending_admin_confirmation' THEN 1 ELSE 0 END) AS to_confirm_records,
        SUM(CASE WHEN pay.status = 'rejected_by_leader' THEN 1 ELSE 0 END) AS rejected_records,
        SUM(CASE WHEN pay.status = 'discrepancy' THEN 1 ELSE 0 END) AS discrepancy_records,
        COALESCE(
          SUM(CASE WHEN pay.status = 'completed' THEN pay.amount ELSE 0 END),
          0
        ) AS confirmed_contribution,
        COALESCE(
          SUM(
            CASE
              WHEN pay.status IN (
                'pending_leader_verification',
                'pending_remittance',
                'pending_admin_confirmation'
              )
              THEN pay.amount
              ELSE 0
            END
          ),
          0
        ) AS pending_contribution,
        COALESCE(
          SUM(
            CASE
              WHEN pay.status = 'pending_admin_confirmation'
              THEN pay.amount
              ELSE 0
            END
          ),
          0
        ) AS to_confirm_amount
      FROM puroks p
      INNER JOIN barangays b
        ON b.id = p.barangay_id
      LEFT JOIN payments pay
        ON pay.purok_id = p.id
      WHERE p.barangay_id = ?
      GROUP BY p.id, p.name, b.name
      ORDER BY p.name ASC
      `,
      [viewer.barangay_id],
    );

    return rows.map((row: any) => ({
      scope_id: Number(row.scope_id),
      scope_name: String(row.scope_name || ""),
      parent_name: String(row.parent_name || "") || null,
      total_records: Number(row.total_records || 0),
      completed_records: Number(row.completed_records || 0),
      pending_records: Number(row.pending_records || 0),
      to_confirm_records: Number(row.to_confirm_records || 0),
      rejected_records: Number(row.rejected_records || 0),
      discrepancy_records: Number(row.discrepancy_records || 0),
      confirmed_contribution: Number(row.confirmed_contribution || 0),
      pending_contribution: Number(row.pending_contribution || 0),
      to_confirm_amount: Number(row.to_confirm_amount || 0),
    }));
  }

  return [];
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

      if (
        viewer.role === "super_admin" ||
        viewer.role === "admin"
      ) {
        if (
          viewer.role === "admin" &&
          !viewer.barangay_id
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Your account has no assigned barangay.",
          });
        }

        const contributionSummary =
          await loadContributionSummary(viewer);

        return res.json({
          success: true,
          payments: [],
          categories: paymentCategories,
          weeklyFee: null,
          paymentReminder: null,
          contributionSummary,
          viewMode:
            viewer.role === "super_admin"
              ? "barangay_summary"
              : "purok_summary",
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
      } else {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to view resident payment records.",
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

      const feeInfo =
        viewer.purok_id
          ? await paymentFeeInfo(
              Number(viewer.purok_id),
            )
          : null;

      const categories =
        paymentCategories.map(
          (item: any) =>
            item.value === "weekly_fee" &&
            feeInfo
              ? {
                  ...item,
                  amount:
                    feeInfo.amount,
                }
              : item,
        );

      const paymentReminder =
        viewer.role === "resident"
          ? await residentPaymentReminder(
              viewer,
            )
          : null;

      return res.json({
        success: true,
        payments,
        categories,
        weeklyFee: feeInfo,
        paymentReminder,
        contributionSummary: [],
        viewMode: "resident_payments",
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


router.patch(
  "/weekly-fee",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    let connection:
      PoolConnection | null = null;

    try {
      const userId =
        positiveInteger(
          req.user?.id,
        );

      if (!userId) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      const amount =
        Number(
          req.body.amount ??
            req.body.weeklyFee ??
            req.body.weekly_fee,
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 100000
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid weekly pickup fee greater than PHP 0.00.",
        });
      }

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      const viewer =
        await getViewer(
          userId,
          connection,
          true,
        );

      if (
        !viewer ||
        viewer.role !==
          "purok_leader" ||
        !viewer.purok_id
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message:
            "Purok Leader access with an assigned purok is required.",
        });
      }

      const roundedAmount =
        Math.round(
          amount * 100,
        ) / 100;

      await connection.execute(
        `
        INSERT INTO purok_weekly_fees
        (
          purok_id,
          weekly_fee,
          effective_from,
          set_by
        )
        VALUES (?, ?, CURDATE(), ?)
        ON DUPLICATE KEY UPDATE
          weekly_fee = VALUES(weekly_fee),
          set_by = VALUES(set_by),
          created_at = CURRENT_TIMESTAMP
        `,
        [
          viewer.purok_id,
          roundedAmount,
          viewer.id,
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          `Weekly pickup fee updated to PHP ${roundedAmount.toFixed(2)}.`,
        weeklyFee: {
          amount:
            roundedAmount,
          effective_from:
            localDateString(
              new Date(),
            ),
          uses_default:
            false,
        },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(
        "Update weekly pickup fee error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update the weekly pickup fee.",
      });
    } finally {
      connection?.release();
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

      if (
        !Number.isFinite(submittedAmount) ||
        submittedAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid payment amount greater than PHP 0.00.",
        });
      }

      // Residents may submit any positive contribution amount.
      // Category fees are references only and do not limit the amount paid.
      const amount =
        Math.round(submittedAmount * 100) / 100;

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
  "/summary/purok/:purokId/confirm",
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

      const purokId =
        positiveInteger(req.params.purokId);

      if (!userId || !purokId) {
        return res.status(400).json({
          success: false,
          message:
            "A valid purok is required.",
        });
      }

      await connection.beginTransaction();

      const viewer =
        await getViewer(
          userId,
          connection,
          true,
        );

      if (
        !viewer ||
        viewer.role !== "admin" ||
        !viewer.barangay_id
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message:
            "Barangay Captain access with an assigned barangay is required.",
        });
      }

      const [purokRows] =
        await connection.query<any[]>(
          `
          SELECT id
          FROM puroks
          WHERE id = ?
            AND barangay_id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [
            purokId,
            viewer.barangay_id,
          ],
        );

      if (!purokRows[0]) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "That purok is outside your assigned barangay.",
        });
      }

      const remarks = cleanText(
        req.body.remarks,
        500,
      );

      const [result] =
        await connection.execute<any>(
          `
          UPDATE payments
          SET
            status = 'completed',
            admin_confirmed_by = ?,
            admin_confirmed_at = NOW(),
            admin_remarks = COALESCE(NULLIF(?, ''), admin_remarks)
          WHERE purok_id = ?
            AND barangay_id = ?
            AND status = 'pending_admin_confirmation'
          `,
          [
            viewer.id,
            remarks,
            purokId,
            viewer.barangay_id,
          ],
        );

      if (!result.affectedRows) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "There are no Purok remittances waiting for confirmation.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          `${result.affectedRows} remittance ${
            result.affectedRows === 1
              ? "record was"
              : "records were"
          } confirmed for this purok.`,
        confirmedCount:
          Number(result.affectedRows),
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Confirm Purok remittance error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to confirm the Purok remittance.",
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


router.delete(
  "/:id",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    let connection:
      PoolConnection | null = null;

    let receiptProof: string | null = null;
    let remittanceProof: string | null = null;

    try {
      const userId =
        positiveInteger(req.user?.id);

      const paymentId =
        positiveInteger(req.params.id);

      if (!userId || !paymentId) {
        return res.status(400).json({
          success: false,
          message:
            "A valid payment ID is required.",
        });
      }

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      const viewer =
        await getViewer(
          userId,
          connection,
          true,
        );

      if (
        !viewer ||
        viewer.role !== "super_admin"
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message:
            "Municipal Administrator access is required to delete payment records.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT
            id,
            transaction_code,
            receipt_proof,
            remittance_proof
          FROM payments
          WHERE id = ?
          LIMIT 1
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
            "Payment record was not found.",
        });
      }

      receiptProof =
        typeof payment.receipt_proof === "string"
          ? payment.receipt_proof
          : null;

      remittanceProof =
        typeof payment.remittance_proof === "string"
          ? payment.remittance_proof
          : null;

      const [result] =
        await connection.execute<any>(
          `
          DELETE FROM payments
          WHERE id = ?
          `,
          [paymentId],
        );

      if (result.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Payment record could not be deleted.",
        });
      }

      await connection.commit();

      for (const proof of [
        receiptProof,
        remittanceProof,
      ]) {
        if (
          proof &&
          isStorageReference(proof)
        ) {
          await deleteStoredProof(proof).catch(
            (cleanupError) =>
              console.error(
                "Deleted payment proof cleanup error:",
                cleanupError,
              ),
          );
        }
      }

      return res.json({
        success: true,
        message:
          `Payment ${payment.transaction_code} was deleted successfully.`,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(
        "Delete payment error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to delete the payment record.",
      });
    } finally {
      connection?.release();
    }
  },
);


export default router;
