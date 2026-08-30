import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  HelpCircle,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";

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
  role: "admin" | "resident" | "collector" | "purok_leader";
  phone: string | null;
  address: string | null;
  status: string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
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

  const response = await fetch(`${API_BASE}${endpoint}`, {
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

function sanitizePhoneInput(value: string) {
  const trimmed = value.trimStart();
  const hasPlus = trimmed.startsWith("+");
  const digits = value.replace(/\D/g, "").slice(0, 15);

  return hasPlus && digits
    ? `+${digits}`
    : digits;
}

function isValidPhone(value: string) {
  return /^\+?\d{7,15}$/.test(value);
}

function roleLabel(role?: ProfileUser["role"]) {
  switch (role) {
    case "admin":
      return "Barangay Captain";
    case "purok_leader":
      return "Purok Leader";
    case "collector":
      return "Garbage Collector";
    default:
      return "Civilian";
  }
}

function userCode(user: ProfileUser | null) {
  if (!user) return "";

  const prefix =
    user.role === "admin"
      ? "BC"
      : user.role === "purok_leader"
        ? "PL"
        : user.role === "collector"
          ? "GC"
          : "CV";

  return `${prefix}-${String(user.id).padStart(4, "0")}`;
}

export default function UserProfilePanel() {
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

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
        "Enter a valid phone number using digits only (7 to 15 digits, optional + at the start).",
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
    <div className="mx-auto max-w-2xl space-y-6 pb-20 md:pb-0">
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

      <div className="space-y-8 overflow-hidden rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-sm md:p-8">
        <div className="flex flex-col items-center gap-6 border-b border-slate-100 pb-6 md:flex-row">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500/20 bg-emerald-50 text-2xl font-black text-emerald-700 shadow-inner">
            {(name || "U").charAt(0).toUpperCase()}
          </div>

          <div className="space-y-1 text-center md:text-left">
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
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6 text-xs font-semibold">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
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
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 py-3.5 pl-11 pr-4 font-bold text-slate-500"
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
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(
                      sanitizePhoneInput(event.target.value),
                    )
                  }
                  placeholder="+639XXXXXXXXX"
                  maxLength={16}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                />
              </div>
            </div>

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
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
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
                    className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 py-3.5 pl-11 pr-4 font-bold text-slate-500"
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
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-extrabold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 disabled:bg-slate-100 disabled:text-slate-400"
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
                    className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 py-3.5 pl-11 pr-4 font-bold text-slate-500"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block font-black uppercase tracking-widest text-slate-500">
                LGU Account Code
              </label>
              <div className="relative flex items-center">
                <Award className="absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={userCode(profile)}
                  disabled
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 py-3.5 pl-11 pr-4 font-bold text-slate-500"
                />
              </div>
            </div>

            <div className="space-y-1.5 md:col-span-2">
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
                  className={`w-full rounded-2xl border py-3.5 pl-11 pr-4 font-extrabold ${
                    isCivilian &&
                    !needsInitialResidentSetup
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                      : "border-slate-200 bg-slate-50 text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                  }`}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-none bg-emerald-700 py-4 font-extrabold uppercase tracking-widest text-white shadow-lg shadow-emerald-800/10 hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Profile Credentials
          </button>
        </form>

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
