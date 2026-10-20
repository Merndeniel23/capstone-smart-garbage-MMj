import { Resend } from "resend";

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code = "EMAIL_DELIVERY_FAILED",
    public readonly status = 503,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export function getResendClient() {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  return key ? new Resend(key) : null;
}

export function getResendFromAddress() {
  const sender = String(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || "").trim();
  if (!sender || /YOUR-VERIFIED-SENDER|YOUR-DOMAIN|noreply@example\.com/i.test(sender)) {
    throw new EmailDeliveryError(
      "Email sending is not configured. Please ask the administrator to configure the verification email sender.",
      "EMAIL_NOT_CONFIGURED",
    );
  }
  return sender;
}

export function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Translate provider details without returning credentials, recipients or raw errors. */
export function emailDeliveryError(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  const detail = error as { statusCode?: number; name?: string; message?: string } | null;
  const providerStatus = Number(detail?.statusCode);
  if (providerStatus === 403 && /testing emails|own email|verify.*domain|domain.*verif/i.test(String(detail?.message || ""))) {
    return new EmailDeliveryError(
      "The email provider cannot send verification codes to this recipient until the administrator configures a verified sending domain in Resend. Your account has not been activated.",
      "EMAIL_DOMAIN_NOT_VERIFIED",
    );
  }
  if (providerStatus === 401 || providerStatus === 403) {
    return new EmailDeliveryError(
      "The email service configuration needs administrator attention. Your account has not been activated.",
      "EMAIL_CONFIGURATION_ERROR",
    );
  }
  return new EmailDeliveryError(
    "The verification email could not be sent. Please try again later. Your account has not been activated.",
  );
}

export async function sendVerificationOtp(email: string, fullName: string, otp: string) {
  const client = getResendClient();
  if (!client) {
    throw new EmailDeliveryError(
      "Email verification is not configured on the server. Please contact the administrator.",
      "EMAIL_NOT_CONFIGURED",
    );
  }

  try {
    const { error } = await client.emails.send({
      from: getResendFromAddress(),
      to: email,
      subject: "Smart Garbage Monitoring System — Email Verification",
      text: `Smart Garbage Monitoring System\nEmail Verification\n\nHello ${fullName},\n\nYour verification code is:\n${otp}\n\nThis code expires in 10 minutes.\nIf you did not request this account, ignore this message.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;line-height:1.6">
        <h2>Smart Garbage Monitoring System</h2><h3>Email Verification</h3>
        <p>Hello ${escapeEmailHtml(fullName)},</p><p>Your verification code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p>
        <p>This code expires in 10 minutes.</p>
        <p>If you did not request this account, ignore this message.</p>
      </div>`,
    });
    if (error) throw error;
  } catch (error) {
    const safeError = emailDeliveryError(error);
    // Never log the send payload, OTP, API key, or provider response body.
    console.error("Verification email delivery failed", { code: safeError.code });
    throw safeError;
  }
}
