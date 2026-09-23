import type {
  NextFunction,
  Request,
  Response,
} from "express";
import jwt from "jsonwebtoken";
import { db } from "../config/db.js";
import { getJwtSecret } from "../config/security.js";
import { requiresEmailVerification } from "../services/emailVerification.js";

export interface AuthUser {
  id: number;
  role: string;
  email: string;
  barangay_id?: number | null;
  purok_id?: number | null;
  status?: string;
  must_change_password?: number | boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

async function authenticateRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  allowPendingResident: boolean,
  allowTemporaryPassword: boolean,
) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  let jwtSecret: string;

  try {
    jwtSecret = getJwtSecret();
  } catch {
    console.error("JWT_SECRET is missing or insecure.");
    return res.status(500).json({
      success: false,
      message: "Server authentication is not configured.",
    });
  }

  try {
    const decoded = jwt.verify(
      header.slice(7),
      jwtSecret,
    ) as AuthUser;

    const userId = Number(decoded.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Invalid token subject.");
    }

    // Authorization is always based on the current database record. This
    // immediately applies role changes, tenant reassignments, and account
    // deactivation instead of trusting stale claims for up to 12 hours.
    const [rows] = await db.query<any[]>(
      `
      SELECT
        id,
        role,
        email,
        barangay_id,
        purok_id,
        status,
        must_change_password,
        email_verified_at,
        EXISTS (SELECT 1 FROM email_verifications ev WHERE ev.user_id = users.id) AS has_email_verification
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [userId],
    );

    const currentUser = rows[0];

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "This login session no longer belongs to an account.",
      });
    }

    const currentStatus = String(currentUser.status).toLowerCase();
    if (currentStatus !== "inactive" && requiresEmailVerification(currentUser)) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_VERIFICATION_REQUIRED",
        requiresEmailVerification: true,
        message: "Please verify your email before signing in.",
      });
    }

    const isAllowedPendingResident =
      allowPendingResident &&
      currentStatus === "pending" &&
      String(currentUser.role).toLowerCase() === "resident";

    if (currentStatus !== "active" && !isAllowedPendingResident) {
      return res.status(403).json({
        success: false,
        message: "This account is inactive or awaiting approval.",
      });
    }

    if (
      Boolean(currentUser.must_change_password) &&
      !allowTemporaryPassword
    ) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Change the temporary password before using the system.",
      });
    }

    req.user = {
      id: Number(currentUser.id),
      role: String(currentUser.role || ""),
      email: String(currentUser.email || ""),
      barangay_id:
        currentUser.barangay_id === undefined
          ? null
          : currentUser.barangay_id,
      purok_id:
        currentUser.purok_id === undefined
          ? null
          : currentUser.purok_id,
      status: String(currentUser.status || ""),
      must_change_password: Boolean(currentUser.must_change_password),
    };

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token.",
      });
    }

    console.error("Authentication lookup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to validate the login session.",
    });
  }
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  return authenticateRequest(req, res, next, false, false);
}

/**
 * Allows a pending resident to read/finish only the account-profile flow.
 * Domain routes must continue using requireAuth.
 */
export function requireAuthenticatedAccount(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  return authenticateRequest(req, res, next, true, false);
}

/** Allows session restoration before the required first-login password change. */
export function requireSessionAccount(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  return authenticateRequest(req, res, next, true, true);
}

/** Allows only the authenticated temporary-password replacement flow. */
export function requireTemporaryPasswordAccount(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  return authenticateRequest(req, res, next, false, true);
}
