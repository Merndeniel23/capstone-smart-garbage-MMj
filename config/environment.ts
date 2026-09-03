import dotenv from "dotenv";
import { isStrongJwtSecret } from "./security.js";

// Load configuration before any route or integration reads process.env.
dotenv.config();

function isPlaceholder(value: string) {
  return /^(?:your[-_ ]|replace[-_ ]?with|put[-_ ]?a[-_ ]?strong|change[-_ ]?me)/i.test(
    value.trim(),
  );
}

function isValidProductionOrigin(value: string) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isValidHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateProductionEnvironment() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    return;
  }

  const errors: string[] = [];
  const origins = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins.length || origins.some((origin) => !isValidProductionOrigin(origin))) {
    errors.push(
      "CORS_ORIGINS must contain one or more HTTPS application origins (for example https://app.example.com).",
    );
  }

  if (!isStrongJwtSecret(process.env.JWT_SECRET)) {
    errors.push("JWT_SECRET must be a unique secret with at least 32 characters.");
  }

  if (
    !String(process.env.DB_HOST || "").trim() ||
    !String(process.env.DB_USER || "").trim() ||
    !String(process.env.DB_NAME || "").trim() ||
    !String(process.env.DB_PASSWORD || "").trim()
  ) {
    errors.push("DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are required in production.");
  }

  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  const resendFrom = String(process.env.RESEND_FROM_EMAIL || "").trim();

  if (!resendApiKey || isPlaceholder(resendApiKey)) {
    errors.push("RESEND_API_KEY must be configured for registration and password recovery email.");
  }

  if (
    !resendFrom ||
    resendFrom.includes("onboarding@resend.dev") ||
    isPlaceholder(resendFrom) ||
    /noreply@example\.com/i.test(resendFrom)
  ) {
    errors.push("RESEND_FROM_EMAIL must use a sender from a verified production domain.");
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const supabaseKey = String(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();

  if (supabaseUrl || supabaseKey) {
    if (
      !supabaseUrl ||
      !isValidHttpsUrl(supabaseUrl) ||
      !supabaseKey ||
      isPlaceholder(supabaseKey)
    ) {
      errors.push(
        "SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy service-role key) must both be valid HTTPS/private storage credentials, or both be left blank.",
      );
    }
  }

  if (errors.length) {
    throw new Error(`Production environment is invalid:\n- ${errors.join("\n- ")}`);
  }
}
