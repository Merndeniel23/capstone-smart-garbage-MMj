import { apiFetch } from "../services/http";
import React, { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ChevronDown,
  HelpCircle,
  ImagePlus,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { useAppState } from "../context/AppStateContext";

interface RegistrationBarangay {
  id: number;
  name: string;
}

interface RegistrationPurok {
  id: number;
  barangay_id: number;
  name: string;
  barangay_name?: string;
}

interface ProfileUser {
  id: number;
  full_name: string;
  email: string;
  role: "super_admin" | "admin" | "resident" | "collector" | "purok_leader";
  phone: string | null;
  address: string | null;
  status: string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
  profile_photo: string | null;
  created_at?: string;
}

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}

async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
) {
  const token = getToken();

  if (!token) {
    throw new Error("Login session is missing. Please log in again.");
  }

  const response = await apiFetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

// Standardize displayed numbers as Philippine 11-digit mobile numbers.
// Existing +63/63 mobile records can be shown using their local 09 format.
function sanitizePhoneInput(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.startsWith("639") ? `0${digits.slice(2)}` : digits;
  return local.slice(0, 11);
}

function isValidPhone(value: string) {
  return /^09\d{9}$/.test(value);
}

function roleLabel(role?: ProfileUser["role"]) {
  switch (role) {
    case "super_admin":
      return "Municipal Administrator";
    case "admin":
      return "Barangay Captain";
    case "purok_leader":
      return "Purok Leader";
    case "collector":
      return "Garbage Collector";
    default:
      return "Resident";
  }
}

function userCode(user: ProfileUser | null) {
  if (!user) return "";

  const prefix =
    user.role === "super_admin"
      ? "SA"
      : user.role === "admin"
      ? "BC"
      : user.role === "purok_leader"
        ? "PL"
        : user.role === "collector"
          ? "GC"
          : "CV";

  return `${prefix}-${String(user.id).padStart(4, "0")}`;
}

function prepareProfilePhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      reject(new Error("Choose a JPG, PNG, or WebP image."));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Unable to read that image."));
    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error("That image could not be loaded."));
      image.onload = () => {
        const maxDimension = 512;
        const scale = Math.min(
          1,
          maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

        const context = canvas.getContext("2d");

        if (!context) {
          reject(new Error("Your browser cannot process that image."));
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.84);

        if (dataUrl.length > 4_800_000) {
          reject(new Error("That image is still too large. Choose a smaller photo."));
          return;
        }

        resolve(dataUrl);
      };

      image.src = String(reader.result || "");
    };

    reader.readAsDataURL(file);
  });
}

