import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquareWarning,
  Navigation,
  LocateFixed,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
  User,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface CollectorDashboardProps {
  setCurrentScreen: (screen: any) => void;
}

type GarbageBin = {
  id: number;
  bin_code: string;
  location_name: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  current_status?: string | null;
  condition_status?: string | null;
  last_inspected_at?: string | null;
  is_active: number | boolean;
  purok_name?: string | null;
  barangay_name?: string | null;
  schedule_day?: string | null;
  schedule_start_time?: string | null;
  schedule_end_time?: string | null;
  schedule_notes?: string | null;
  is_scheduled_today?: number | boolean;
};

type CollectionRequest = {
  id: number;
  bin_id: number;
  priority: "low" | "normal" | "high" | "urgent";
  status:
    | "pending"
    | "approved"
    | "assigned"
    | "in_progress"
    | "completed"
    | "cancelled";
  reason?: string | null;
};

type ComplaintStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "resolved"
  | "cancelled";

type AssignedComplaint = {
  id: number;
  reporter_name: string;
  purok_name?: string | null;
  barangay_name?: string | null;
  complaint_type: string;
  description: string;
  phone?: string | null;
  status: ComplaintStatus;
  created_at: string;
};

type DashboardBin = GarbageBin & {
  request: CollectionRequest | null;
};

type CollectionRun = {
  id: number;
  schedule_id: number | null;
  barangay_id: number;
  truck_id: number;
  collector_user_id: number;
  collection_date: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
};

type TodayCollectionOperation = {
  hasScheduleToday: boolean;
  run: CollectionRun | null;
  collectionPointCount: number;
  schedule: {
    schedule_id: number;
    barangay_id: number;
    day_of_week: string;
    start_time?: string | null;
    end_time?: string | null;
    notes?: string | null;
    is_active?: number | boolean;
  } | null;
  truck: {
    id: number;
    truckCode: string;
    plateNumber: string;
    vehicleDescription?: string | null;
    status: string;
  } | null;
  barangay: {
    id: number;
    name: string;
  };
};

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function apiRequest(
  url: string,
  options: RequestInit = {},
) {
  const token = getToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || "Request failed.",
    );
  }

  return data;
}

function normalizeStatus(
  value?: string | null,
): string {
  return String(value || "empty")
    .toLowerCase()
    .replaceAll("_", "-");
}

