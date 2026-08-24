import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
          Number(collector.barangay_id) === Number(barangayId),
      ),
    [collectors, barangayId],
  );

  const loadData = async () => {
    setLoading(true);
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
    }
  };

  useEffect(() => {
    void loadData();
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
  };

  const updateCrew = (index: number, patch: Partial<CrewDraft>) => {
    setCrew((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const registerTruckCrew = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

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

      setNotice(data.message || "Truck and crew registered successfully.");
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to register truck and crew.");
    } finally {
      setSaving(false);
    }
  };

  const changeTruckStatus = async (truck: TruckRecord, status: TruckRecord["status"]) => {
    setError("");
    setNotice("");
    try {
      const data = await apiRequest(`/admin/truck-crews/${truck.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(data.message || "Truck status updated.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update truck status.");
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
        <button type="button" onClick={() => void loadData()} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">{notice}</p>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Registered Trucks" value={trucks.length} icon={Truck} />
        <SummaryCard label="Active Assignments" value={trucks.filter((truck) => truck.status === "active").length} icon={Building2} />
        <SummaryCard label="Recorded Crew Members" value={trucks.reduce((total, truck) => total + truck.crew_members.length, 0)} icon={Users} />
      </section>

      <div className="grid gap-7 xl:grid-cols-[1.05fr_1.4fr]">
        <form onSubmit={registerTruckCrew} className="space-y-5 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-black text-slate-900">Register Truck & Collection Crew</h2>
            <p className="mt-1 text-xs text-slate-500">The driver/crew leader receives the Garbage Collector login account.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Truck Code" value={truckCode} onChange={setTruckCode} placeholder="TRK-001" required />
            <Field label="Plate Number" value={plateNumber} onChange={setPlateNumber} placeholder="ABC 1234" required />
          </div>
          <Field label="Vehicle Description" value={vehicleDescription} onChange={setVehicleDescription} placeholder="Compactor truck / dump truck" />

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Assigned Barangay</span>
            <select required value={barangayId} onChange={(e) => setBarangayId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500">
              <option value="">Select barangay</option>
              {barangays.map((barangay) => (
                <option key={barangay.id} value={barangay.id} disabled={activeTruckBarangays.has(barangay.id)}>
                  {barangay.name}{activeTruckBarangays.has(barangay.id) ? " — already assigned" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="border-t border-slate-100 pt-5">
            <div className="mb-4 flex items-center gap-2">
              <UserRound className="h-5 w-5 text-emerald-700" />
              <h3 className="font-black text-slate-900">Driver / Crew Leader Account</h3>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
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
                  Existing Collector in Selected Barangay
                </span>
                <select
                  required
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

                {barangayId && availableCollectors.length === 0 && (
                  <p className="mt-2 text-xs font-bold text-amber-600">
                    No active existing collector is available in this barangay. Create a new collector account instead.
                  </p>
                )}
              </label>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full Name" value={collectorName} onChange={setCollectorName} required />
                <Field label="Email / Login" value={collectorEmail} onChange={setCollectorEmail} type="email" required />
                <Field label="Phone" value={collectorPhone} onChange={setCollectorPhone} />
                <Field label="Temporary Password" value={temporaryPassword} onChange={setTemporaryPassword} type="password" required />
              </div>
            )}

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Operational Role</span>
              <select value={collectorCrewRole} onChange={(e) => setCollectorCrewRole(e.target.value as "driver" | "crew_leader")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-emerald-500">
                <option value="driver">Driver</option>
                <option value="crew_leader">Crew Leader</option>
              </select>
            </label>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-slate-900">Helpers / Loaders</h3>
                <p className="text-xs text-slate-500">These crew members are recorded but do not receive login accounts.</p>
              </div>
              <button type="button" onClick={() => setCrew((current) => [...current, { fullName: "", role: "helper", phone: "" }])} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            <div className="space-y-3">
              {crew.map((member, index) => (
                <div key={index} className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1fr_140px_1fr_auto]">
                  <input value={member.fullName} onChange={(e) => updateCrew(index, { fullName: e.target.value })} placeholder="Crew member name" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                  <select value={member.role} onChange={(e) => updateCrew(index, { role: e.target.value as "loader" | "helper" })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none">
                    <option value="loader">Loader</option>
                    <option value="helper">Helper</option>
                  </select>
                  <input value={member.phone} onChange={(e) => updateCrew(index, { phone: e.target.value })} placeholder="Phone (optional)" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                  <button type="button" onClick={() => setCrew((current) => current.filter((_, i) => i !== index))} className="rounded-xl p-2 text-rose-500 hover:bg-rose-50" title="Remove crew row">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-black text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Registering..." : "Register Truck & Crew"}
          </button>
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
            trucks.map((truck) => (
              <article key={truck.id} className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Truck className="h-6 w-6" /></div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-slate-900">{truck.truck_code}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(truck.status)}`}>{truck.status}</span>
                      </div>
                      <p className="text-xs font-bold text-slate-500">{truck.plate_number} · {truck.barangay_name || "No barangay"}</p>
                      {truck.vehicle_description && <p className="mt-1 text-[11px] text-slate-400">{truck.vehicle_description}</p>}
                    </div>
                  </div>

                  <select value={truck.status} onChange={(e) => void changeTruckStatus(truck, e.target.value as TruckRecord["status"])} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none">
                    <option value="active">Active</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Collector Login / Truck GPS User</p>
                    <p className="mt-2 font-black text-slate-800">{truck.collector_name || "Not assigned"}</p>
                    <p className="text-xs text-slate-500">{truck.collector_email || "No account"}</p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
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
                </div>
              </article>
            ))
          )}
        </section>
      </div>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500" />
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