export default function UserProfilePanel() {
  const { updateProfile } = useAppState();
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoDraft, setPhotoDraft] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  const [registrationBarangays, setRegistrationBarangays] =
    useState<RegistrationBarangay[]>([]);
  const [registrationPuroks, setRegistrationPuroks] =
    useState<RegistrationPurok[]>([]);
  const [setupBarangayId, setSetupBarangayId] =
    useState("");
  const [setupPurokId, setSetupPurokId] =
    useState("");
  const [locationsLoading, setLocationsLoading] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState("");
  const [error, setError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmNextPassword, setConfirmNextPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [securityVisible, setSecurityVisible] = useState(false);
  const [securityView, setSecurityView] = useState<"password" | "email" | "change-email">("password");

  // Reset an account password from Profile using the existing email-OTP flow.
  // This does not change the account email; that remains a separate protected action.
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNextPassword, setResetNextPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStage, setResetStage] = useState<"email" | "otp" | "password" | "done">("email");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [showResetPasswords, setShowResetPasswords] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");

  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionAddress, setCorrectionAddress] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSuccess, setCorrectionSuccess] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);

  const isCivilian = profile?.role === "resident";

  const needsInitialResidentSetup =
    isCivilian &&
    Boolean(
      !profile?.barangay_id ||
      !profile?.purok_id ||
      !profile?.address?.trim() ||
      !profile?.phone?.trim(),
    );

  const isPendingResidentApproval =
    isCivilian &&
    profile?.status === "pending" &&
    !needsInitialResidentSetup;

  const filteredSetupPuroks = useMemo(() => {
    const barangayId = Number(setupBarangayId);

    if (!barangayId) {
      return [];
    }

    return registrationPuroks.filter(
      (purok) =>
        Number(purok.barangay_id) === barangayId,
    );
  }, [registrationPuroks, setupBarangayId]);

  const assignmentText = useMemo(() => {
    if (!profile) return "No assignment";

    if (profile.role === "collector") {
      return profile.barangay_name
        ? `${profile.barangay_name} · Barangay-wide collection`
        : "No barangay assigned";
    }

    return [
      profile.purok_name,
      profile.barangay_name,
    ]
      .filter(Boolean)
      .join(", ") || "No purok assigned";
  }, [profile]);

  const loadProfile = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/auth/me");
      const user = data.user as ProfileUser;

      setProfile(user);
      // Prefill with the logged-in account's verified email, not an arbitrary account.
      setResetEmail(user.email || "");
      setProfilePhoto(user.profile_photo || null);
      setPhotoDraft(null);
      setName(user.full_name || "");
      setPhone(sanitizePhoneInput(user.phone || ""));
      setAddress(user.address || "");
      setCorrectionAddress(user.address || "");
      setSetupBarangayId(
        user.barangay_id
          ? String(user.barangay_id)
          : "",
      );
      setSetupPurokId(
        user.purok_id
          ? String(user.purok_id)
          : "",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load profile.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handlePhotoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError("");

    try {
      setPhotoDraft(await prepareProfilePhoto(file));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to prepare the profile picture.",
      );
    }
  };

  const handleSavePhoto = async () => {
    if (!photoDraft) return;

    setPhotoSaving(true);
    setError("");
    setNotif("");

    try {
      const data = await apiRequest("/auth/profile-photo", {
        method: "PUT",
        body: JSON.stringify({ photoDataUrl: photoDraft }),
      });
      const savedPhoto = data.profilePhoto || photoDraft;

      setProfilePhoto(savedPhoto);
      setPhotoDraft(null);
      setProfile((previous) =>
        previous
          ? { ...previous, profile_photo: savedPhoto }
          : previous,
      );
      updateProfile({ profilePhoto: savedPhoto });
      setNotif(data.message || "Profile picture updated successfully.");
      window.setTimeout(() => setNotif(""), 4000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update the profile picture.",
      );
    } finally {
      setPhotoSaving(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (photoDraft) {
      setPhotoDraft(null);
      return;
    }

    if (!profilePhoto) return;

    setPhotoSaving(true);
    setError("");
    setNotif("");

    try {
      const data = await apiRequest("/auth/profile-photo", {
        method: "PUT",
        body: JSON.stringify({ photoDataUrl: null }),
      });

      setProfilePhoto(null);
      setProfile((previous) =>
        previous
          ? { ...previous, profile_photo: null }
          : previous,
      );
      updateProfile({ profilePhoto: null });
      setNotif(data.message || "Profile picture removed.");
      window.setTimeout(() => setNotif(""), 4000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to remove the profile picture.",
      );
    } finally {
      setPhotoSaving(false);
    }
  };

  useEffect(() => {
    if (!needsInitialResidentSetup) {
      return;
    }

    let cancelled = false;

    const loadLocations = async () => {
      setLocationsLoading(true);

      try {
        const data = await apiRequest(
          "/auth/registration-locations",
        );

        if (cancelled) return;

        setRegistrationBarangays(
          Array.isArray(data.barangays)
            ? data.barangays
            : [],
        );

        setRegistrationPuroks(
          Array.isArray(data.puroks)
            ? data.puroks
            : [],
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load barangay and purok options.",
          );
        }
      } finally {
        if (!cancelled) {
          setLocationsLoading(false);
        }
      }
    };

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, [needsInitialResidentSetup]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    setError("");
    setNotif("");

    if (!name.trim()) {
      setError("Full name is required.");
      return;
    }

    const cleanPhone = sanitizePhoneInput(phone);

    if (cleanPhone && !isValidPhone(cleanPhone)) {
      setError(
        "Enter an 11-digit Philippine mobile number starting with 09 (e.g. 09123456789).",
      );
      return;
    }

    if (needsInitialResidentSetup) {
      if (!cleanPhone) {
        setError(
          "Mobile number is required to complete your resident profile.",
        );
        return;
      }

      if (!setupBarangayId || !setupPurokId) {
        setError(
          "Select your barangay and purok before continuing.",
        );
        return;
      }

      const selectedPurok =
        registrationPuroks.find(
          (purok) =>
            Number(purok.id) ===
            Number(setupPurokId),
        );

      if (
        !selectedPurok ||
        Number(selectedPurok.barangay_id) !==
          Number(setupBarangayId)
      ) {
        setError(
          "Select a valid purok under your chosen barangay.",
        );
        return;
      }

      if (!address.trim()) {
        setError(
          "Physical address is required to complete your resident profile.",
        );
        return;
      }
    }

    setPhone(cleanPhone);
    setSaving(true);

    try {
      const data = await apiRequest("/auth/update-profile", {
        method: "PUT",
        body: JSON.stringify({
          fullName: name.trim(),
          phone: cleanPhone,
          address: address.trim(),
          ...(needsInitialResidentSetup
            ? {
                purokId: Number(setupPurokId),
              }
            : {}),
        }),
      });

      const updatedUser = data.user as ProfileUser;

      setProfile(updatedUser);
      setName(updatedUser.full_name || "");
      setPhone(sanitizePhoneInput(updatedUser.phone || ""));
      setAddress(updatedUser.address || "");
      setSetupBarangayId(
        updatedUser.barangay_id
          ? String(updatedUser.barangay_id)
          : "",
      );
      setSetupPurokId(
        updatedUser.purok_id
          ? String(updatedUser.purok_id)
          : "",
      );
      setProfilePhoto(updatedUser.profile_photo || null);

      if (
        updatedUser.barangay_id &&
        updatedUser.purok_id &&
        updatedUser.address &&
        updatedUser.phone
      ) {
        localStorage.removeItem(
          "sg_requires_location_setup",
        );
      }

      if (
        updatedUser.role === "resident" &&
        updatedUser.status === "pending"
      ) {
        localStorage.setItem(
          "sg_pending_approval",
          "true",
        );
        localStorage.setItem(
          "sg_current_screen",
          "profile",
        );
      } else {
        localStorage.removeItem(
          "sg_pending_approval",
        );
      }

      localStorage.setItem(
        "sg_current_user",
        JSON.stringify({
          name: updatedUser.full_name,
          email: updatedUser.email,
          phone: updatedUser.phone || "",
          address: updatedUser.address || "",
          communalZone: [
            updatedUser.purok_name,
            updatedUser.barangay_name,
          ]
            .filter(Boolean)
            .join(", "),
          role:
            updatedUser.role === "purok_leader"
              ? "leader"
              : updatedUser.role === "resident"
                ? "household"
                : updatedUser.role,
          householdId: userCode(updatedUser),
          profilePhoto: updatedUser.profile_photo || null,
        }),
      );

      const pendingApproval =
        updatedUser.role === "resident" &&
        updatedUser.status === "pending";

      setNotif(
        pendingApproval
          ? "Profile submitted. Please wait for Barangay Captain approval before using the resident dashboard."
          : data.message || "Profile updated successfully.",
      );

      if (pendingApproval) {
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
      } else {
        window.setTimeout(
          () => setNotif(""),
          4000,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/.test(nextPassword)) {
      setPasswordError("New password needs 8-72 characters with uppercase, lowercase, and a number.");
      return;
    }
    if (nextPassword !== confirmNextPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const data = await apiRequest("/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword: nextPassword, confirmPassword: confirmNextPassword }),
      });
      setPasswordMessage(data.message || "Password updated.");
      setCurrentPassword("");
      setNextPassword("");
      setConfirmNextPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  // The existing /forgot-password, /verify-otp and /reset-password routes
  // already support the required OTP check. Calling them here lets residents
  // reset their password without signing out or needing their current password.
  const passwordResetRequest = async (endpoint: string, payload: Record<string, string>) => {
    const response = await apiFetch(`/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Unable to complete email verification.");
    }
    return data;
  };

  const requestProfileResetOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetError("");
    setResetMessage("");
    const registeredEmail = String(profile?.email || "").trim().toLowerCase();
    const candidate = resetEmail.trim().toLowerCase();
    if (!registeredEmail || candidate !== registeredEmail) {
      setResetError("Use the registered email address shown on your profile.");
      return;
    }
    setResetSaving(true);
    try {
      await passwordResetRequest("forgot-password", { email: registeredEmail });
      setResetEmail(registeredEmail);
      setResetOtp("");
      setResetNextPassword("");
      setResetConfirmPassword("");
      setResetStage("otp");
      setResetMessage("A six-digit verification code was requested for your registered email. Check your inbox.");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Unable to request the OTP.");
    } finally {
      setResetSaving(false);
    }
  };

  const verifyProfileResetOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetError("");
    setResetMessage("");
    if (!/^\d{6}$/.test(resetOtp)) {
      setResetError("Enter your six-digit email verification code.");
      return;
    }
    setResetSaving(true);
    try {
      await passwordResetRequest("verify-otp", { email: resetEmail, otp: resetOtp });
      setResetStage("password");
      setResetMessage("Email verified. Enter your new password below.");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Incorrect or expired OTP.");
    } finally {
      setResetSaving(false);
    }
  };

  const saveProfileResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetError("");
    setResetMessage("");
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/.test(resetNextPassword)) {
      setResetError("New password needs 8-72 characters with uppercase, lowercase, and a number.");
      return;
    }
    if (resetNextPassword !== resetConfirmPassword) {
      setResetError("New passwords do not match.");
      return;
    }
    setResetSaving(true);
    try {
      await passwordResetRequest("reset-password", {
        email: resetEmail,
        otp: resetOtp,
        newPassword: resetNextPassword,
      });
      // Keep the existing login session and account role untouched.
      setResetNextPassword("");
      setResetConfirmPassword("");
      setResetOtp("");
      setResetStage("done");
      setResetMessage("Password updated successfully. You can continue using your account without logging out.");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Unable to reset your password.");
      // The server revalidates OTP here: a verified-but-expired code cannot be used.
    } finally {
      setResetSaving(false);
    }
  };

  const restartProfileReset = () => {
    setResetEmail(profile?.email || "");
    setResetOtp("");
    setResetNextPassword("");
    setResetConfirmPassword("");
    setResetStage("email");
    setResetError("");
    setResetMessage("");
  };

  const handleRequestEmailChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError("");
    setEmailMessage("");
    const candidate = newEmail.trim().toLowerCase();
    if (!candidate || candidate === (profile?.email || "").toLowerCase()) {
      setEmailError("Enter a different email address.");
      return;
    }
    setEmailSaving(true);
    try {
      const data = await apiRequest("/auth/request-email-change", {
        method: "POST",
        body: JSON.stringify({ newEmail: candidate, currentPassword: emailPassword }),
      });
      setNewEmail(candidate);
      setEmailPending(true);
      setEmailOtp("");
      setEmailPassword("");
      setEmailMessage(data.message || "Check your new email for the six-digit code.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Unable to send verification code.");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleConfirmEmailChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError("");
    setEmailMessage("");
    setEmailSaving(true);
    try {
      const data = await apiRequest("/auth/confirm-email-change", {
        method: "POST",
        body: JSON.stringify({ newEmail: newEmail.trim().toLowerCase(), otp: emailOtp.trim() }),
      });
      // Keep the current authenticated session in sync with the updated address.
      if (typeof data.token === "string") {
        if (localStorage.getItem("token")) localStorage.setItem("token", data.token);
        if (sessionStorage.getItem("token")) sessionStorage.setItem("token", data.token);
      }
      const updatedEmail = String(data.email || newEmail).toLowerCase();
      setProfile((prev) => prev ? { ...prev, email: updatedEmail } : prev);
      updateProfile({ email: updatedEmail });
      setNewEmail("");
      setEmailOtp("");
      setEmailPending(false);
      setEmailMessage(data.message || "Email updated successfully.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Unable to verify new email.");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleCorrectionSubmit = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    setCorrectionError("");
    setCorrectionSuccess("");

    if (!correctionAddress.trim()) {
      setCorrectionError(
        "Please provide your requested corrected address.",
      );
      return;
    }

    if (!correctionReason.trim()) {
      setCorrectionError(
        "Please explain why the correction is needed.",
      );
      return;
    }

    if (!profile?.purok_id) {
      setCorrectionError(
        "Your account has no assigned purok. Please contact the Barangay Captain.",
      );
      return;
    }

    setCorrectionSubmitting(true);

    try {
      const data = await apiRequest("/complaints", {
        method: "POST",
        body: JSON.stringify({
          complaint_type: "Address & Zone Correction",
          description: [
            "[Address Correction Request]",
            `Current Barangay: ${profile.barangay_name || "Not assigned"}`,
            `Current Purok: ${profile.purok_name || "Not assigned"}`,
            `Requested Address: ${correctionAddress.trim()}`,
            `Reason: ${correctionReason.trim()}`,
          ].join("\n"),
          phone: phone.trim() || null,
          purok_id: profile.purok_id,
        }),
      });

      setCorrectionSuccess(
        data.message ||
          "Correction request filed successfully.",
      );

      setCorrectionReason("");
      window.setTimeout(
        () => setCorrectionSuccess(""),
        6000,
      );
    } catch (err) {
      setCorrectionError(
        err instanceof Error
          ? err.message
          : "Unable to submit correction request.",
      );
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
          <p className="mt-3 text-sm font-bold text-slate-500">
            Loading profile from database...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sg-page mx-auto max-w-3xl space-y-5 pb-20 md:pb-0">
      <div>
        <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.2em] text-emerald-600">
          LGU Account Settings
        </span>
        <h1 className="text-3xl font-black leading-none tracking-tight text-slate-900">
          My Profile
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          View your official barangay assignment and update allowed profile details.
        </p>
      </div>

      {needsInitialResidentSetup && (
        <div className="rounded-[1.8rem] border border-amber-200 bg-amber-50 px-6 py-4 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-black uppercase tracking-wider">
                Complete Your Resident Profile
              </p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-800">
                Your Google account was created without a barangay, purok, mobile number, or physical address. Complete these required details once before using the resident dashboard.
              </p>
            </div>
          </div>
        </div>
      )}

      {isPendingResidentApproval && (
        <div className="rounded-[1.8rem] border border-amber-200 bg-amber-50 px-6 py-4 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-black uppercase tracking-wider">
                Pending Barangay Captain Approval
              </p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-800">
                Your resident details have been submitted. You only need approval once. After the Barangay Captain activates your account, future Google sign-ins will go directly to the resident dashboard.
              </p>
            </div>
          </div>
        </div>
      )}

      {notif && (
        <div className="flex items-center gap-3 rounded-[1.8rem] border border-emerald-200 bg-emerald-50 px-6 py-4 text-emerald-800 shadow-md">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
          <span className="text-xs font-black">{notif}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-[1.8rem] border border-rose-200 bg-rose-50 px-6 py-4 text-rose-800 shadow-md">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
          <span className="text-xs font-black">{error}</span>
        </div>
      )}

      <div className="space-y-6 overflow-hidden rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col items-center gap-5 border-b border-slate-100 pb-5 md:flex-row">
          <div className="relative shrink-0">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-emerald-500/20 bg-emerald-50 text-3xl font-black text-emerald-700 shadow-inner">
              {photoDraft || profilePhoto ? (
                <img
                  src={photoDraft || profilePhoto || ""}
                  alt={`${name || "User"} profile`}
                  className="h-full w-full object-cover"
                />
              ) : (
                (name || "U").charAt(0).toUpperCase()
              )}
            </div>

            <label
              htmlFor="profile-photo-input"
              title="Choose profile picture"
              className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white shadow-md transition hover:bg-emerald-700"
            >
              <Camera className="h-4 w-4" />
            </label>

            <input
              id="profile-photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoSelected}
              className="hidden"
            />
          </div>

          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-lg font-black leading-none text-slate-800">
              {name || "User"}
            </h3>
            <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-600">
              {roleLabel(profile?.role)}
            </p>
            <p className="text-[10px] font-bold uppercase text-slate-400">
              {assignmentText}
            </p>
            <p className="text-[10px] font-bold uppercase text-slate-400">
              ID: {userCode(profile)}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 md:justify-start">
              <label
                htmlFor="profile-photo-input"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-100"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Choose photo
              </label>

              {photoDraft && (
                <button
                  type="button"
                  onClick={() => void handleSavePhoto()}
                  disabled={photoSaving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition hover:bg-emerald-800 disabled:opacity-60"
                >
                  {photoSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save photo
                </button>
              )}

              {(photoDraft || profilePhoto) && (
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto()}
                  disabled={photoSaving}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {photoDraft ? "Cancel" : "Remove"}
                </button>
              )}
            </div>

            <p className="text-[10px] font-semibold text-slate-400">
              JPG, PNG, or WebP · max 3.5 MB
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="sg-compact-form text-xs font-semibold">
          <fieldset className="sg-form-section">
            <legend className="sg-form-section-title">Account contact</legend>
            <div className="sg-form-grid sg-form-grid--two">
            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                Full Name
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-4 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                Email Address
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  value={profile?.email || ""}
                  disabled
                  className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-11 pr-4 font-bold text-slate-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                Contact Mobile Number
              </label>
              <div className="relative flex items-center">
                <Phone className="absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  pattern="09[0-9]{9}"
                  title="Enter exactly 11 digits starting with 09"
                  value={phone}
                  onChange={(event) =>
                    setPhone(
                      sanitizePhoneInput(event.target.value),
                    )
                  }
                  placeholder="09XXXXXXXXX"
                  maxLength={11}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-4 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                />
              </div>
            </div>

            </div>
          </fieldset>

          <fieldset className="sg-form-section">
            <legend className="sg-form-section-title">Official assignment</legend>
            <p className="-mt-1 text-[10px] font-semibold leading-relaxed text-slate-400">
              Assignment fields come from your official LGU record. Residents can submit a correction request below when needed.
            </p>
            <div className="sg-form-grid sg-form-grid--two">

            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                Official Barangay Assignment
              </label>

              {needsInitialResidentSetup ? (
                <select
                  value={setupBarangayId}
                  disabled={locationsLoading}
                  onChange={(event) => {
                    setSetupBarangayId(
                      event.target.value,
                    );
                    setSetupPurokId("");
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                  required
                >
                  <option value="">
                    {locationsLoading
                      ? "Loading barangays..."
                      : "Select barangay"}
                  </option>
                  {registrationBarangays.map(
                    (barangay) => (
                      <option
                        key={barangay.id}
                        value={barangay.id}
                      >
                        {barangay.name}
                      </option>
                    ),
                  )}
                </select>
              ) : (
                <div className="relative flex items-center">
                  <MapPin className="absolute left-4 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={profile?.barangay_name || "Not assigned"}
                    disabled
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-11 pr-4 font-bold text-slate-500"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                Official Purok Assignment
              </label>

              {needsInitialResidentSetup ? (
                <select
                  value={setupPurokId}
                  disabled={
                    locationsLoading ||
                    !setupBarangayId
                  }
                  onChange={(event) =>
                    setSetupPurokId(
                      event.target.value,
                    )
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 disabled:bg-slate-100 disabled:text-slate-400"
                  required
                >
                  <option value="">
                    {!setupBarangayId
                      ? "Select barangay first"
                      : "Select purok"}
                  </option>
                  {filteredSetupPuroks.map(
                    (purok) => (
                      <option
                        key={purok.id}
                        value={purok.id}
                      >
                        {purok.name}
                      </option>
                    ),
                  )}
                </select>
              ) : (
                <div className="relative flex items-center">
                  <MapPin className="absolute left-4 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={
                      profile?.role === "collector"
                        ? "Barangay-wide"
                        : profile?.purok_name || "Not assigned"
                    }
                    disabled
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-11 pr-4 font-bold text-slate-500"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <div className="ml-1 flex items-center justify-between">
                <label className="block font-black uppercase tracking-widest text-slate-500">
                  Physical Address
                </label>
                {isCivilian && (
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600">
                    {needsInitialResidentSetup
                      ? "Required Setup"
                      : "Locked"}
                  </span>
                )}
              </div>

              <div className="relative flex items-center">
                <MapPin className="absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  disabled={
                    isCivilian &&
                    !needsInitialResidentSetup
                  }
                  placeholder={
                    needsInitialResidentSetup
                      ? "Enter your complete physical address"
                      : undefined
                  }
                  className={`w-full rounded-xl border py-2.5 pl-11 pr-4 font-extrabold ${
                    isCivilian &&
                    !needsInitialResidentSetup
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                      : "border-slate-200 bg-slate-50 text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                  }`}
                />
              </div>
            </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <button
              type="submit"
              disabled={saving}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-none bg-emerald-700 px-5 py-3 font-extrabold uppercase tracking-wide text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Profile Credentials
            </button>
            <button
              type="button"
              aria-expanded={securityVisible}
              aria-controls="profile-security-settings"
              onClick={() => setSecurityVisible((visible) => !visible)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-5 py-3 text-xs font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                securityVisible
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50"
              }`}
            >
              <Lock className="h-4 w-4 shrink-0 text-emerald-600" />
              {securityVisible ? "Hide Account Security" : "Account Security"}
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${securityVisible ? "rotate-180" : ""}`} />
            </button>
          </div>
        </form>

        {securityVisible && (
        <section id="profile-security-settings" className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5" aria-label="Account security">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">Account Security</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">Protect your account</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Update your sign-in details. Choose one option below; we will verify your identity before saving changes.</p>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 sm:grid-cols-3" aria-label="Security options">
            <button
              type="button"
              aria-pressed={securityView === "password"}
              onClick={() => setSecurityView("password")}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold transition ${securityView === "password" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Lock className="h-4 w-4 shrink-0" />
              Password
            </button>
            <button
              type="button"
              aria-pressed={securityView === "email"}
              onClick={() => setSecurityView("email")}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold transition ${securityView === "email" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Mail className="h-4 w-4 shrink-0" />
              Email OTP Reset
            </button>
            <button
              type="button"
              aria-pressed={securityView === "change-email"}
              onClick={() => setSecurityView("change-email")}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold transition ${securityView === "change-email" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Mail className="h-4 w-4 shrink-0" />
              Change Email
            </button>
          </div>

          {securityView === "password" && (
          <form onSubmit={handleChangePassword} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2 text-slate-900">
              <Lock className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-black">Change Password</h4>
            </div>
            <p className="text-[11px] text-slate-500">Enter your current password before setting a new one.</p>
            {passwordError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{passwordError}</p>}
            {passwordMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{passwordMessage}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-700 sm:col-span-2">
                Current Password
                <input type={showPassword ? "text" : "password"} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                  autoComplete="current-password" required maxLength={72}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                New Password
                <input type={showPassword ? "text" : "password"} value={nextPassword} onChange={e => setNextPassword(e.target.value)}
                  autoComplete="new-password" required minLength={8} maxLength={72}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                Confirm New Password
                <input type={showPassword ? "text" : "password"} value={confirmNextPassword} onChange={e => setConfirmNextPassword(e.target.value)}
                  autoComplete="new-password" required minLength={8} maxLength={72}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">Minimum 8 characters, including uppercase, lowercase, and a number.</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPassword ? "Hide passwords" : "Show passwords"}
              </button>
              <button type="submit" disabled={passwordSaving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                {passwordSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Update Password
              </button>
            </div>
          </form>
          )}

          {securityView === "email" && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2 text-slate-900">
              <Mail className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-black">Reset Password with Email OTP</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Forgot your current password? Verify the registered email, then choose a new password without logging out.
              Your email address will not change.
            </p>
            {resetError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{resetError}</p>}
            {resetMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{resetMessage}</p>}

            {resetStage === "email" && (
              <form onSubmit={requestProfileResetOtp} className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Registered Email Address
                  <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                    required maxLength={150} autoComplete="email" placeholder="yourregisteredemail@gmail.com"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                </label>
                <p className="text-[11px] text-slate-500">The OTP will be sent to the email associated with this account: <strong>{profile?.email}</strong>.</p>
                <button type="submit" disabled={resetSaving}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                  {resetSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send Verification Code
                </button>
              </form>
            )}

            {resetStage === "otp" && (
              <form onSubmit={verifyProfileResetOtp} className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">Enter the six-digit OTP sent to <strong>{resetEmail}</strong>.</p>
                <label className="block text-xs font-bold text-slate-700">
                  Six-Digit Verification Code
                  <input type="text" value={resetOtp} onChange={e => setResetOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" placeholder="000000"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 tracking-[0.25em] text-slate-900 focus:border-emerald-500 focus:outline-none" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={resetSaving || resetOtp.length !== 6}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                    {resetSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Verify OTP
                  </button>
                  <button type="button" disabled={resetSaving} onClick={restartProfileReset}
                    className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-bold text-slate-700">
                    Request New Code
                  </button>
                </div>
              </form>
            )}

            {resetStage === "password" && (
              <form onSubmit={saveProfileResetPassword} className="space-y-3">
                <p className="text-xs font-bold text-emerald-700">OTP verified successfully. Set your new password.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-bold text-slate-700">
                    New Password
                    <input type={showResetPasswords ? "text" : "password"} value={resetNextPassword}
                      onChange={e => setResetNextPassword(e.target.value)} autoComplete="new-password"
                      minLength={8} maxLength={72} required
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                  </label>
                  <label className="block text-xs font-bold text-slate-700">
                    Confirm New Password
                    <input type={showResetPasswords ? "text" : "password"} value={resetConfirmPassword}
                      onChange={e => setResetConfirmPassword(e.target.value)} autoComplete="new-password"
                      minLength={8} maxLength={72} required
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500">8-72 characters, with an uppercase letter, lowercase letter, and number.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => setShowResetPasswords(v => !v)}
                    className="text-xs font-bold text-emerald-700">
                    {showResetPasswords ? "Hide passwords" : "Show passwords"}
                  </button>
                  <button type="submit" disabled={resetSaving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                    {resetSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save New Password
                  </button>
                </div>
                <button type="button" onClick={restartProfileReset} disabled={resetSaving}
                  className="text-xs font-semibold text-slate-600 underline">OTP expired? Start again</button>
              </form>
            )}

            {resetStage === "done" && (
              <button type="button" onClick={restartProfileReset}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-bold text-slate-700">
                Start Another Password Reset
              </button>
            )}
            <p className="text-[11px] text-slate-500">OTP expires after 10 minutes and permits up to 5 incorrect attempts. Password resets are authorized by access to the registered inbox.</p>
          </div>
          )}

          {securityView === "change-email" && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2 text-slate-900">
              <Mail className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-black">Change Email Address / Gmail</h4>
            </div>
            <p className="text-[11px] text-slate-500">Current: <strong>{profile?.email}</strong>. We will send a six-digit code to the new email before changing your login address.</p>
            {emailError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{emailError}</p>}
            {emailMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{emailMessage}</p>}
            {!emailPending ? (
              <form onSubmit={handleRequestEmailChange} className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  New Email Address
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required maxLength={150}
                    autoComplete="email" placeholder="newaddress@gmail.com"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  Current Password
                  <input type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} required maxLength={72}
                    autoComplete="current-password"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                </label>
                <button type="submit" disabled={emailSaving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                  {emailSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send Verification Code
                </button>
              </form>
            ) : (
              <form onSubmit={handleConfirmEmailChange} className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">Enter the code sent to <strong>{newEmail}</strong>.</p>
                <label className="block text-xs font-bold text-slate-700">
                  Six-Digit Code
                  <input type="text" value={emailOtp} onChange={e => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" placeholder="000000"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 tracking-[0.25em] text-slate-900 focus:border-emerald-500 focus:outline-none" />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button type="submit" disabled={emailSaving || emailOtp.length !== 6}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">
                    {emailSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Verify & Change Email
                  </button>
                  <button type="button" disabled={emailSaving} onClick={() => { setEmailPending(false); setEmailOtp(""); setEmailMessage(""); }}
                    className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black text-slate-700">
                    Change Email / Request New Code
                  </button>
                </div>
              </form>
            )}
            <p className="text-[11px] text-slate-500">The code expires in 10 minutes (maximum 5 attempts). If your account uses Google Sign-In and you do not have a password, use the Email OTP Reset tab first, without logging out.</p>
          </div>
          )}
        </section>
        )}

        {isCivilian &&
          !needsInitialResidentSetup && (
          <div className="border-t border-slate-100 pt-6">
            <button
              type="button"
              onClick={() => setShowCorrectionForm((value) => !value)}
              className="flex w-full items-center justify-between rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4 text-left transition-colors hover:bg-amber-500/10"
            >
              <div className="flex items-center gap-3">
                <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <h4 className="text-xs font-black leading-tight text-slate-800">
                    Mistake in your Address or Zone?
                  </h4>
                  <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                    File an official correction request for Barangay Captain review.
                  </p>
                </div>
              </div>
            </button>

            {showCorrectionForm && (
              <form
                onSubmit={handleCorrectionSubmit}
                className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                {correctionSuccess && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="text-[10px] font-bold">
                      {correctionSuccess}
                    </span>
                  </div>
                )}

                {correctionError && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
                    <span className="text-[10px] font-bold">
                      {correctionError}
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="ml-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Requested Correct Address
                  </label>
                  <input
                    type="text"
                    value={correctionAddress}
                    onChange={(event) =>
                      setCorrectionAddress(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-800 focus:border-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="ml-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Reason for Correction
                  </label>
                  <textarea
                    rows={3}
                    value={correctionReason}
                    onChange={(event) =>
                      setCorrectionReason(event.target.value)
                    }
                    placeholder="Explain the typo, wrong assignment, or relocation."
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold leading-relaxed text-slate-800 focus:border-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={correctionSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-none bg-amber-600 py-3 text-[10px] font-black uppercase tracking-wider text-white shadow-md hover:bg-amber-700 disabled:opacity-50"
                >
                  {correctionSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  File Correction Request
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
