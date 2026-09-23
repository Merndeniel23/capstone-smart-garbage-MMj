import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import ConfirmDialog from "./ConfirmDialog";
import FeedbackToast from "./FeedbackToast";
import EmailVerificationForm from "./EmailVerificationForm";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";

type Barangay = {
  id: number;
  name: string;
};

type CollectorOption = {
  id: number;
  full_name: string;
  email: string;
  phone?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  status: "active" | "inactive";
};

type CrewMember = {
  id: number;
  full_name: string;
  crew_role: "driver" | "crew_leader" | "loader" | "helper";
  phone?: string | null;
  status: "active" | "inactive";
};

type TruckRecord = {
  id: number;
  truck_code: string;
  plate_number: string;
  vehicle_description?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  collector_user_id?: number | null;
  collector_name?: string | null;
  collector_email?: string | null;
  collector_phone?: string | null;
  status: "active" | "maintenance" | "inactive";
  crew_members: CrewMember[];
};

type CrewDraft = {
  fullName: string;
  role: "loader" | "helper";
  phone: string;
};

const API_BASE = "/api";

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  if (!token) throw new Error("Login session is missing. Please sign in again.");

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function statusClass(status: TruckRecord["status"]) {
  if (status === "active") return "bg-emerald-100 text-emerald-700";
  if (status === "maintenance") return "bg-amber-100 text-amber-700";
  return "bg-slate-200 text-slate-600";
}

