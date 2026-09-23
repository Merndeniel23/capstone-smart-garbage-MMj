import { useEffect, useId, useState, type FormEvent } from "react";
import { Loader2, Mail } from "lucide-react";

interface EmailVerificationFormProps {
  email?: string;
  initialResendAfter?: number;
  variant?: "auth" | "management";
  onVerified: (email: string) => void;
  onBack: () => void;
  backLabel?: string;
}

function maskedEmail(email: string) {
  const [name, domain] = email.split("@");
  return domain ? `${name.slice(0, 1)}***@${domain}` : "your email";
}

export default function EmailVerificationForm({
  email = "",
  initialResendAfter = 0,
  variant = "auth",
  onVerified,
  onBack,
  backLabel = "Back to Sign In",
}: EmailVerificationFormProps) {
  const fieldId = useId();
  const [verificationEmail, setVerificationEmail] = useState(email);
  const [hasCode, setHasCode] = useState(Boolean(email));
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(() => Date.now() + initialResendAfter * 1000);
  const [countdown, setCountdown] = useState(initialResendAfter);
  const isAuth = variant === "auth";

  useEffect(() => {
    const updateCountdown = () => setCountdown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const applyCooldown = (data: { resendAfter?: number; retryAfter?: number }, fallback = 0) => {
    const seconds = Number(data.resendAfter ?? data.retryAfter ?? fallback);
    if (Number.isFinite(seconds) && seconds > 0) setResendAt(Date.now() + seconds * 1000);
  };

  const sendCode = async () => {
    if (busy || countdown > 0) return;
    const normalizedEmail = verificationEmail.trim().toLowerCase();
    setError("");
    setNotice("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter the email address used to create your account.");
      return;
    }
    setBusy("send");
    try {
      const response = await fetch("/api/auth/resend-registration-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}));
      applyCooldown(data, response.ok ? 60 : 0);
      if (!response.ok) {
        // A recent code can still be entered while the resend cooldown runs.
        if (response.status === 429 && Number(data.resendAfter ?? data.retryAfter) > 0) setHasCode(true);
        setError(data.message || "Unable to send the verification code. Please try again.");
        return;
      }
      setVerificationEmail(normalizedEmail);
      setHasCode(true);
      setOtp("");
      setNotice(data.message || "A new verification code was sent. Check your inbox and spam folder.");
    } catch {
      setError("Cannot connect to the server. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!hasCode) {
      await sendCode();
      return;
    }
    setError("");
    setNotice("");
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit verification code sent to your email.");
      return;
    }
    setBusy("verify");
    try {
      const normalizedEmail = verificationEmail.trim().toLowerCase();
      const response = await fetch("/api/auth/verify-registration-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, otp }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        applyCooldown(data);
        setError(data.message || "Unable to verify this code. Please try again.");
        return;
      }
      onVerified(normalizedEmail);
    } catch {
      setError("Cannot connect to the server. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={verifyCode} className={isAuth ? "auth-form" : "space-y-4"}>
      <div className="space-y-2 text-center">
        <Mail className={`${isAuth ? "auth-accent" : ""} mx-auto h-9 w-9 text-emerald-700`} />
        <h2 className={`text-lg font-extrabold ${isAuth ? "text-stone-800" : "text-slate-900"}`}>Verify Your Email</h2>
        <p className={`text-sm ${isAuth ? "text-stone-500" : "text-slate-500"}`}>
          {hasCode ? <>We sent a 6-digit verification code to <strong className="break-all">{maskedEmail(verificationEmail)}</strong>.</> : "Enter your account email to request a verification code."}
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      <div className={isAuth ? "auth-field" : "space-y-2"}>
        <label htmlFor={fieldId} className={`block text-xs font-bold ${isAuth ? "text-stone-600" : "text-slate-600"}`}>
          {hasCode ? "Verification code" : "Account email"}
        </label>
        <input
          id={fieldId}
          type={hasCode ? "text" : "email"}
          inputMode={hasCode ? "numeric" : "email"}
          autoComplete={hasCode ? "one-time-code" : "email"}
          maxLength={hasCode ? 6 : 150}
          pattern={hasCode ? "[0-9]{6}" : undefined}
          required
          disabled={Boolean(busy)}
          value={hasCode ? otp : verificationEmail}
          onChange={(event) => hasCode ? setOtp(event.target.value.replace(/\D/g, "").slice(0, 6)) : setVerificationEmail(event.target.value)}
          placeholder={hasCode ? "6-digit code" : "Your account email"}
          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:opacity-60 ${hasCode ? "text-center tracking-[0.3em]" : ""} ${isAuth ? "auth-input border-stone-200 bg-[#FAFBF9] text-stone-800" : "border-slate-200 bg-slate-50 text-slate-800"}`}
        />
        {hasCode && <p className={`text-xs ${isAuth ? "text-stone-500" : "text-slate-500"}`}>Codes expire after 10 minutes. Requesting a new code replaces the previous one.</p>}
      </div>

      <button type="submit" disabled={Boolean(busy) || (!hasCode && countdown > 0)} className={`${isAuth ? "auth-primary-action" : ""} flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60`}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy === "verify" ? "Verifying..." : busy === "send" ? "Sending..." : hasCode ? "Verify Email" : "Send Verification Code"}
      </button>

      <div className={`${isAuth ? "auth-actions auth-login-actions" : "flex flex-wrap items-center justify-between gap-3"} text-xs font-bold`}>
        {hasCode && <button type="button" disabled={Boolean(busy) || countdown > 0} onClick={() => void sendCode()} className={`${isAuth ? "auth-accent" : ""} text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50`}>
          {countdown > 0 ? `Resend OTP in ${countdown}s` : "Resend OTP"}
        </button>}
        <button type="button" disabled={Boolean(busy)} onClick={onBack} className={`${isAuth ? "text-stone-500 hover:text-stone-700" : "text-slate-500 hover:text-slate-700"} disabled:opacity-50`}>{backLabel}</button>
      </div>
    </form>
  );
}
