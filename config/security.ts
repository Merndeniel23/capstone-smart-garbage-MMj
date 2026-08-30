/**
 * Application security policy shared by the HTTP server and auth routes.
 * Keeping these checks in one place prevents one code path from accepting a
 * weak secret or a password that another code path would reject.
 */
export const MAX_PASSWORD_LENGTH = 72;

export function isStrongJwtSecret(value: unknown): value is string {
  const secret = String(value || "").trim();

  if (secret.length < 32 || secret.length > 512) return false;

  // Reject the placeholders shipped in examples and common weak defaults.
  if (/^(?:change[-_ ]?me|replace[-_ ]?with|put[-_ ]?a[-_ ]?new|your[-_ ]?)/i.test(secret)) {
    return false;
  }

  return new Set(secret).size >= 12;
}

export function getJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!isStrongJwtSecret(secret)) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters, unique, and not a placeholder.",
    );
  }

  return secret;
}

export function isStrongPassword(value: unknown): value is string {
  const password = String(value || "");

  return (
    password.length >= 8 &&
    password.length <= MAX_PASSWORD_LENGTH &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}