export default function TruckCrewManagement() {
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [collectors, setCollectors] = useState<CollectorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [statusConfirmation, setStatusConfirmation] = useState<{ truck: TruckRecord; status: TruckRecord["status"] } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verification, setVerification] = useState<{ email: string; resendAfter: number } | null>(null);
  const [fleetPage, setFleetPage] = useState(1);
  const [fleetPageSize, setFleetPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(null);

  const [truckCode, setTruckCode] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");
  const [barangayId, setBarangayId] = useState("");
  const [collectorMode, setCollectorMode] =
    useState<"existing" | "new">("existing");
  const [existingCollectorId, setExistingCollectorId] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [collectorEmail, setCollectorEmail] = useState("");
  const [collectorPhone, setCollectorPhone] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [collectorCrewRole, setCollectorCrewRole] = useState<"driver" | "crew_leader">("driver");
  const [crew, setCrew] = useState<CrewDraft[]>([
    { fullName: "", role: "loader", phone: "" },
  ]);

  const activeTruckBarangays = useMemo(
    () => new Set(trucks.filter((truck) => truck.status !== "inactive").map((truck) => Number(truck.barangay_id))),
    [trucks],
  );

  const availableCollectors = useMemo(
    () =>
      collectors.filter(
        (collector) =>
          collector.status === "active" &&
          Number(collector.barangay_id) === Number(barangayId) &&
          !trucks.some((truck) => truck.status !== "inactive" && Number(truck.collector_user_id) === Number(collector.id)),
      ),
    [collectors, barangayId, trucks],
  );

  const fleetPageCount = Math.max(1, Math.ceil(trucks.length / fleetPageSize));
  const visibleTrucks = useMemo(() => {
    const safePage = Math.min(fleetPage, fleetPageCount);
    const start = (safePage - 1) * fleetPageSize;
    return trucks.slice(start, start + fleetPageSize);
  }, [fleetPage, fleetPageCount, fleetPageSize, trucks]);
  useEffect(() => {
    if (fleetPage > fleetPageCount) setFleetPage(fleetPageCount);
  }, [fleetPage, fleetPageCount]);

  const loadData = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [truckData, locationData, collectorData] = await Promise.all([
        apiRequest("/admin/truck-crews"),
        apiRequest("/admin/locations"),
        apiRequest("/admin/collectors"),
      ]);
      setTrucks(Array.isArray(truckData.trucks) ? truckData.trucks : []);
      setBarangays(Array.isArray(locationData.barangays) ? locationData.barangays : []);
      setCollectors(Array.isArray(collectorData.collectors) ? collectorData.collectors : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Truck & Crew Management.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData(true);
  }, []);

  const resetForm = () => {
    setTruckCode("");
    setPlateNumber("");
    setVehicleDescription("");
    setBarangayId("");
    setCollectorMode("existing");
    setExistingCollectorId("");
    setCollectorName("");
    setCollectorEmail("");
    setCollectorPhone("");
    setTemporaryPassword("");
    setCollectorCrewRole("driver");
    setCrew([{ fullName: "", role: "loader", phone: "" }]);
    setShowValidation(false);
    setShowReview(false);
  };

  const updateCrew = (index: number, patch: Partial<CrewDraft>) => {
    setCrew((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const validationErrors: Record<string, string> = {};
  if (!truckCode.trim()) validationErrors.truckCode = "Enter a truck code.";
  else if (trucks.some((truck) => truck.truck_code.toLowerCase() === truckCode.trim().toLowerCase())) validationErrors.truckCode = "This truck code is already registered.";
  if (!plateNumber.trim()) validationErrors.plateNumber = "Enter a plate number.";
  else if (trucks.some((truck) => truck.plate_number.toLowerCase() === plateNumber.trim().toLowerCase())) validationErrors.plateNumber = "This plate number is already registered.";
  if (!barangayId) validationErrors.barangay = "Select the assigned barangay.";
  else if (activeTruckBarangays.has(Number(barangayId))) validationErrors.barangay = "This barangay already has an active or maintenance assignment.";
  if (collectorMode === "existing") {
    if (!availableCollectors.some((collector) => Number(collector.id) === Number(existingCollectorId))) validationErrors.collector = "Select an available collector in this barangay, or create a new account.";
  } else {
    if (!collectorName.trim()) validationErrors.collectorName = "Enter the collector's full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collectorEmail.trim())) validationErrors.collectorEmail = "Enter a valid collector email address.";
    if (collectorPhone.trim() && !/^\+?\d{7,15}$/.test(collectorPhone.trim())) validationErrors.collectorPhone = "Use 7–15 digits, optionally beginning with +.";
    if (temporaryPassword.length < 12 || !/[A-Z]/.test(temporaryPassword) || !/[a-z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword) || !/[^A-Za-z0-9]/.test(temporaryPassword)) {
      validationErrors.password = "Use at least 12 characters including uppercase, lowercase, a number, and a symbol.";
    }
  }
  crew.forEach((member, index) => {
    if (member.phone.trim() && !member.fullName.trim()) validationErrors[`crewName${index}`] = "Enter a name or remove this crew row.";
    if (member.phone.trim() && !/^\+?\d{7,15}$/.test(member.phone.trim())) validationErrors[`crewPhone${index}`] = "Use 7–15 digits, optionally beginning with +.";
  });

  const reviewRegistration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setShowValidation(true);
    setError("");
    if (Object.keys(validationErrors).length) {
      const form = event.currentTarget;
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setShowReview(true);
  };

  const registerTruckCrew = async () => {
    if (saving) return;
    if (Object.keys(validationErrors).length) {
      setShowValidation(true);
      setShowReview(false);
      return;
    }
    setError("");
    setNotice("");

    setSaving(true);

    try {
      const payload = {
        truckCode: truckCode.trim(),
        plateNumber: plateNumber.trim(),
        vehicleDescription: vehicleDescription.trim() || null,
        barangayId: Number(barangayId),
        collectorMode,
        existingCollectorId:
          collectorMode === "existing"
            ? Number(existingCollectorId)
            : null,
        collector: {
          fullName: collectorName.trim(),
          email: collectorEmail.trim(),
          phone: collectorPhone.trim() || null,
          temporaryPassword,
          crewRole: collectorCrewRole,
        },
        crewMembers: crew
          .map((member) => ({
            fullName: member.fullName.trim(),
            role: member.role,
            phone: member.phone.trim() || null,
          }))
          .filter((member) => member.fullName),
      };

      const data = await apiRequest("/admin/truck-crews", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setNotice(data.message || (data.requiresEmailVerification
        ? "Truck and crew registered. The new collector must verify their email before signing in."
        : "Truck and crew registered successfully."));
      if (data.requiresEmailVerification) {
        setVerification({ email: data.email || collectorEmail.trim().toLowerCase(), resendAfter: Number(data.resendAfter) || 60 });
      }
      resetForm();
      await loadData();
    } catch (err) {
      setShowReview(false);
      setError(err instanceof Error ? err.message : "Unable to register truck and crew.");
    } finally {
      setSaving(false);
    }
  };

  const changeTruckStatus = async (truck: TruckRecord, status: TruckRecord["status"]) => {
    if (updatingStatus) return;
    setUpdatingStatus(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest(`/admin/truck-crews/${truck.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(data.message || "Truck status updated.");
      setStatusConfirmation(null);
      await loadData();
    } catch (err) {
      setStatusConfirmation(null);
      setError(err instanceof Error ? err.message : "Unable to update truck status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-bold text-slate-500">Loading truck and crew records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Municipal Operations</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Truck & Crew Management</h1>
          <p className="mt-1 text-sm text-slate-500">Register one municipal collection truck/crew per barangay and issue the driver or crew leader account.</p>
        </div>
        <button type="button" disabled={refreshing || saving || updatingStatus} onClick={() => void loadData()} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}
      <FeedbackToast message={notice} onDismiss={() => setNotice("")} />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Registered Trucks" value={trucks.length} icon={Truck} />
        <SummaryCard label="Active Assignments" value={trucks.filter((truck) => truck.status === "active").length} icon={Building2} />
        <SummaryCard label="Recorded Crew Members" value={trucks.reduce((total, truck) => total + truck.crew_members.length, 0)} icon={Users} />
      </section>

      <div className="grid items-start gap-7 2xl:grid-cols-[1.15fr_1fr]">
        <form noValidate onSubmit={reviewRegistration} className="space-y-5 rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-xl font-black text-slate-900">Register Truck & Collection Crew</h2>
            <p className="mt-1 text-sm text-slate-500">Complete the sections, then review before registering. Fields marked * are required.</p>
          </div>

          <fieldset disabled={saving} className="space-y-4">
          <legend className="mb-4 font-black text-slate-900">1. Vehicle</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Truck Code" value={truckCode} onChange={setTruckCode} placeholder="TRK-001" required maxLength={40} error={showValidation ? validationErrors.truckCode : undefined} />
            <Field label="Plate Number" value={plateNumber} onChange={setPlateNumber} placeholder="ABC 1234" required maxLength={30} error={showValidation ? validationErrors.plateNumber : undefined} />
          </div>
          <Field label="Vehicle Description" value={vehicleDescription} onChange={setVehicleDescription} placeholder="Compactor truck / dump truck" maxLength={255} />
          </fieldset>

          <fieldset disabled={saving} className="border-t border-slate-100 pt-5">
          <legend className="pt-5 font-black text-slate-900">2. Barangay</legend>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Assigned Barangay *</span>
            <select required aria-invalid={showValidation && !!validationErrors.barangay} value={barangayId} onChange={(e) => { setBarangayId(e.target.value); setExistingCollectorId(""); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500">
              <option value="">Select barangay</option>
              {barangays.map((barangay) => (
                <option key={barangay.id} value={barangay.id} disabled={activeTruckBarangays.has(Number(barangay.id))}>
                  {barangay.name}{activeTruckBarangays.has(Number(barangay.id)) ? " — already assigned" : ""}
                </option>
              ))}
            </select>
            {showValidation && validationErrors.barangay && <span className="mt-2 block text-xs text-rose-600">{validationErrors.barangay}</span>}
          </label>
          <p className="mt-2 text-xs text-slate-500">Each barangay can have one active or maintenance truck assignment.</p>
          </fieldset>

          <fieldset disabled={saving} className="border-t border-slate-100 pt-5">
            <legend className="flex items-center gap-2 pt-5">
              <UserRound className="h-5 w-5 text-emerald-700" />
              <span className="font-black text-slate-900">3. Driver / Crew Leader</span>
            </legend>
            <p className="mb-4 text-xs text-slate-500">This person uses the Collector login account.</p>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={collectorMode === "existing"}
                onClick={() => {
                  setCollectorMode("existing");
                  setCollectorName("");
                  setCollectorEmail("");
                  setCollectorPhone("");
                  setTemporaryPassword("");
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-black ${
                  collectorMode === "existing"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                Select Existing Collector
              </button>

              <button
                type="button"
                aria-pressed={collectorMode === "new"}
                onClick={() => {
                  setCollectorMode("new");
                  setExistingCollectorId("");
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-black ${
                  collectorMode === "new"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                Create New Collector Account
              </button>
            </div>

            {collectorMode === "existing" ? (
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Existing Collector in Selected Barangay *
                </span>
                <select
                  required
                  aria-invalid={showValidation && !!validationErrors.collector}
                  value={existingCollectorId}
                  onChange={(e) => setExistingCollectorId(e.target.value)}
                  disabled={!barangayId}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">
                    {barangayId
                      ? "Select existing collector"
                      : "Select barangay first"}
                  </option>
                  {availableCollectors.map((collector) => (
                    <option key={collector.id} value={collector.id}>
                      {collector.full_name} — {collector.email}
                    </option>
                  ))}
                </select>
                {showValidation && validationErrors.collector && <span className="mt-2 block text-xs text-rose-600">{validationErrors.collector}</span>}
                <span className="mt-2 block text-xs text-slate-500">Only active collectors without an active or maintenance truck assignment appear here.</span>

                {barangayId && availableCollectors.length === 0 && (
                  <p className="mt-2 text-xs font-bold text-amber-600">
                    No collectors found for this barangay who are available for assignment. Create a new collector account to continue.
                  </p>
                )}
              </label>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full Name" value={collectorName} onChange={setCollectorName} required maxLength={150} error={showValidation ? validationErrors.collectorName : undefined} />
                <Field label="Email / Login" value={collectorEmail} onChange={setCollectorEmail} type="email" required maxLength={150} error={showValidation ? validationErrors.collectorEmail : undefined} />
                <Field label="Phone" value={collectorPhone} onChange={setCollectorPhone} type="tel" maxLength={16} error={showValidation ? validationErrors.collectorPhone : undefined} />
                <Field label="Temporary Password" value={temporaryPassword} onChange={setTemporaryPassword} type="password" required error={showValidation ? validationErrors.password : undefined} />
                <p className="text-xs text-slate-500 sm:col-span-2">Use at least 12 characters with uppercase, lowercase, a number, and a symbol. The collector must change this password at first login.</p>
              </div>
            )}

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Operational Role</span>
              <select value={collectorCrewRole} onChange={(e) => setCollectorCrewRole(e.target.value as "driver" | "crew_leader")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-emerald-500">
                <option value="driver">Driver</option>
                <option value="crew_leader">Crew Leader</option>
              </select>
            </label>
          </fieldset>

          <fieldset disabled={saving} className="border-t border-slate-100 pt-5">
            <legend className="pt-5 font-black text-slate-900">4. Helpers / Loaders</legend>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Optional crew members</h3>
                <p className="text-xs text-slate-500">These crew members are recorded but do not receive login accounts.</p>
              </div>
              <button type="button" disabled={crew.length >= 20} onClick={() => setCrew((current) => [...current, { fullName: "", role: "helper", phone: "" }])} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-50">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            <div className="space-y-3">
              {crew.map((member, index) => (
                <div key={index} className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2">
                  <Field label={`Crew member ${index + 1} name`} value={member.fullName} onChange={(value) => updateCrew(index, { fullName: value })} placeholder="Full name" maxLength={150} error={showValidation ? validationErrors[`crewName${index}`] : undefined} />
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Crew role
                  <select value={member.role} onChange={(e) => updateCrew(index, { role: e.target.value as "loader" | "helper" })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold outline-none">
                    <option value="loader">Loader</option>
                    <option value="helper">Helper</option>
                  </select>
                  </label>
                  <Field label="Phone (optional)" value={member.phone} onChange={(value) => updateCrew(index, { phone: value })} type="tel" maxLength={16} error={showValidation ? validationErrors[`crewPhone${index}`] : undefined} />
                  <button type="button" onClick={() => setCrew((current) => current.filter((_, i) => i !== index))} className="flex items-center justify-center gap-2 self-end rounded-xl p-3 text-xs font-bold text-rose-600 hover:bg-rose-50" title="Remove crew member" aria-label={`Remove crew member ${index + 1}`}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                </div>
              ))}
            </div>
            {crew.length === 0 && <p className="text-xs text-slate-500">No helpers or loaders added. You can register with only the driver or crew leader.</p>}
          </fieldset>

          <div className="border-t border-slate-100 pt-5">
          <h3 className="font-black text-slate-900">5. Review & Register</h3>
          <p className="mb-4 mt-1 text-xs text-slate-500">Review the vehicle, assignment, and crew before saving.</p>
          {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
          {showValidation && Object.keys(validationErrors).length > 0 && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Please correct the highlighted fields before continuing.</p>}
          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-black text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Registering..." : "Review Truck & Crew"}
          </button>
          </div>
        </form>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Municipal Collection Fleet</h2>
            <p className="text-xs text-slate-500">Current truck, barangay, account, and crew assignments.</p>
          </div>

          {trucks.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-12 text-center">
              <Truck className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 font-black text-slate-700">No municipal collection trucks registered</p>
              <p className="mt-1 text-xs text-slate-500">Use the registration form to create the first truck and crew assignment.</p>
            </div>
          ) : (
            <>
            {visibleTrucks.map((truck) => (
              <article key={truck.id} className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Truck className="h-5 w-5" /></div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-slate-900">{truck.truck_code}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(truck.status)}`}>{truck.status}</span>
                      </div>
                      <p className="text-xs font-bold text-slate-500">{truck.plate_number} · {truck.barangay_name || "No barangay"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSelectedTruckId((current) => current === truck.id ? null : truck.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-black uppercase text-slate-700 hover:border-emerald-400 hover:text-emerald-700" title={selectedTruckId === truck.id ? "Hide truck details" : "View truck details"} aria-expanded={selectedTruckId === truck.id}>
                    <Eye className="h-3.5 w-3.5" /> {selectedTruckId === truck.id ? "Hide" : "Details"}
                  </button>
                  <select aria-label={`Status for truck ${truck.truck_code}`} value={truck.status} disabled={updatingStatus || saving} onChange={(e) => setStatusConfirmation({ truck, status: e.target.value as TruckRecord["status"] })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none disabled:opacity-50">
                    <option value="active">Active</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  </div>
                </div>

                {selectedTruckId === truck.id && <div className="grid gap-3 p-3 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Collector Login / Truck GPS User</p>
                    <p className="mt-2 font-black text-slate-800">{truck.collector_name || "Not assigned"}</p>
                    <p className="text-xs text-slate-500">{truck.collector_email || "No account"}</p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Crew Roster</p>
                    <div className="mt-2 space-y-2">
                      {truck.crew_members.length === 0 ? (
                        <p className="text-xs text-slate-500">No crew members recorded.</p>
                      ) : (
                        truck.crew_members.map((member) => (
                          <div key={member.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-bold text-slate-700">{member.full_name}</span>
                            <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black uppercase text-slate-500">{member.crew_role.replace("_", " ")}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>}
              </article>
            ))}
            <Pagination page={fleetPage} pageSize={fleetPageSize} totalItems={trucks.length} onPageChange={setFleetPage} onPageSizeChange={(size) => { setFleetPageSize(size); setFleetPage(1); }} itemLabel="trucks" compact />
            </>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={showReview}
        title="Review Truck & Crew"
        description={
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-bold">Truck</dt><dd>{truckCode.trim()} · {plateNumber.trim()}</dd>
              {vehicleDescription.trim() && <><dt className="font-bold">Vehicle</dt><dd>{vehicleDescription.trim()}</dd></>}
              <dt className="font-bold">Barangay</dt><dd>{barangays.find((barangay) => Number(barangay.id) === Number(barangayId))?.name}</dd>
              <dt className="font-bold">Collector</dt><dd>{collectorMode === "new" ? collectorName.trim() : availableCollectors.find((collector) => Number(collector.id) === Number(existingCollectorId))?.full_name}</dd>
              <dt className="font-bold">Login account</dt><dd className="break-all">{collectorMode === "new" ? collectorEmail.trim() : availableCollectors.find((collector) => Number(collector.id) === Number(existingCollectorId))?.email} ({collectorMode === "new" ? "new account" : "existing account"})</dd>
              <dt className="font-bold">Role</dt><dd>{collectorCrewRole === "driver" ? "Driver" : "Crew Leader"}</dd>
              <dt className="font-bold">Helpers / Loaders</dt><dd>{crew.filter((member) => member.fullName.trim()).length}</dd>
            </dl>
            {crew.some((member) => member.fullName.trim()) && <ul className="space-y-1 text-sm">{crew.filter((member) => member.fullName.trim()).map((member, index) => <li key={index}>{member.fullName.trim()} — {member.role}</li>)}</ul>}
            <p className="text-xs">Helpers and loaders receive no login accounts. {collectorMode === "new" && "The collector must verify their email with a 6-digit code before signing in. Share the temporary password securely; they must change it on first login."}</p>
          </div>
        }
        confirmLabel="Register Truck & Crew"
        cancelLabel="Back to Form"
        busy={saving}
        onCancel={() => setShowReview(false)}
        onConfirm={() => void registerTruckCrew()}
      />
      <ConfirmDialog
        open={!!statusConfirmation}
        title="Update truck status?"
        description={statusConfirmation ? `Set ${statusConfirmation.truck.truck_code} (${statusConfirmation.truck.barangay_name || "Unassigned barangay"}) to ${statusConfirmation.status}? ${statusConfirmation.status === "inactive" ? "This releases its active assignment so another truck can be registered for the barangay." : "This truck remains assigned to its barangay and collector."}` : ""}
        confirmLabel="Update Status"
        destructive={statusConfirmation?.status === "inactive"}
        busy={updatingStatus}
        onCancel={() => setStatusConfirmation(null)}
        onConfirm={() => { if (statusConfirmation) void changeTruckStatus(statusConfirmation.truck, statusConfirmation.status); }}
      />
      {verification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Verify collector email" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
            <p className="mb-5 text-xs leading-relaxed text-slate-500">The collector can enter their emailed code here or use “Verify an existing account” on the Sign In page.</p>
            <EmailVerificationForm
              key={verification.email}
              variant="management"
              email={verification.email}
              initialResendAfter={verification.resendAfter}
              backLabel="Back to Truck & Crew"
              onBack={() => setVerification(null)}
              onVerified={() => {
                setVerification(null);
                setNotice("Collector email verified. They can sign in with the temporary password and change it on first login.");
                void loadData();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  required = false,
  maxLength,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  error?: string;
}) {
  const errorId = useId();
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}{required ? " *" : ""}</span>
      <input type={type} required={required} maxLength={maxLength} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} autoComplete={type === "password" ? "new-password" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full rounded-xl border bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 ${error ? "border-rose-400" : "border-slate-200"}`} />
      {error && <span id={errorId} className="mt-2 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></div>
    </div>
  );
}
