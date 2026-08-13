import type {
  NextFunction,
  Request,
  Response,
} from "express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  id: number;
  role: string;
  email: string;
  barangay_id?: number | null;
  purok_id?: number | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  try {
    const decoded = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET || "change-me",
    ) as AuthUser;

    req.user = {
      id: Number(decoded.id),
      role: String(decoded.role || ""),
      email: String(decoded.email || ""),
      barangay_id:
        decoded.barangay_id === undefined
          ? null
          : decoded.barangay_id,
      purok_id:
        decoded.purok_id === undefined
          ? null
          : decoded.purok_id,
    };

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}