import { Router } from "express";
import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import { audit, revisionsEnabled } from "../services/sgms.js";
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

import { CATEGORY_AMOUNTS, paymentCategories } from "../config/paymentFees.js";

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
  "violation_fine",
]);



const ALLOWED_METHODS = new Set([
  "gcash",
  "maya",
  "over_the_counter",
  "xendit",
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

  // Completed payments stay in payments forever. This table only marks which
  // transactions are hidden from everyday lists, preserving proofs/totals.
  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_archives (
      payment_id BIGINT UNSIGNED NOT NULL,
      archived_by INT UNSIGNED NULL,
      archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (payment_id),
      KEY idx_payment_archive_actor (archived_by),
      CONSTRAINT fk_payment_archive_payment
        FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      CONSTRAINT fk_payment_archive_actor
        FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
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

export async function paymentFeeInfo(
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

export async function latestResidentViolationFine(
  residentId: number,
  executor: any = db,
): Promise<number | null> {
  try {
    const [rows] = await executor.query(
      `
      SELECT COALESCE(v.fine_amount, p.fine_amount) AS fine_amount
      FROM household_violations v
      LEFT JOIN barangay_violation_policies p ON p.id = v.policy_id
      WHERE v.resident_id = ?
        AND COALESCE(v.action, p.action) = 'fine'
        AND COALESCE(v.fine_amount, p.fine_amount) > 0
      ORDER BY v.issued_at DESC, v.id DESC
      LIMIT 1
      `,
      [residentId],
    );
    const fine = Number(rows?.[0]?.fine_amount);
    return Number.isFinite(fine) && fine > 0
      ? Math.round(fine * 100) / 100
      : null;
  } catch {
    return null;
  }
}

type ResidentComplianceRow = {
  resident_id: number;
  resident_name: string;
  resident_email: string;
  barangay_id: number;
  barangay_name: string;
  purok_id: number;
  purok_name: string;
  current_weekly_fee: number;
  last_completed_payment_at: string | null;
  last_completed_amount: number | null;
  expected_last_fee: number | null;
  missed_payment_count: number;
  underpaid_amount: number;
  outstanding_balance: number;
  pending_verification_count: number;
  pending_payment_count: number;
  pending_amount: number;
  counting_from: string;
  missed_periods: Array<{
    due_date: string;
    fee: number;
  }>;
};

async function loadResidentComplianceRows(
  scope: {
    residentId?: number;
    purokId?: number;
    barangayId?: number;
    all?: boolean;
  },
): Promise<ResidentComplianceRow[]> {
  const conditions = [
    "u.role = 'resident'",
    "u.status = 'active'",
  ];
  const parameters: unknown[] = [];

  if (scope.residentId) {
    conditions.push("u.id = ?");
    parameters.push(scope.residentId);
  } else if (scope.purokId) {
    conditions.push("u.purok_id = ?");
    parameters.push(scope.purokId);
  } else if (scope.barangayId) {
    conditions.push("u.barangay_id = ?");
    parameters.push(scope.barangayId);
  } else if (!scope.all) {
    return [];
  }

  const [rows] = await db.query<any[]>(
    `
    SELECT
      u.id AS resident_id,
      u.full_name AS resident_name,
      u.email AS resident_email,
      u.created_at,
      u.barangay_id,
      b.name AS barangay_name,
      u.purok_id,
      p.name AS purok_name,
      (
        SELECT weekly_pay.amount
        FROM payments weekly_pay
        WHERE weekly_pay.resident_id = u.id
          AND weekly_pay.category = 'weekly_fee'
          AND weekly_pay.status = 'completed'
        ORDER BY
          COALESCE(
            weekly_pay.admin_confirmed_at,
            weekly_pay.updated_at,
            weekly_pay.created_at
          ) DESC,
          weekly_pay.id DESC
        LIMIT 1
      ) AS last_completed_amount,
      (
        SELECT COALESCE(
          weekly_pay.admin_confirmed_at,
          weekly_pay.updated_at,
          weekly_pay.created_at
        )
        FROM payments weekly_pay
        WHERE weekly_pay.resident_id = u.id
          AND weekly_pay.category = 'weekly_fee'
          AND weekly_pay.status = 'completed'
        ORDER BY
          COALESCE(
            weekly_pay.admin_confirmed_at,
            weekly_pay.updated_at,
            weekly_pay.created_at
          ) DESC,
          weekly_pay.id DESC
        LIMIT 1
      ) AS last_completed_payment_at,
      (
        SELECT weekly_pay.created_at
        FROM payments weekly_pay
        WHERE weekly_pay.resident_id = u.id
          AND weekly_pay.category = 'weekly_fee'
          AND weekly_pay.status = 'completed'
        ORDER BY
          COALESCE(
            weekly_pay.admin_confirmed_at,
            weekly_pay.updated_at,
            weekly_pay.created_at
          ) DESC,
          weekly_pay.id DESC
        LIMIT 1
      ) AS last_completed_submitted_at,
      (
        SELECT COUNT(*)
        FROM payments pending_pay
        WHERE pending_pay.resident_id = u.id
          AND pending_pay.category = 'weekly_fee'
          AND pending_pay.status = 'pending_leader_verification'
      ) AS pending_verification_count,
      (
        SELECT COUNT(*)
        FROM payments pending_pay
        WHERE pending_pay.resident_id = u.id
          AND pending_pay.status IN (
            'pending_leader_verification',
            'pending_remittance',
            'pending_admin_confirmation',
            'discrepancy'
          )
      ) AS pending_payment_count,
      (
        SELECT COALESCE(SUM(pending_pay.amount), 0)
        FROM payments pending_pay
        WHERE pending_pay.resident_id = u.id
          AND pending_pay.status IN (
            'pending_leader_verification',
            'pending_remittance',
            'pending_admin_confirmation',
            'discrepancy'
          )
      ) AS pending_amount
    FROM users u
    INNER JOIN barangays b
      ON b.id = u.barangay_id
    INNER JOIN puroks p
      ON p.id = u.purok_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.name ASC, u.full_name ASC
    `,
    parameters,
  );

  const historyCache =
    new Map<number, any[]>();

  const today =
    startOfLocalDay(new Date());

  const weekMs =
    7 * 24 * 60 * 60 * 1000;

  const result: ResidentComplianceRow[] = [];

  for (const row of rows) {
    const purokId =
      Number(row.purok_id);

    let history =
      historyCache.get(purokId);

    if (!history) {
      history =
        await weeklyFeeHistory(
          purokId,
        );
      historyCache.set(
        purokId,
        history,
      );
    }

    const accountStart =
      row.created_at
        ? startOfLocalDay(
            row.created_at,
          )
        : startOfLocalDay(
            new Date(),
          );

    const lastCompletedDate =
      row.last_completed_payment_at
        ? startOfLocalDay(
            row.last_completed_payment_at,
          )
        : null;

    const baseDate =
      lastCompletedDate ||
      accountStart;

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

    const missedPeriods: {
      due_date: string;
      fee: number;
    }[] = [];

    let missedBalance = 0;

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

      missedBalance += fee;

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

    const lastCompletedAmount =
      row.last_completed_amount === null ||
      row.last_completed_amount === undefined
        ? null
        : Number(
            row.last_completed_amount,
          );

    const lastSubmittedDate =
      row.last_completed_submitted_at
        ? startOfLocalDay(
            row.last_completed_submitted_at,
          )
        : lastCompletedDate;

    const expectedLastFee =
      lastSubmittedDate
        ? feeForDate(
            history,
            lastSubmittedDate,
          )
        : null;

    const underpaidAmount =
      lastCompletedAmount !== null &&
      expectedLastFee !== null
        ? Math.max(
            0,
            expectedLastFee -
              lastCompletedAmount,
          )
        : 0;

    const currentWeeklyFee =
      feeForDate(
        history,
        today,
      );

    result.push({
      resident_id:
        Number(row.resident_id),
      resident_name:
        String(
          row.resident_name || "",
        ),
      resident_email:
        String(
          row.resident_email || "",
        ),
      barangay_id:
        Number(row.barangay_id),
      barangay_name:
        String(
          row.barangay_name || "",
        ),
      purok_id:
        purokId,
      purok_name:
        String(
          row.purok_name || "",
        ),
      current_weekly_fee:
        Math.round(
          currentWeeklyFee * 100,
        ) / 100,
      last_completed_payment_at:
        row.last_completed_payment_at ||
        null,
      last_completed_amount:
        lastCompletedAmount,
      expected_last_fee:
        expectedLastFee === null
          ? null
          : Math.round(
              expectedLastFee * 100,
            ) / 100,
      missed_payment_count:
        missedCount,
      underpaid_amount:
        Math.round(
          underpaidAmount * 100,
        ) / 100,
      outstanding_balance:
        Math.round(
          (
            missedBalance +
            underpaidAmount
          ) * 100,
        ) / 100,
      pending_verification_count:
        Number(row.pending_verification_count || 0),
      pending_payment_count:
        Number(row.pending_payment_count || 0),
      pending_amount:
        Math.round(Number(row.pending_amount || 0) * 100) / 100,
      counting_from:
        localDateString(
          baseDate,
        ),
      missed_periods:
        missedPeriods,
    });
  }

  return result;
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

  const rows =
    await loadResidentComplianceRows({
      residentId:
        Number(viewer.id),
    });

  const compliance =
    rows[0];

  if (!compliance) {
    return null;
  }

  return {
    current_weekly_fee:
      compliance.current_weekly_fee,
    last_completed_payment_at:
      compliance.last_completed_payment_at,
    last_completed_amount:
      compliance.last_completed_amount,
    expected_last_fee:
      compliance.expected_last_fee,
    missed_payment_count:
      compliance.missed_payment_count,
    underpaid_amount:
      compliance.underpaid_amount,
    outstanding_balance:
      compliance.outstanding_balance,
    counting_from:
      compliance.counting_from,
    missed_periods:
      compliance.missed_periods,
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
    LEFT JOIN payment_archives payment_archive
      ON payment_archive.payment_id = pay.id
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
  resident_count: number;
  unpaid_residents: number;
  underpaid_residents: number;
  outstanding_obligation: number;
};

function complianceTotalsByScope(
  rows: ResidentComplianceRow[],
  scope: "barangay" | "purok",
) {
  const totals =
    new Map<
      number,
      {
        resident_count: number;
        unpaid_residents: number;
        underpaid_residents: number;
        outstanding_obligation: number;
      }
    >();

  for (const row of rows) {
    const scopeId =
      scope === "barangay"
        ? row.barangay_id
        : row.purok_id;

    const current =
      totals.get(scopeId) || {
        resident_count: 0,
        unpaid_residents: 0,
        underpaid_residents: 0,
        outstanding_obligation: 0,
      };

    current.resident_count += 1;

    if (
      row.missed_payment_count > 0
    ) {
      current.unpaid_residents += 1;
    }

    if (
      row.underpaid_amount > 0
    ) {
      current.underpaid_residents += 1;
    }

    current.outstanding_obligation +=
      Number(
        row.outstanding_balance ||
          0,
      );

    totals.set(
      scopeId,
      current,
    );
  }

  return totals;
}

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

    const compliance =
      complianceTotalsByScope(
        await loadResidentComplianceRows({
          all: true,
        }),
        "barangay",
      );

    return rows.map((row: any) => {
      const residentStatus =
        compliance.get(
          Number(row.scope_id),
        ) || {
          resident_count: 0,
          unpaid_residents: 0,
          underpaid_residents: 0,
          outstanding_obligation: 0,
        };

      return {
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
      resident_count: residentStatus.resident_count,
      unpaid_residents: residentStatus.unpaid_residents,
      underpaid_residents: residentStatus.underpaid_residents,
      outstanding_obligation:
        Math.round(
          residentStatus.outstanding_obligation * 100,
        ) / 100,
      };
    });
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

    const compliance =
      complianceTotalsByScope(
        await loadResidentComplianceRows({
          barangayId:
            Number(
              viewer.barangay_id,
            ),
        }),
        "purok",
      );

    return rows.map((row: any) => {
      const residentStatus =
        compliance.get(
          Number(row.scope_id),
        ) || {
          resident_count: 0,
          unpaid_residents: 0,
          underpaid_residents: 0,
          outstanding_obligation: 0,
        };

      return {
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
      resident_count: residentStatus.resident_count,
      unpaid_residents: residentStatus.unpaid_residents,
      underpaid_residents: residentStatus.underpaid_residents,
      outstanding_obligation:
        Math.round(
          residentStatus.outstanding_obligation * 100,
        ) / 100,
      };
    });
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
          residentCompliance: [],
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
          "WHERE pay.resident_id = ? AND payment_archive.payment_id IS NULL";
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
          "WHERE pay.purok_id = ? AND payment_archive.payment_id IS NULL";
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

      // Financial totals intentionally read the original payments table,
      // including archived completed transactions. Archiving never changes
      // contributions, payment compliance, or issued payment proof records.
      const totalScopeColumn = viewer.role === "resident"
        ? "resident_id"
        : "purok_id";
      const totalScopeValue = viewer.role === "resident"
        ? viewer.id
        : viewer.purok_id;
      const [financialRows] = await db.query<any[]>(
        `SELECT
           COUNT(*) AS all_record_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS confirmed_total,
           COALESCE(SUM(CASE
             WHEN status IN ('pending_leader_verification', 'pending_remittance',
                            'pending_admin_confirmation', 'discrepancy')
             THEN amount ELSE 0 END), 0) AS pending_total
         FROM payments
         WHERE ${totalScopeColumn} = ?`,
        [totalScopeValue],
      );
      const paymentTotals = {
        all_record_count: Number(financialRows[0]?.all_record_count || 0),
        completed_count: Number(financialRows[0]?.completed_count || 0),
        confirmed_total: Number(financialRows[0]?.confirmed_total || 0),
        pending_total: Number(financialRows[0]?.pending_total || 0),
      };

      const residentFineAmount =
        viewer.role === "resident"
          ? await latestResidentViolationFine(
              Number(viewer.id),
            )
          : null;

      const feeInfo =
        viewer.purok_id
          ? await paymentFeeInfo(
              Number(viewer.purok_id),
            )
          : null;

      const categories =
        paymentCategories.map(
          (item: any) =>
            item.value === "violation_fine" &&
            residentFineAmount !== null
              ? {
                  ...item,
                  amount:
                    residentFineAmount,
                }
              : item.value === "weekly_fee" &&
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

      const residentCompliance =
        viewer.role === "purok_leader"
          ? await loadResidentComplianceRows({
              purokId:
                Number(
                  viewer.purok_id,
                ),
            })
          : [];

      return res.json({
        success: true,
        payments,
        paymentTotals,
        categories,
        weeklyFee: feeInfo,
        paymentReminder,
        residentCompliance,
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

      const submittedReference =
        cleanText(
          req.body.paymentReference ??
            req.body.payment_reference,
          120,
        );
      const paymentReference =
        submittedReference ||
        (paymentMethod === "xendit"
          ? `XENDIT-${Date.now().toString(36).toUpperCase()}-${crypto
              .randomBytes(2)
              .toString("hex")
              .toUpperCase()}`
          : "");

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

      // Residents must submit at least the minimum configured category fee.
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

      if (!receiptProof && paymentMethod !== "xendit") {
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

      let minimumAmount = Number(CATEGORY_AMOUNTS[category] || 0);
      if (category === "weekly_fee") {
        const feeInfo = await paymentFeeInfo(Number(viewer.purok_id), connection);
        minimumAmount = Number(feeInfo.amount);
      } else if (category === "violation_fine") {
        const latestFine = await latestResidentViolationFine(Number(viewer.id), connection);
        if (latestFine !== null) {
          minimumAmount = latestFine;
        }
      }

      if (
        Number.isFinite(minimumAmount) &&
        minimumAmount > 0 &&
        Math.round(amount * 100) < Math.round(minimumAmount * 100)
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Payment amount cannot be below the minimum of PHP ${minimumAmount.toFixed(2)}.`,
        });
      }

      if (revisionsEnabled()) {
        const [online] = await connection.query<any[]>("SELECT id FROM online_payment_attempts WHERE resident_id = ? AND category = ? AND billing_period = ? AND status IN ('creating','pending','paid')", [viewer.id,category,billingPeriod]);
        if (online.length) {
          await connection.rollback();
          return res.status(409).json({message: "An online checkout or verified payment already exists for this billing period."});
        }
      }

      uploadedReceiptProof = receiptProof
        ? await storeProof(
            receiptProof,
            `payments/${viewer.id}/${transactionCode}/receipt.${imageExtensionForDataUrl(receiptProof)}`,
          )
        : JSON.stringify({
            provider: "xendit",
            reference: paymentReference,
            submittedAt: new Date().toISOString(),
          });

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
  ["/:id/leader-review", "/:id/leader-verify"],
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
            pay.id,
            pay.transaction_code,
            pay.amount,
            pay.category,
            pay.billing_period,
            pay.purok_id,
            pay.barangay_id,
            pay.resident_id,
            pay.status,
            u.full_name AS resident_name
          FROM payments pay
          LEFT JOIN users u ON u.id = pay.resident_id
          WHERE pay.id = ?
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

      // The Purok Leader physically receives the payment, so a verified
      // payment is final. Remittance remains only for older records.
      const nextStatus: PaymentStatus =
        action === "approve"
          ? "completed"
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

      await audit(connection, req.user!, action === "approve" ? "payment_received_verified" : "manual_payment_rejected", "payments", paymentId, payment, {
        household: payment.resident_name || `Resident #${payment.resident_id}`,
        transactionCode: payment.transaction_code,
        amount: Number(payment.amount || 0),
        category: payment.category,
        billingPeriod: payment.billing_period,
        remarks,
      });
      await connection.execute(
        `INSERT INTO notifications
         (recipient_user_id, barangay_id, purok_id, title, message, notification_type, created_by)
         VALUES (?, ?, ?, ?, ?, 'payment', ?)`,
        [
          payment.resident_id,
          payment.barangay_id,
          payment.purok_id,
          action === "approve" ? "Payment received" : "Payment rejected",
          action === "approve"
            ? `Your Purok Leader ${viewer.full_name} received and verified your payment.${remarks ? ` ${remarks}` : ""}`
            : `Your Purok Leader rejected your payment record: ${remarks}`,
          viewer.id,
        ],
      );
      await connection.commit();

      return res.json({
        success: true,
        message:
          action === "approve"
            ? "Payment received and verified. It now appears in the resident's payment history."
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
          status = 'completed',
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
          "Remittance recorded. The payment is now completed.",
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
  "/:id/archive",
  requireAuth,
  async (req: AuthRequest, res) => {
    let connection: PoolConnection | null = null;

    try {
      const userId = positiveInteger(req.user?.id);
      const paymentId = positiveInteger(req.params.id);

      if (!userId || !paymentId) {
        return res.status(400).json({
          success: false,
          message: "A valid payment is required.",
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const viewer = await getViewer(userId, connection, true);
      if (!viewer || !["purok_leader", "super_admin"].includes(viewer.role)) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Only an assigned Purok Leader or Municipal Administrator can archive payments.",
        });
      }

      const [paymentRows] = await connection.query<any[]>(
        `SELECT id, transaction_code, purok_id, status
         FROM payments WHERE id = ? LIMIT 1 FOR UPDATE`,
        [paymentId],
      );
      const payment = paymentRows[0];
      if (!payment) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Payment was not found.",
        });
      }

      if (
        viewer.role === "purok_leader" &&
        (!viewer.purok_id || Number(viewer.purok_id) !== Number(payment.purok_id))
      ) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "You may archive payments only for your assigned purok.",
        });
      }

      if (payment.status !== "completed") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Only completed payments can be archived.",
        });
      }

      await connection.execute(
        `INSERT INTO payment_archives (payment_id, archived_by)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE payment_id = payment_id`,
        [paymentId, userId],
      );

      await connection.commit();
      return res.json({
        success: true,
        archived: true,
        message: `Payment ${payment.transaction_code} archived. Contribution, proof and records are preserved.`,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      console.error("Archive payment error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to archive payment.",
      });
    } finally {
      connection?.release();
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
            "Municipal Administrator access is required to archive payment records.",
        });
      }

      const [rows] =
        await connection.query<any[]>(
          `
          SELECT
            id,
            transaction_code,
            status
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

      if (payment.status !== "completed") {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Only completed payments can be archived.",
        });
      }

      const [result] = await connection.execute<any>(
        `INSERT INTO payment_archives (payment_id, archived_by)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE payment_id = payment_id`,
        [paymentId, userId],
      );

      if (result.affectedRows !== 0 && result.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Payment record could not be archived.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        archived: true,
        message:
          `Payment ${payment.transaction_code} was archived. Its proof and financial record were preserved.`,
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
          "Unable to archive the payment record.",
      });
    } finally {
      connection?.release();
    }
  },
);


export default router;
