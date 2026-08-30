import React, { useState } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  LogOut,
} from "lucide-react";

export default function ChangeInitialPassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const getDashboardScreen = () => {
    const role =
      localStorage.getItem("sg_user_role") ||
      sessionStorage.getItem("sg_user_role");

    if (role === "super_admin") return "super-admin-dashboard";
    if (role === "admin") return "admin-dashboard";
    if (role === "collector") return "collector-tasks";
    if (role === "leader") return "leader-dashboard";

    return "dashboard";
  };

  const handleBackToLogin = () => {
    const keys = [
      "token",
      "authToken",
      "sg_current_user",
      "sg_is_logged_in",
      "sg_user_role",
      "sg_current_screen",
      "sg_temp_login_email",
      "sg_requires_location_setup",
      "sg_pending_approval",
      "sg_user",
      "user",
    ];

    for (const key of keys) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }

    window.location.reload();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError("");
    setSuccessMessage("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please complete all password fields.");
      return;
    }

    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      setError(
        "Use at least 8 characters with uppercase, lowercase, and a number.",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("Choose a password different from the temporary password.");
      return;
    }

    const token =
      localStorage.getItem("token") ||
      sessionStorage.getItem("token");

    if (!token) {
      setError("Your login session is missing. Please sign in again.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        "/api/auth/change-temporary-password",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to change the temporary password.",
        );
      }

      const dashboardScreen = getDashboardScreen();
      const storage = localStorage.getItem("token")
        ? localStorage
        : sessionStorage;

      storage.setItem("sg_current_screen", dashboardScreen);
      storage.removeItem("sg_temp_login_email");

      setSuccessMessage(
        data.message ||
          "Password changed successfully. Opening your dashboard...",
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change the temporary password.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-8 w-8" />
          </div>
        </div>

        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Account Security
          </p>

          <h1 className="mt-1 text-2xl font-black text-slate-900">
            Change Temporary Password
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            You must replace your temporary password before accessing your
            dashboard.
          </p>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-600">
              Temporary Password
            </span>

            <div className="relative mt-2">
              <Lock className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />

              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10"
                placeholder="Enter temporary password"
              />

              <button
                type="button"
                onClick={() =>
                  setShowCurrentPassword((current) => !current)
                }
                className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                aria-label={
                  showCurrentPassword
                    ? "Hide temporary password"
                    : "Show temporary password"
                }
              >
                {showCurrentPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">
              New Password
            </span>

            <div className="relative mt-2">
              <Lock className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />

              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10"
                placeholder="At least 8 characters"
              />

              <button
                type="button"
                onClick={() => setShowNewPassword((current) => !current)}
                className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                aria-label={
                  showNewPassword ? "Hide new password" : "Show new password"
                }
              >
                {showNewPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">
              Confirm New Password
            </span>

            <div className="relative mt-2">
              <Lock className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />

              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10"
                placeholder="Repeat new password"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword((current) => !current)
                }
                className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                aria-label={
                  showConfirmPassword
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Changing Password..." : "Change Password"}
          </button>

          <button
            type="button"
            onClick={handleBackToLogin}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            Back to Login
          </button>
        </form>
      </div>
    </div>
  );
}