function statusLabel(
  value?: string | null,
): string {
  return normalizeStatus(value)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function formatDate(
  value?: string | null,
): string {
  if (!value) return "No date";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function isScheduledToday(
  bin: GarbageBin,
): boolean {
  return Number(
    bin.is_scheduled_today,
  ) === 1;
}

function needsCollection(
  bin: GarbageBin,
): boolean {
  const status = normalizeStatus(
    bin.current_status,
  );

  return (
    isScheduledToday(bin) ||
    status === "full" ||
    status === "overflowing"
  );
}

function priorityForBin(
  bin: GarbageBin,
): CollectionRequest["priority"] {
  const status = normalizeStatus(
    bin.current_status,
  );

  if (status === "overflowing") {
    return "urgent";
  }

  if (status === "full") {
    return "high";
  }

  return "normal";
}

export default function CollectorDashboard({
  setCurrentScreen,
}: CollectorDashboardProps) {
  const [bins, setBins] =
    useState<GarbageBin[]>([]);

  const [requests, setRequests] =
    useState<CollectionRequest[]>([]);

  const [complaints, setComplaints] =
    useState<AssignedComplaint[]>([]);

  const [todayOperation, setTodayOperation] =
    useState<TodayCollectionOperation | null>(null);

  const [runUpdating, setRunUpdating] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [updatingId, setUpdatingId] =
    useState<number | null>(null);

  const [
    updatingComplaintId,
    setUpdatingComplaintId,
  ] = useState<number | null>(null);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  const [tracking, setTracking] =
    useState(
      () =>
        localStorage.getItem(
          "sg_collector_location_sharing",
        ) === "true",
    );

  const [locationStatus, setLocationStatus] =
    useState(() =>
      localStorage.getItem(
        "sg_collector_location_sharing",
      ) === "true"
        ? "Live location sharing is on. Waiting for the next GPS update."
        : "Location sharing is off.",
    );

  const [lastLocationUpdate, setLastLocationUpdate] =
    useState<string | null>(null);

  const watchIdRef =
    useRef<number | null>(null);

  const lastSentAtRef =
    useRef(0);

  const sendCollectorLocation = async (
    position: GeolocationPosition,
  ) => {
    const now = Date.now();

    if (now - lastSentAtRef.current < 15000) {
      return;
    }

    lastSentAtRef.current = now;

    const { latitude, longitude, accuracy, heading, speed } =
      position.coords;

    try {
      await apiRequest(
        "/api/collector-locations/me",
        {
          method: "PUT",
          body: JSON.stringify({
            latitude,
            longitude,
            accuracyMeters: accuracy,
            headingDegrees: heading,
            speedMps: speed,
            isOnDuty: true,
          }),
        },
      );

      const updatedAt = new Date().toISOString();
      setLastLocationUpdate(updatedAt);
      setLocationStatus("Live location is being shared.");
    } catch (error) {
      setLocationStatus(
        error instanceof Error
          ? error.message
          : "Unable to send live location.",
      );
    }
  };

  const startLocationTracking = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus(
        "This browser does not support GPS location.",
      );
      return;
    }

    localStorage.setItem(
      "sg_collector_location_sharing",
      "true",
    );

    setTracking(true);
    setLocationStatus(
      "Live location sharing is on. It will stay active while you use other collector features.",
    );

    window.dispatchEvent(
      new Event(
        "collector-location-sharing-change",
      ),
    );
  };

  const stopLocationTracking = async () => {
    localStorage.removeItem(
      "sg_collector_location_sharing",
    );

    setTracking(false);
    setLocationStatus(
      "Location sharing is off.",
    );

    window.dispatchEvent(
      new Event(
        "collector-location-sharing-change",
      ),
    );
  };

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const [
        binResult,
        requestResult,
        complaintResult,
        operationResult,
      ] = await Promise.all([
        apiRequest(
          "/api/garbage-bins",
        ),
        apiRequest(
          "/api/collection-requests",
        ),
        apiRequest(
          "/api/complaints",
        ),
        apiRequest(
          "/api/collection-runs/today",
        ),
      ]);

      setBins(
        Array.isArray(binResult.bins)
          ? binResult.bins
          : [],
      );

      setRequests(
        Array.isArray(
          requestResult.requests,
        )
          ? requestResult.requests
          : [],
      );

      setComplaints(
        Array.isArray(
          complaintResult.complaints,
        )
          ? complaintResult.complaints
          : [],
      );

      setTodayOperation(operationResult);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load collector dashboard.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const onLocationUpdate = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<{
          accuracy?: number;
          timestamp?: number;
        }>;

      setTracking(true);
      setLastLocationUpdate(
        new Date(
          customEvent.detail?.timestamp ||
            Date.now(),
        ).toISOString(),
      );

      const accuracy =
        Number(
          customEvent.detail?.accuracy,
        );

      setLocationStatus(
        Number.isFinite(accuracy)
          ? `Live location is being shared. Accuracy: about ${Math.round(
              accuracy,
            )} meters.`
          : "Live location is being shared.",
      );
    };

    window.addEventListener(
      "collector-location-update",
      onLocationUpdate,
    );

    return () => {
      window.removeEventListener(
        "collector-location-update",
        onLocationUpdate,
      );
    };
  }, []);

  const activeRequestByBin =
    useMemo(() => {
      const map =
        new Map<
          number,
          CollectionRequest
        >();

      [...requests]
        .sort(
          (a, b) =>
            b.id - a.id,
        )
        .forEach((request) => {
          if (
            request.status !==
              "cancelled" &&
            !map.has(request.bin_id)
          ) {
            map.set(
              request.bin_id,
              request,
            );
          }
        });

      return map;
    }, [requests]);

  const dashboardBins =
    useMemo<DashboardBin[]>(
      () =>
        bins
          .filter(
            (bin) =>
              Number(
                bin.is_active,
              ) === 1,
          )
          .map((bin) => ({
            ...bin,
            request:
              activeRequestByBin.get(
                bin.id,
              ) || null,
          }))
          .filter(
            (bin) =>
              needsCollection(bin) ||
              (bin.request &&
                bin.request.status !==
                  "completed"),
          )
          .sort((a, b) => {
            const order = {
              overflowing: 4,
              full: 3,
              scheduled: 2,
              normal: 1,
            };

            const rank = (
              bin: DashboardBin,
            ) => {
              const status =
                normalizeStatus(
                  bin.current_status,
                );

              if (
                status ===
                "overflowing"
              ) {
                return order.overflowing;
              }

              if (
                status === "full"
              ) {
                return order.full;
              }

              if (
                isScheduledToday(
                  bin,
                )
              ) {
                return order.scheduled;
              }

              return order.normal;
            };

            return (
              rank(b) - rank(a)
            );
          }),
      [bins, activeRequestByBin],
    );

  const activeComplaints =
    useMemo(
      () =>
        complaints.filter(
          (complaint) =>
            ![
              "resolved",
              "cancelled",
            ].includes(
              complaint.status,
            ),
        ),
      [complaints],
    );

  const stats = useMemo(() => {
    const activeBins =
      bins.filter(
        (bin) =>
          Number(
            bin.is_active,
          ) === 1,
      );

    return {
      total: activeBins.length,
      scheduled:
        activeBins.filter(
          isScheduledToday,
        ).length,
      urgent:
        activeBins.filter(
          (bin) =>
            normalizeStatus(
              bin.current_status,
            ) ===
            "overflowing",
        ).length,
      completed:
        activeBins.filter((bin) => {
          if (!needsCollection(bin)) {
            return false;
          }

          return (
            activeRequestByBin.get(bin.id)
              ?.status === "completed"
          );
        }).length,
      complaints:
        activeComplaints.length,
    };
  }, [
    bins,
    activeRequestByBin,
    activeComplaints,
  ]);

  const startCollectionRun = async () => {
    setRunUpdating(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await apiRequest(
        "/api/collection-runs/start",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );

      setSuccessMessage(
        result.message ||
          "Today's collection has started.",
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to start collection.",
      );
    } finally {
      setRunUpdating(false);
    }
  };

  const completeCollectionRun = async () => {
    const runId = todayOperation?.run?.id;

    if (!runId) {
      setErrorMessage(
        "No active collection run was found.",
      );
      return;
    }

    setRunUpdating(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await apiRequest(
        `/api/collection-runs/${runId}/complete`,
        {
          method: "PATCH",
          body: JSON.stringify({}),
        },
      );

      setSuccessMessage(
        result.message ||
          "Today's collection was completed.",
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete collection.",
      );
    } finally {
      setRunUpdating(false);
    }
  };

  const createTask = async (
    bin: DashboardBin,
  ) => {
    setUpdatingId(bin.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result =
        await apiRequest(
          "/api/collection-requests",
          {
            method: "POST",
            body: JSON.stringify({
              bin_id: bin.id,
              priority:
                priorityForBin(
                  bin,
                ),
              reason:
                isScheduledToday(
                  bin,
                )
                  ? `Scheduled collection for ${
                      bin.schedule_day ||
                      "today"
                    }.`
                  : `${statusLabel(
                      bin.current_status,
                    )} garbage bin requires collection.`,
            }),
          },
        );

      setSuccessMessage(
        result.message ||
          "Collection task created.",
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to create collection task.",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const updateStatus = async (
    bin: DashboardBin,
    status:
      | "assigned"
      | "in_progress"
      | "completed",
  ) => {
    if (!bin.request) return;

    setUpdatingId(bin.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result =
        await apiRequest(
          `/api/collection-requests/${bin.request.id}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status,
            }),
          },
        );

      setSuccessMessage(
        result.message ||
          "Collection task updated.",
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update collection task.",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const updateComplaintStatus =
    async (
      complaint: AssignedComplaint,
      status:
        | "in_progress"
        | "completed",
    ) => {
      setUpdatingComplaintId(
        complaint.id,
      );
      setErrorMessage("");
      setSuccessMessage("");

      try {
        const result =
          await apiRequest(
            `/api/complaints/${complaint.id}/status`,
            {
              method: "PUT",
              body: JSON.stringify({
                status,
              }),
            },
          );

        setSuccessMessage(
          result.message ||
            "Complaint task updated.",
        );

        await loadData();
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to update complaint task.",
        );
      } finally {
        setUpdatingComplaintId(
          null,
        );
      }
    };

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">
            Garbage Collector Dashboard
          </h1>

          <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            Scheduled bins, collection requests, and assigned civilian complaints
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadData}
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-black text-slate-700"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading
                  ? "animate-spin"
                  : ""
              }`}
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={() =>
              setCurrentScreen(
                "route-map",
              )
            }
            className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white"
          >
            <Navigation className="h-4 w-4" />
            Open Route Map
          </button>
        </div>
      </header>

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {errorMessage}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm">
        <div className="bg-emerald-800 p-6 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-200">
                Normal Scheduled Collection
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-xl font-black">
                <Truck className="h-5 w-5" />
                Today&apos;s Barangay Collection
              </h2>
              <p className="mt-2 text-sm text-emerald-100">
                One collection operation for your assigned barangay, truck, and crew.
              </p>
            </div>

            <span
              className={`w-fit rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${
                todayOperation?.run?.status === "completed"
                  ? "bg-white text-emerald-800"
                  : todayOperation?.run?.status === "in_progress"
                    ? "bg-amber-300 text-amber-950"
                    : todayOperation?.hasScheduleToday
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-700"
              }`}
            >
              {todayOperation?.run?.status === "completed"
                ? "Completed"
                : todayOperation?.run?.status === "in_progress"
                  ? "In Progress"
                  : todayOperation?.hasScheduleToday
                    ? "Ready"
                    : "No Schedule Today"}
            </span>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {!todayOperation ? (
            <div className="flex items-center gap-3 text-sm font-bold text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading today&apos;s collection operation...
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Barangay
                  </p>
                  <p className="mt-2 font-black text-slate-900">
                    {todayOperation.barangay?.name || "Not assigned"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Assigned Truck
                  </p>
                  <p className="mt-2 font-black text-slate-900">
                    {todayOperation.truck?.truckCode || "No active truck"}
                  </p>
                  {todayOperation.truck?.plateNumber && (
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {todayOperation.truck.plateNumber}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Collection Schedule
                  </p>
                  <p className="mt-2 font-black text-slate-900">
                    {todayOperation.schedule?.day_of_week || "No schedule"}
                  </p>
                  {(todayOperation.schedule?.start_time ||
                    todayOperation.schedule?.end_time) && (
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {todayOperation.schedule?.start_time || "—"}
                      {" – "}
                      {todayOperation.schedule?.end_time || "—"}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Collection Points
                  </p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {todayOperation.collectionPointCount}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    active registered bins
                  </p>
                </div>
              </div>

              {todayOperation.schedule?.notes && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <span className="font-black">Schedule note:</span>{" "}
                  {todayOperation.schedule.notes}
                </div>
              )}

              {todayOperation.run?.started_at && (
                <div className="flex flex-wrap gap-4 rounded-2xl border border-slate-100 bg-white text-xs font-bold text-slate-600">
                  <span>
                    Started: {formatDate(todayOperation.run.started_at)}
                  </span>
                  {todayOperation.run.completed_at && (
                    <span>
                      Completed: {formatDate(todayOperation.run.completed_at)}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {!todayOperation.hasScheduleToday && (
                  <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600">
                    There is no active barangay collection schedule for today.
                  </div>
                )}

                {todayOperation.hasScheduleToday &&
                  !todayOperation.truck && (
                    <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                      No active collection truck is assigned to this collector account.
                    </div>
                  )}

                {todayOperation.hasScheduleToday &&
                  todayOperation.truck &&
                  !todayOperation.run && (
                    <button
                      type="button"
                      disabled={runUpdating}
                      onClick={() => void startCollectionRun()}
                      className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
                    >
                      <Truck className="h-4 w-4" />
                      {runUpdating ? "Starting..." : "Start Collection"}
                    </button>
                  )}

                {todayOperation.run?.status === "in_progress" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCurrentScreen("route-map")}
                      className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-black uppercase tracking-wide text-emerald-800"
                    >
                      <Navigation className="h-4 w-4" />
                      Open Route Map
                    </button>

                    <button
                      type="button"
                      disabled={runUpdating}
                      onClick={() => void completeCollectionRun()}
                      className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {runUpdating ? "Completing..." : "Complete Collection"}
                    </button>
                  </>
                )}

                {todayOperation.run?.status === "completed" && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                    Today&apos;s scheduled barangay collection is complete.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`rounded-2xl p-3 ${
              tracking
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}>
              <LocateFixed className={`h-6 w-6 ${
                tracking ? "animate-pulse" : ""
              }`} />
            </div>

            <div>
              <h2 className="font-black text-slate-900">
                Collector Live Location
              </h2>

              <p className="mt-1 text-sm text-slate-600">
                {locationStatus}
              </p>

              <p className="mt-1 text-xs text-slate-400">
                Only the Barangay Captain, Municipal Administrator,
                and Purok Leader can view this location.
              </p>

              {lastLocationUpdate && (
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  Last sent: {formatDate(lastLocationUpdate)}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              tracking
                ? void stopLocationTracking()
                : startLocationTracking()
            }
            className={`rounded-xl px-5 py-3 text-sm font-black text-white ${
              tracking
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-emerald-700 hover:bg-emerald-800"
            }`}
          >
            {tracking
              ? "Stop Sharing Location"
              : "Start Sharing Location"}
          </button>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label:
              "Registered Bins",
            value: stats.total,
            icon: Package,
          },
          {
            label:
              "Scheduled Today",
            value:
              stats.scheduled,
            icon: CalendarDays,
          },
          {
            label:
              "Overflowing",
            value: stats.urgent,
            icon: AlertCircle,
          },
          {
            label:
              "Completed Tasks",
            value:
              stats.completed,
            icon: ShieldCheck,
          },
          {
            label:
              "Assigned Complaints",
            value:
              stats.complaints,
            icon:
              MessageSquareWarning,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">
                  {item.label}
                </p>

                <p className="mt-1 text-3xl font-black text-slate-900">
                  {item.value}
                </p>
              </div>

              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                <item.icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex flex-col gap-2 bg-emerald-700 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <Truck className="h-5 w-5" />
              Today&apos;s Collection Bins
            </h2>

            <p className="mt-1 text-xs text-emerald-100">
              Scheduled, full, and overflowing bins appear here automatically.
            </p>
          </div>

          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black">
            {
              dashboardBins.length
            }{" "}
            bins
          </span>
        </div>

        <div className="divide-y">
          {dashboardBins.map(
            (bin) => {
              const busy =
                updatingId ===
                bin.id;

              const request =
                bin.request;

              return (
                <article
                  key={bin.id}
                  className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <MapPin className="h-6 w-6" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-slate-900">
                          {
                            bin.bin_code
                          }{" "}
                          —{" "}
                          {
                            bin.location_name
                          }
                        </h3>

                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">
                          {statusLabel(
                            bin.current_status,
                          )}
                        </span>

                        {isScheduledToday(
                          bin,
                        ) && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700">
                            Scheduled today
                          </span>
                        )}

                        {request && (
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase text-blue-700">
                            {statusLabel(
                              request.status,
                            )}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-slate-600">
                        {bin.purok_name ||
                          "Unassigned purok"}
                        {bin.barangay_name
                          ? `, ${bin.barangay_name}`
                          : ""}
                      </p>

                      <p className="mt-2 text-xs font-bold text-slate-500">
                        {isScheduledToday(
                          bin,
                        )
                          ? `${
                              bin.schedule_day ||
                              "Today"
                            }${
                              bin.schedule_start_time
                                ? ` • ${bin.schedule_start_time}`
                                : ""
                            }`
                          : "Marked by the Purok Leader for collection"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {!request && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          createTask(
                            bin,
                          )
                        }
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        Create Task
                      </button>
                    )}

                    {request?.status ===
                      "pending" && (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          updateStatus(
                            bin,
                            "assigned",
                          )
                        }
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        Accept Task
                      </button>
                    )}

                    {request &&
                      [
                        "approved",
                        "assigned",
                      ].includes(
                        request.status,
                      ) && (
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            updateStatus(
                              bin,
                              "in_progress",
                            )
                          }
                          className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                        >
                          Start Route
                        </button>
                      )}

                    {request?.status ===
                      "in_progress" && (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          updateStatus(
                            bin,
                            "completed",
                          )
                        }
                        className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Collected
                      </button>
                    )}
                  </div>
                </article>
              );
            },
          )}

          {!loading &&
            dashboardBins.length ===
              0 && (
              <div className="p-12 text-center text-slate-500">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />

                <p className="font-black">
                  No bins require collection today
                </p>

                <p className="mt-1 text-xs">
                  Scheduled, full, or overflowing bins will appear here.
                </p>
              </div>
            )}

          {loading && (
            <div className="p-12 text-center text-slate-500">
              <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading garbage bins...
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex flex-col gap-2 bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <MessageSquareWarning className="h-5 w-5 text-amber-400" />
              Assigned Civilian Complaints
            </h2>

            <p className="mt-1 text-xs text-slate-300">
              Only complaints assigned to your collector account appear here.
            </p>
          </div>

          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black">
            {
              activeComplaints.length
            }{" "}
            active
          </span>
        </div>

        <div className="divide-y">
          {activeComplaints.map(
            (complaint) => {
              const busy =
                updatingComplaintId ===
                complaint.id;

              return (
                <article
                  key={
                    complaint.id
                  }
                  className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                      <MessageSquareWarning className="h-6 w-6" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-slate-900">
                          CMP-
                          {
                            complaint.id
                          }{" "}
                          —{" "}
                          {
                            complaint.complaint_type
                          }
                        </h3>

                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase text-blue-700">
                          {statusLabel(
                            complaint.status,
                          )}
                        </span>
                      </div>

                      <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                        <MapPin className="h-4 w-4" />
                        {[
                          complaint.purok_name,
                          complaint.barangay_name,
                        ]
                          .filter(
                            Boolean,
                          )
                          .join(
                            ", ",
                          ) ||
                          "No area"}
                      </p>

                      <p className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                        <User className="h-3.5 w-3.5" />
                        Reporter:{" "}
                        {
                          complaint.reporter_name
                        }
                      </p>

                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDate(
                          complaint.created_at,
                        )}
                      </p>

                      <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                        {
                          complaint.description
                        }
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {complaint.status ===
                      "assigned" && (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          updateComplaintStatus(
                            complaint,
                            "in_progress",
                          )
                        }
                        className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        Start Task
                      </button>
                    )}

                    {complaint.status ===
                      "in_progress" && (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          updateComplaintStatus(
                            complaint,
                            "completed",
                          )
                        }
                        className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Completed
                      </button>
                    )}

                    {complaint.status ===
                      "completed" && (
                      <span className="rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black uppercase text-emerald-700">
                        Awaiting Captain Verification
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setCurrentScreen(
                          "complaints",
                        )
                      }
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700"
                    >
                      Open Details
                    </button>
                  </div>
                </article>
              );
            },
          )}

          {!loading &&
            activeComplaints.length ===
              0 && (
              <div className="p-12 text-center text-slate-500">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />

                <p className="font-black">
                  No assigned complaints
                </p>

                <p className="mt-1 text-xs">
                  Barangay Captain assignments will appear here automatically.
                </p>
              </div>
            )}

          {loading && (
            <div className="p-12 text-center text-slate-500">
              <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading assigned complaints...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}