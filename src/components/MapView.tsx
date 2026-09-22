import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Crosshair,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";

type BinStatus =
  | "empty"
  | "half-full"
  | "half_full"
  | "full"
  | "overflowing"
  | string;

type GarbageBin = {
  id: number;
  bin_code: string;
  location_name: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  current_status?: BinStatus | null;
  condition_status?: string | null;
  last_inspected_at?: string | null;
  photo_path?: string | null;
  is_active: number | boolean;
  purok_id?: number | null;
  purok_name?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  schedule_id?: number | null;
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
  requested_at?: string | null;
  completed_at?: string | null;
  assigned_collector_id?: number | null;
};

type BinWithRequest = GarbageBin & {
  request: CollectionRequest | null;
};

type MapBinFilter =
  | "all"
  | "active_tasks"
  | "needs_collection"
  | "scheduled_today"
  | "urgent";

type CollectorLocation = {
  collector_id: number;
  full_name: string;
  email: string;
  phone?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  latitude: number | string;
  longitude: number | string;
  accuracy_meters?: number | string | null;
  heading_degrees?: number | string | null;
  speed_mps?: number | string | null;
  is_on_duty: number | boolean;
  last_updated_at: string;
  location_status: "online" | "idle" | "offline" | string;
};

type CollectorHistoryPoint = {
  id: number;
  collector_id: number;
  full_name: string;
  latitude: number | string;
  longitude: number | string;
  accuracy_meters?: number | string | null;
  heading_degrees?: number | string | null;
  speed_mps?: number | string | null;
  recorded_at: string;
};

type MapViewProps = {
  viewOnly?: boolean;
};

type CurrentUserProfile = {
  id: number;
  role: string;
  barangay_id?: number | null;
  barangay_name?: string | null;
  full_name?: string;
};

function mapCoordinate(raw: string | undefined, fallback: number, limit: number) {
  const value = raw?.trim() ? Number(raw) : fallback;
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : fallback;
}

const DEFAULT_CENTER: L.LatLngExpression = [
  mapCoordinate(import.meta.env.VITE_MAP_CENTER_LAT, 10.2525, 90),
  mapCoordinate(import.meta.env.VITE_MAP_CENTER_LNG, 123.9494, 180),
];

const MAX_USABLE_ACCURACY_METERS = 1000;

function hasUsableCollectorCoordinates(
  collector?: CollectorLocation | null,
): collector is CollectorLocation {
  if (!collector) return false;

  const latitude = Number(collector.latitude);
  const longitude = Number(collector.longitude);
  const accuracy = Number(collector.accuracy_meters);

  return (
    Number.isFinite(latitude) &&
    latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 && longitude <= 180 &&
    !(latitude === 0 && longitude === 0) &&
    (!Number.isFinite(accuracy) || accuracy <= MAX_USABLE_ACCURACY_METERS)
  );
}

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

function getStoredRole(): string {
  return (localStorage.getItem("sg_user_role") || sessionStorage.getItem("sg_user_role") || "")
    .trim()
    .toLowerCase();
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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

function hasCoordinates(bin: GarbageBin): boolean {
  const latitude = Number(bin.latitude);
  const longitude = Number(bin.longitude);

  return (
    bin.latitude !== null &&
    bin.latitude !== undefined &&
    bin.latitude !== "" &&
    bin.longitude !== null &&
    bin.longitude !== undefined &&
    bin.longitude !== "" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function normalizeStatus(value?: string | null): string {
  return String(value || "empty")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
}

function statusLabel(value?: string | null): string {
  return normalizeStatus(value)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function formatDate(value?: string | null): string {
  if (!value) return "Not yet inspected";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function isScheduledToday(bin: GarbageBin): boolean {
  return Number(bin.is_scheduled_today) === 1;
}

function needsCollection(bin: GarbageBin): boolean {
  const status = normalizeStatus(bin.current_status);
  return (
    isScheduledToday(bin) ||
    status === "full" ||
    status === "overflowing"
  );
}

function needsSpecialCollection(bin: GarbageBin): boolean {
  const status = normalizeStatus(bin.current_status);
  return status === "full" || status === "overflowing";
}

function priorityForBin(
  bin: GarbageBin,
): CollectionRequest["priority"] {
  const status = normalizeStatus(bin.current_status);

  if (status === "overflowing") return "urgent";
  if (status === "full") return "high";
  if (isScheduledToday(bin)) return "normal";
  return "low";
}

function markerColor(bin: GarbageBin): string {
  const status = normalizeStatus(bin.current_status);
  const isCollector = getStoredRole() === "collector";

  if (!Boolean(Number(bin.is_active))) return "#64748b";

  if (isCollector) {
    if (status === "overflowing") return "#dc2626";
    if (isScheduledToday(bin)) return "#16a34a";
    return "#94a3b8";
  }

  if (status === "overflowing") return "#dc2626";
  if (status === "full") return "#f97316";
  if (isScheduledToday(bin)) return "#16a34a";
  if (status === "half-full") return "#eab308";
  return "#2563eb";
}

function getSafePhotoUrl(value?: string | null): string | null {
  const photoPath = value?.trim();

  if (!photoPath) return null;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photoPath)) return photoPath;

  try {
    const url = new URL(photoPath, window.location.origin);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}

function makeMarkerIcon(bin: GarbageBin): L.DivIcon {
  const color = markerColor(bin);
  const scheduledRing = isScheduledToday(bin)
    ? "box-shadow: 0 0 0 4px rgba(34,197,94,.25);"
    : "";
  const photoUrl = getSafePhotoUrl(bin.photo_path);
  const centerContent = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="" style="width: 20px; height: 20px; object-fit: cover; border-radius: 999px; display: block; transform: rotate(45deg);" />`
    : `<div style="width: 8px; height: 8px; border-radius: 999px; background: white;"></div>`;

  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 999px 999px 999px 0;
        transform: rotate(-45deg);
        background: ${color};
        border: 3px solid white;
        ${scheduledRing}
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        ${centerContent}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -29],
  });
}

function collectorMarkerColor(
  status?: string,
): string {
  if (status === "online") return "#16a34a";
  if (status === "idle") return "#f59e0b";
  return "#64748b";
}

function makeCollectorMarkerIcon(
  collector: CollectorLocation,
): L.DivIcon {
  const color = collectorMarkerColor(
    collector.location_status,
  );

  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 38px;
        height: 38px;
        border-radius: 999px;
        background: ${color};
        border: 4px solid white;
        box-shadow: 0 8px 20px rgba(15,23,42,.25);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
      ">🚛</div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

export default function MapView({
  viewOnly = false,
}: MapViewProps) {
  const canManageCollectionTasks =
    !viewOnly && getStoredRole() === "collector";
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const collectorLayerRef =
    useRef<L.LayerGroup | null>(null);
  const routeHistoryLayerRef =
    useRef<L.LayerGroup | null>(null);
  const destinationLayerRef =
    useRef<L.LayerGroup | null>(null);

  const hasAutoFocusedRef =
    useRef(false);

  const userMovedMapRef =
    useRef(false);

  const [bins, setBins] = useState<GarbageBin[]>([]);
  const [collectorLocations, setCollectorLocations] =
    useState<CollectorLocation[]>([]);
  const [collectorHistory, setCollectorHistory] =
    useState<CollectorHistoryPoint[]>([]);
  const [ownCollectorLocation, setOwnCollectorLocation] =
    useState<CollectorLocation | null>(null);
  const [collectorLocationError, setCollectorLocationError] =
    useState("");
  const [requests, setRequests] =
    useState<CollectionRequest[]>([]);

  const [currentUser, setCurrentUser] =
    useState<CurrentUserProfile | null>(null);

  const [selectedId, setSelectedId] =
    useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] =
    useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [binSearch, setBinSearch] = useState("");
  const [binFilter, setBinFilter] = useState<MapBinFilter>("all");
  const [binPage, setBinPage] = useState(1);
  const [binPageSize, setBinPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [collectorPage, setCollectorPage] = useState(1);
  const [collectorPageSize, setCollectorPageSize] = useState(DEFAULT_PAGE_SIZE);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");
    setCollectorLocationError("");

    try {
      const [
        binResult,
        requestResult,
        profileResult,
      ] = await Promise.all([
        apiRequest("/api/garbage-bins"),
        apiRequest("/api/collection-requests"),
        apiRequest("/api/auth/me"),
      ]);

      setBins(
        Array.isArray(binResult.bins)
          ? binResult.bins
          : [],
      );

      setRequests(
        Array.isArray(requestResult.requests)
          ? requestResult.requests
          : [],
      );

      setCurrentUser(
        profileResult?.user || null,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load collector route data.",
      );
    }

    const storedRole = getStoredRole();

    try {
      if (storedRole === "collector") {
        const ownResult = await apiRequest(
          "/api/collector-locations/me",
        );
        setOwnCollectorLocation(ownResult.collector || null);
        setCollectorLocations(ownResult.collector ? [ownResult.collector] : []);
      } else {
        const collectorResult = await apiRequest(
          "/api/collector-locations",
        );
        setCollectorLocations(
          Array.isArray(collectorResult.collectors)
            ? collectorResult.collectors
            : [],
        );
        setOwnCollectorLocation(null);
      }

      const historyResult = await apiRequest(
        "/api/collector-locations/history",
      );
      setCollectorHistory(
        Array.isArray(historyResult.history)
          ? historyResult.history
          : [],
      );
    } catch (error) {
      setCollectorLocations([]);
      setCollectorHistory([]);
      setOwnCollectorLocation(null);
      setCollectorLocationError(
        error instanceof Error
          ? error.message
          : "Collector locations are unavailable.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (getStoredRole() !== "collector") {
      return;
    }

    const onLocationUpdate = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<{
          latitude?: number;
          longitude?: number;
          accuracy?: number;
          timestamp?: number;
        }>;

      const latitude =
        Number(
          customEvent.detail?.latitude,
        );
      const longitude =
        Number(
          customEvent.detail?.longitude,
        );

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return;
      }

      setOwnCollectorLocation(
        (previous) => ({
          collector_id:
            previous?.collector_id ||
            Number(currentUser?.id || 0),
          full_name:
            previous?.full_name ||
            currentUser?.full_name ||
            "Garbage Collector",
          email:
            previous?.email || "",
          phone:
            previous?.phone || null,
          barangay_id:
            previous?.barangay_id ||
            currentUser?.barangay_id ||
            null,
          barangay_name:
            previous?.barangay_name ||
            currentUser?.barangay_name ||
            null,
          latitude,
          longitude,
          accuracy_meters:
            customEvent.detail?.accuracy ??
            previous?.accuracy_meters ??
            null,
          heading_degrees:
            previous?.heading_degrees ??
            null,
          speed_mps:
            previous?.speed_mps ??
            null,
          is_on_duty: 1,
          last_updated_at:
            new Date(
              customEvent.detail?.timestamp ||
                Date.now(),
            ).toISOString(),
          location_status: "online",
        }),
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
  }, [
    currentUser?.id,
    currentUser?.full_name,
    currentUser?.barangay_id,
    currentUser?.barangay_name,
  ]);

  useEffect(() => {
    const container = mapContainerRef.current;

    if (!container || mapRef.current) {
      return;
    }

    const map = L.map(container).setView(
      DEFAULT_CENTER,
      14,
    );

    const tileLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
        crossOrigin: true,
      },
    ).addTo(map);

    tileLayer.on("tileerror", () => {
      window.setTimeout(
        () => tileLayer.redraw(),
        1000,
      );
    });

    markerLayerRef.current =
      L.layerGroup().addTo(map);
    routeHistoryLayerRef.current =
      L.layerGroup().addTo(map);
    destinationLayerRef.current =
      L.layerGroup().addTo(map);
    collectorLayerRef.current =
      L.layerGroup().addTo(map);
    mapRef.current = map;

    // Only real mouse/touch interaction should count as the
    // user moving the map. Programmatic fitBounds/setView calls
    // must not disable the initial automatic focus.
    const markUserMovement = (event: L.LeafletEvent) => {
      if ((event as any).originalEvent) {
        userMovedMapRef.current = true;
      }
    };

    map.on("dragstart", markUserMovement);
    map.on("zoomstart", markUserMovement);

    let resizeTimer: number | null = null;

    const resizeMapPreservingCamera = () => {
      if (!mapRef.current) {
        return;
      }

      const currentMap = mapRef.current;
      const center = currentMap.getCenter();
      const zoom = currentMap.getZoom();

      currentMap.invalidateSize({
        pan: false,
        animate: false,
      });

      // Preserve the exact camera while the collapsible sidebar
      // changes the available content width.
      currentMap.setView(
        center,
        zoom,
        { animate: false },
      );
    };

    const scheduleResize = () => {
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }

      resizeTimer = window.setTimeout(
        resizeMapPreservingCamera,
        80,
      );
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleResize)
        : null;

    resizeObserver?.observe(container);
    window.addEventListener(
      "resize",
      scheduleResize,
    );

    window.setTimeout(
      resizeMapPreservingCamera,
      150,
    );

    return () => {
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }

      resizeObserver?.disconnect();

      window.removeEventListener(
        "resize",
        scheduleResize,
      );

      map.off("dragstart", markUserMovement);
      map.off("zoomstart", markUserMovement);
      map.remove();

      mapRef.current = null;
      markerLayerRef.current = null;
      routeHistoryLayerRef.current = null;
      destinationLayerRef.current = null;
      collectorLayerRef.current = null;
    };
  }, []);

  const currentCollectorId =
    getStoredRole() === "collector"
      ? Number(currentUser?.id || 0)
      : 0;

  const currentRole = getStoredRole();

  const currentBarangayId =
    currentRole === "collector" ||
    currentRole === "admin"
      ? Number(currentUser?.barangay_id || 0)
      : 0;

  const activeRequestsByBin = useMemo(() => {
    const map = new Map<number, CollectionRequest>();

    [...requests]
      .sort((a, b) => b.id - a.id)
      .forEach((request) => {
        if (
          request.status === "cancelled" ||
          request.status === "completed" ||
          map.has(request.bin_id)
        ) {
          return;
        }

        if (
          getStoredRole() === "collector" &&
          request.assigned_collector_id &&
          Number(request.assigned_collector_id) !==
            currentCollectorId
        ) {
          return;
        }

        map.set(request.bin_id, request);
      });

    return map;
  }, [requests, currentCollectorId]);

  const visibleBins = useMemo<BinWithRequest[]>(
    () =>
      bins
        .filter((bin) => Number(bin.is_active) === 1)
        .filter((bin) =>
          currentRole === "collector" ||
          currentRole === "admin"
            ? (
                currentBarangayId > 0 &&
                Number(bin.barangay_id) ===
                  currentBarangayId
              )
            : true,
        )
        .map((bin) => ({
          ...bin,
          request:
            activeRequestsByBin.get(bin.id) || null,
        }))
        .sort((a, b) => {
          if (getStoredRole() === "collector") {
            const statusRank = (
              request: CollectionRequest | null,
            ) => {
              if (request?.status === "in_progress")
                return 4;
              if (request?.status === "assigned")
                return 3;
              if (request?.status === "approved")
                return 2;
              if (request?.status === "pending")
                return 1;
              return 0;
            };

            const statusDifference =
              statusRank(b.request) -
              statusRank(a.request);

            if (statusDifference !== 0) {
              return statusDifference;
            }

            const priorityRank = {
              urgent: 4,
              high: 3,
              normal: 2,
              low: 1,
            };

            return (
              (priorityRank[
                b.request?.priority || "low"
              ] || 0) -
              (priorityRank[
                a.request?.priority || "low"
              ] || 0)
            );
          }

          const aPriority =
            needsCollection(a) ? 1 : 0;
          const bPriority =
            needsCollection(b) ? 1 : 0;

          return bPriority - aPriority;
        }),
    [
      bins,
      activeRequestsByBin,
      currentBarangayId,
      currentRole,
    ],
  );

  const filteredBins = useMemo(() => {
    const query = binSearch.trim().toLowerCase();

    return visibleBins.filter((bin) => {
      const matchesSearch = !query || [
        bin.bin_code,
        bin.location_name,
        bin.purok_name,
        bin.barangay_name,
      ].some((value) => value?.toLowerCase().includes(query));
      const hasActiveTask = Boolean(
        bin.request && !["completed", "cancelled"].includes(bin.request.status),
      );
      const matchesFilter = binFilter === "all"
        || (binFilter === "active_tasks" && hasActiveTask)
        || (binFilter === "needs_collection" && needsCollection(bin))
        || (binFilter === "scheduled_today" && isScheduledToday(bin))
        || (binFilter === "urgent" && normalizeStatus(bin.current_status) === "overflowing");

      return matchesSearch && matchesFilter;
    });
  }, [visibleBins, binFilter, binSearch]);

  const binPageCount = Math.max(1, Math.ceil(filteredBins.length / binPageSize));
  const safeBinPage = Math.min(binPage, binPageCount);
  const paginatedBins = useMemo(
    () => filteredBins.slice((safeBinPage - 1) * binPageSize, safeBinPage * binPageSize),
    [filteredBins, safeBinPage, binPageSize],
  );
  const collectorPageCount = Math.max(1, Math.ceil(collectorLocations.length / collectorPageSize));
  const safeCollectorPage = Math.min(collectorPage, collectorPageCount);
  const paginatedCollectors = useMemo(
    () => collectorLocations.slice(
      (safeCollectorPage - 1) * collectorPageSize,
      safeCollectorPage * collectorPageSize,
    ),
    [collectorLocations, safeCollectorPage, collectorPageSize],
  );

  useEffect(() => {
    if (binPage > binPageCount) setBinPage(binPageCount);
  }, [binPage, binPageCount]);

  useEffect(() => {
    setBinPage(1);
  }, [binFilter, binSearch]);

  useEffect(() => {
    if (collectorPage > collectorPageCount) setCollectorPage(collectorPageCount);
  }, [collectorPage, collectorPageCount]);

  useEffect(() => {
    if (selectedId !== null && !filteredBins.some((bin) => bin.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredBins, selectedId]);

  const selectBin = (bin: BinWithRequest, centerMap = true) => {
    setSelectedId(bin.id);
    const index = filteredBins.findIndex((item) => item.id === bin.id);
    if (index >= 0) setBinPage(Math.floor(index / binPageSize) + 1);

    if (centerMap && hasCoordinates(bin)) {
      mapRef.current?.setView(
        [Number(bin.latitude), Number(bin.longitude)],
        17,
      );
    }
  };

  const selectedBin =
    filteredBins.find(
      (bin) => bin.id === selectedId,
    ) || null;

  const nextCollectionBin = useMemo(
    () =>
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          bin.request?.status === "in_progress",
      ) ||
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          bin.request?.status === "assigned",
      ) ||
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          bin.request?.status === "approved",
      ) ||
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          bin.request?.status === "pending",
      ) ||
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          normalizeStatus(bin.current_status) === "overflowing",
      ) ||
      visibleBins.find(
        (bin) =>
          hasCoordinates(bin) &&
          isScheduledToday(bin),
      ) ||
      (getStoredRole() !== "collector"
        ? visibleBins.find(
            (bin) =>
              hasCoordinates(bin) &&
              needsCollection(bin),
          )
        : null) ||
      null,
    [visibleBins],
  );

  useEffect(() => {
    const markerLayer = markerLayerRef.current;
    if (!markerLayer) return;

    markerLayer.clearLayers();
    const mappedBins = filteredBins.filter(hasCoordinates);

    mappedBins.forEach((bin) => {
      const marker = L.marker(
        [Number(bin.latitude), Number(bin.longitude)],
        { icon: makeMarkerIcon(bin) },
      ).addTo(markerLayer);

      const photoUrl = getSafePhotoUrl(bin.photo_path);
      const photoMarkup = photoUrl
        ? `<img src="${escapeHtml(photoUrl)}" alt="Garbage bin ${escapeHtml(bin.bin_code)}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 10px; margin-bottom: 8px; display: block;" />`
        : "";

      marker.bindPopup(`
        <div style="min-width: 210px; line-height: 1.5;">
          ${photoMarkup}
          <strong>${bin.bin_code}</strong><br />
          ${bin.location_name}<br />
          ${bin.purok_name || "No purok"}${
            bin.barangay_name
              ? `, ${bin.barangay_name}`
              : ""
          }<br />
          Bin status: ${statusLabel(bin.current_status)}<br />
          ${
            getStoredRole() === "collector" &&
            bin.request
              ? `Collection task: ${statusLabel(bin.request.status)}<br />Priority: ${statusLabel(bin.request.priority)}`
              : `Scheduled today: ${isScheduledToday(bin) ? "Yes" : "No"}`
          }
        </div>
      `);

      marker.on("click", () => selectBin(bin, false));
    });

    const map = mapRef.current;

    if (!map) {
      return;
    }

    // Do not lock the initial camera while the first API request
    // is still loading. Otherwise an empty first render can mark
    // auto-focus as finished before the real bin coordinates arrive.
    if (
      !loading &&
      !hasAutoFocusedRef.current &&
      !userMovedMapRef.current
    ) {
      window.setTimeout(() => {
        if (
          !mapRef.current ||
          hasAutoFocusedRef.current ||
          userMovedMapRef.current
        ) {
          return;
        }

        const currentMap = mapRef.current;

        currentMap.invalidateSize({
          pan: false,
          animate: false,
        });

        if (mappedBins.length > 0) {
          const points: L.LatLngTuple[] =
            mappedBins.map((bin) => [
              Number(bin.latitude),
              Number(bin.longitude),
            ]);

          if (
            getStoredRole() === "collector" &&
            hasUsableCollectorCoordinates(
              ownCollectorLocation,
            )
          ) {
            points.push([
              Number(
                ownCollectorLocation.latitude,
              ),
              Number(
                ownCollectorLocation.longitude,
              ),
            ]);
          }

          currentMap.fitBounds(
            L.latLngBounds(points),
            {
              padding: [50, 50],
              maxZoom: 17,
              animate: false,
            },
          );
        } else if (
          getStoredRole() === "collector" &&
          hasUsableCollectorCoordinates(
            ownCollectorLocation,
          )
        ) {
          currentMap.setView(
            [
              Number(
                ownCollectorLocation.latitude,
              ),
              Number(
                ownCollectorLocation.longitude,
              ),
            ],
            17,
            { animate: false },
          );
        } else {
          currentMap.setView(
            DEFAULT_CENTER,
            14,
            { animate: false },
          );
        }

        hasAutoFocusedRef.current = true;
      }, 180);
    } else {
      window.setTimeout(
        () =>
          mapRef.current?.invalidateSize({
            pan: false,
            animate: false,
          }),
        100,
      );
    }
  }, [
    filteredBins,
    ownCollectorLocation,
    loading,
    binPageSize,
  ]);

  useEffect(() => {
    const historyLayer = routeHistoryLayerRef.current;
    if (!historyLayer) return;
    historyLayer.clearLayers();

    const grouped = new Map<number, CollectorHistoryPoint[]>();
    collectorHistory.forEach((point) => {
      const list = grouped.get(point.collector_id) || [];
      list.push(point);
      grouped.set(point.collector_id, list);
    });

    grouped.forEach((points) => {
      const coordinates = points
        .map((point) => [Number(point.latitude), Number(point.longitude)] as L.LatLngTuple)
        .filter(([latitude, longitude]) =>
          Number.isFinite(latitude) &&
          latitude >= -90 && latitude <= 90 &&
          Number.isFinite(longitude) &&
          longitude >= -180 && longitude <= 180 &&
          !(latitude === 0 && longitude === 0)
        );

      if (coordinates.length >= 2) {
        L.polyline(coordinates, { weight: 5, opacity: 0.65 }).addTo(historyLayer);
      }
    });
  }, [collectorHistory]);

  useEffect(() => {
    const destinationLayer = destinationLayerRef.current;
    if (!destinationLayer) return;
    destinationLayer.clearLayers();

    if (!ownCollectorLocation || !nextCollectionBin || !hasCoordinates(nextCollectionBin)) return;

    const currentPoint: L.LatLngTuple = [Number(ownCollectorLocation.latitude), Number(ownCollectorLocation.longitude)];
    const destinationPoint: L.LatLngTuple = [Number(nextCollectionBin.latitude), Number(nextCollectionBin.longitude)];

    if (!currentPoint.every(Number.isFinite) || !destinationPoint.every(Number.isFinite)) return;

    L.polyline([currentPoint, destinationPoint], { weight: 4, opacity: 0.85, dashArray: "10 10" })
      .addTo(destinationLayer);
  }, [ownCollectorLocation, nextCollectionBin]);

  useEffect(() => {
    const collectorLayer =
      collectorLayerRef.current;

    if (!collectorLayer) return;

    collectorLayer.clearLayers();

    collectorLocations.forEach((collector) => {
      if (!hasUsableCollectorCoordinates(collector)) return;

      const latitude = Number(collector.latitude);
      const longitude = Number(collector.longitude);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return;
      }

      const marker = L.marker(
        [latitude, longitude],
        {
          icon: makeCollectorMarkerIcon(
            collector,
          ),
          zIndexOffset: 1000,
        },
      ).addTo(collectorLayer);

      marker.bindPopup(`
        <div style="min-width: 220px; line-height: 1.5;">
          <strong>🚛 ${collector.full_name}</strong><br />
          ${collector.barangay_name || "No barangay"}<br />
          Status: ${statusLabel(collector.location_status)}<br />
          Last updated: ${formatDate(collector.last_updated_at)}<br />
          Accuracy: ${
            collector.accuracy_meters
              ? `${Math.round(Number(collector.accuracy_meters))} meters`
              : "Not available"
          }
        </div>
      `);
    });
  }, [collectorLocations]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData();
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const recenterOnCollector = () => {
    if (
      !mapRef.current ||
      !hasUsableCollectorCoordinates(ownCollectorLocation)
    ) {
      return;
    }

    const latitude =
      Number(
        ownCollectorLocation.latitude,
      );
    const longitude =
      Number(
        ownCollectorLocation.longitude,
      );

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

    userMovedMapRef.current = false;

    mapRef.current.setView(
      [latitude, longitude],
      18,
      { animate: true },
    );
  };

  const createTask = async (bin: BinWithRequest) => {
    if (!canManageCollectionTasks) return;

    if (
      getStoredRole() === "collector" &&
      isScheduledToday(bin) &&
      !needsSpecialCollection(bin)
    ) {
      setSuccessMessage(
        "This bin is already part of today's normal scheduled collection route.",
      );
      return;
    }

    setUpdatingId(bin.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const priority = priorityForBin(bin);
      const result = await apiRequest(
        "/api/collection-requests",
        {
          method: "POST",
          body: JSON.stringify({
            bin_id: bin.id,
            priority,
            reason: isScheduledToday(bin)
              ? `Scheduled collection for ${
                  bin.schedule_day || "today"
                }.`
              : `${statusLabel(
                  bin.current_status,
                )} garbage bin requires collection.`,
          }),
        },
      );

      setSuccessMessage(
        result.message || "Collection task created.",
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
    bin: BinWithRequest,
    status: "assigned" | "in_progress" | "completed",
  ) => {
    if (!canManageCollectionTasks || !bin.request) return;

    setUpdatingId(bin.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await apiRequest(
        `/api/collection-requests/${bin.request.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );

      setSuccessMessage(
        result.message || "Collection task updated.",
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

  const scheduledCount = visibleBins.filter(
    isScheduledToday,
  ).length;
  const needsCollectionCount = visibleBins.filter(
    needsCollection,
  ).length;
  const mappedCount = filteredBins.filter(hasCoordinates).length;
  const historyPointCount = collectorHistory.length;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">
            {viewOnly
              ? "Garbage Bin and Collector Monitoring"
              : getStoredRole() === "collector"
                ? "Barangay Collection Route"
                : "Collector Route Map"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {getStoredRole() === "collector"
              ? `Showing mapped garbage bins across ${
                  currentUser?.barangay_name ||
                  "your assigned barangay"
                }. Green pins are scheduled today, red pins are urgent overflow, and gray pins are other collection points.`
              : "All active bins registered by Purok Leaders are shown. Green-ringed bins are scheduled today."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {getStoredRole() === "collector" &&
            hasUsableCollectorCoordinates(ownCollectorLocation) && (
              <button
                type="button"
                onClick={recenterOnCollector}
                className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-black text-slate-700"
              >
                <Crosshair className="h-4 w-4" />
                Recenter on Truck
              </button>
            )}

          <button
            type="button"
            onClick={loadData}
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-black text-slate-700"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading ? "animate-spin" : ""
              }`}
            />
            Refresh
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

      {collectorLocationError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
          {collectorLocationError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={
            getStoredRole() === "collector"
              ? "Barangay Collection Bins"
              : "Active Bins"
          }
          value={visibleBins.length}
        />
        <StatCard
          label="Scheduled Today"
          value={scheduledCount}
        />
        <StatCard
          label="Needs Collection"
          value={needsCollectionCount}
        />
        <StatCard
          label="Collectors Online"
          value={
            collectorLocations.filter(
              (collector) =>
                collector.location_status === "online",
            ).length
          }
        />
        <StatCard label="Route Points (24h)" value={historyPointCount} />
      </div>

      <div className="flex flex-wrap gap-3 rounded-2xl border bg-white p-4 text-xs font-bold text-slate-600 shadow-sm">
        {getStoredRole() === "collector" ? (
          <>
            <Legend color="#16a34a" label="Scheduled today" />
            <Legend color="#dc2626" label="Urgent / overflowing" />
            <Legend color="#94a3b8" label="Other mapped bin" />
          </>
        ) : (
          <>
            <Legend color="#16a34a" label="Scheduled today" />
            <Legend color="#dc2626" label="Overflowing" />
            <Legend color="#f97316" label="Full" />
            <Legend color="#eab308" label="Half-full" />
            <Legend color="#2563eb" label="Empty / normal" />
          </>
        )}
        <Legend color="#16a34a" label="Collector online" />
        <Legend color="#f59e0b" label="Collector idle" />
        <Legend color="#64748b" label="Collector offline" />
      </div>

      {nextCollectionBin && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">
            Next Collection Destination
          </p>
          <p className="mt-1 font-black text-blue-950">
            {nextCollectionBin.bin_code} — {nextCollectionBin.location_name}
          </p>
          <p className="mt-1 text-xs text-blue-700">
            {nextCollectionBin.purok_name || "No purok"}
            {nextCollectionBin.request ? ` • ${statusLabel(nextCollectionBin.request.status)}` : ""}
          </p>
        </div>
      )}

      <section className="grid gap-3 rounded-2xl border bg-white p-3 shadow-sm sm:grid-cols-[1fr_190px_auto]" aria-label="Garbage bin map filters">
        <label className="text-xs font-bold text-slate-600">
          Search bins
          <span className="relative mt-1 block">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={binSearch}
              onChange={(event) => setBinSearch(event.target.value)}
              placeholder="Bin code, location, purok, or barangay"
              className="min-h-10 w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm font-normal"
            />
          </span>
        </label>
        <label className="text-xs font-bold text-slate-600">
          Show
          <select
            value={binFilter}
            onChange={(event) => setBinFilter(event.target.value as MapBinFilter)}
            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
          >
            <option value="all">All active bins</option>
            <option value="active_tasks">Active tasks</option>
            <option value="needs_collection">Needs collection</option>
            <option value="scheduled_today">Scheduled today</option>
            <option value="urgent">Overflowing</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          {(binFilter !== "all" || binSearch) && (
            <button
              type="button"
              onClick={() => {
                setBinFilter("all");
                setBinSearch("");
              }}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
          <span className="pb-2 text-xs font-bold text-slate-500" aria-live="polite">
            {filteredBins.length} matching
          </span>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="relative isolate overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div
            ref={mapContainerRef}
            className="relative z-0 h-[360px] w-full sm:h-[560px]"
          />
        </div>

        <aside className="rounded-2xl border bg-white p-5 shadow-sm">
          {!selectedBin ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
              <Navigation className="mb-3 h-10 w-10 text-emerald-700" />
              <h2 className="font-black text-slate-900">
                Select a garbage bin
              </h2>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                Click a marker or choose a bin from the list below.
              </p>
            </div>
          ) : (
            <BinDetails
              bin={selectedBin}
              busy={updatingId === selectedBin.id}
              viewOnly={!canManageCollectionTasks}
              onCreateTask={() => createTask(selectedBin)}
              onUpdateStatus={(status) =>
                updateStatus(selectedBin, status)
              }
            />
          )}
        </aside>
      </div>

      {collectorLocations.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-black text-slate-900">
              Authorized Collector Locations
            </h2>
            <span className="text-xs font-bold text-slate-500">
              {collectorLocations.length} on duty
            </span>
          </div>

          <div className="divide-y">
            {paginatedCollectors.map((collector) => (
              <button
                key={collector.collector_id}
                type="button"
                onClick={() => {
                  if (!hasUsableCollectorCoordinates(collector)) return;
                  mapRef.current?.setView(
                    [Number(collector.latitude), Number(collector.longitude)],
                    17,
                  );
                }}
                className="flex w-full flex-col gap-3 p-5 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700">
                    <Truck className="h-5 w-5" />
                  </div>

                  <div>
                    <p className="font-black text-slate-900">
                      {collector.full_name}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      {collector.barangay_name || "No barangay"}
                      {" • "}
                      Updated {formatDate(collector.last_updated_at)}
                    </p>
                  </div>
                </div>

                <Badge
                  label={statusLabel(collector.location_status)}
                  tone={
                    collector.location_status === "online"
                      ? "green"
                      : collector.location_status === "idle"
                        ? "blue"
                        : "gray"
                  }
                />
              </button>
            ))}
          </div>
          <div className="px-5 pb-4">
            <Pagination
              page={safeCollectorPage}
              pageSize={collectorPageSize}
              totalItems={collectorLocations.length}
              onPageChange={setCollectorPage}
              onPageSizeChange={(nextPageSize) => {
                setCollectorPageSize(nextPageSize);
                setCollectorPage(1);
              }}
              compact
              itemLabel="collector locations"
            />
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-black text-slate-900">
            Garbage Bin Collection List
          </h2>
          <span className="text-xs font-bold text-slate-500">
            {mappedCount} with map coordinates
          </span>
        </div>

        <div className="divide-y">
          {paginatedBins.map((bin) => (
            <button
              key={bin.id}
              type="button"
              onClick={() => selectBin(bin)}
              className={`flex w-full flex-col gap-3 p-5 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between ${
                selectedId === bin.id ? "bg-emerald-50" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-black text-slate-900">
                    {bin.bin_code} — {bin.location_name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {bin.purok_name || "No purok"}
                    {bin.barangay_name
                      ? `, ${bin.barangay_name}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge label={statusLabel(bin.current_status)} />
                {isScheduledToday(bin) && (
                  <Badge label="Scheduled today" tone="green" />
                )}
                {bin.request && (
                  <Badge
                    label={statusLabel(bin.request.status)}
                    tone="blue"
                  />
                )}
                {!hasCoordinates(bin) && (
                  <Badge label="No coordinates" tone="red" />
                )}
              </div>
            </button>
          ))}

          {!loading && filteredBins.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="font-black">
                {visibleBins.length === 0
                  ? (getStoredRole() === "collector"
                    ? "No garbage bins found in your assigned barangay"
                    : "No garbage bins found")
                  : "No garbage bins match these filters"}
              </p>
              <p className="mt-1 text-xs">
                {visibleBins.length === 0
                  ? (getStoredRole() === "collector"
                    ? "Registered bins from your assigned barangay will appear here even when they do not yet have a collection task."
                    : "A Purok Leader must register a garbage bin first.")
                  : "Clear the search or choose a different filter to see more bins."}
              </p>
            </div>
          )}

          {loading && (
            <div className="p-10 text-center text-slate-500">
              <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading garbage bins...
            </div>
          )}
        </div>
        {!loading && filteredBins.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination
              page={safeBinPage}
              pageSize={binPageSize}
              totalItems={filteredBins.length}
              onPageChange={setBinPage}
              onPageSizeChange={(nextPageSize) => {
                setBinPageSize(nextPageSize);
                setBinPage(1);
              }}
              compact
              itemLabel="garbage bins"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-slate-900">
        {value}
      </p>
    </div>
  );
}

function Legend({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Badge({
  label,
  tone = "gray",
}: {
  label: string;
  tone?: "gray" | "green" | "blue" | "red";
}) {
  const className = {
    gray: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
    red: "bg-rose-100 text-rose-700",
  }[tone];

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${className}`}
    >
      {label}
    </span>
  );
}

function BinDetails({
  bin,
  busy,
  viewOnly,
  onCreateTask,
  onUpdateStatus,
}: {
  bin: BinWithRequest;
  busy: boolean;
  viewOnly: boolean;
  onCreateTask: () => void;
  onUpdateStatus: (
    status: "assigned" | "in_progress" | "completed",
  ) => void;
}) {
  const request = bin.request;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase text-emerald-700">
          Selected Garbage Bin
        </p>
        <h2 className="mt-1 text-xl font-black text-slate-900">
          {bin.bin_code}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {bin.location_name}
        </p>
      </div>

      <div className="rounded-xl border bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-slate-500">
          Area
        </p>
        <p className="mt-1 font-black text-slate-900">
          {bin.purok_name || "No purok"}
          {bin.barangay_name ? `, ${bin.barangay_name}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoCard
          label="Bin Status"
          value={statusLabel(bin.current_status)}
        />
        <InfoCard
          label="Condition"
          value={statusLabel(bin.condition_status || "good")}
        />
      </div>

      <div className="rounded-xl border p-3">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          Collection Schedule
        </p>
        <p className="mt-1 text-sm font-black text-slate-800">
          {isScheduledToday(bin)
            ? `${bin.schedule_day || "Today"}${
                bin.schedule_start_time
                  ? ` • ${bin.schedule_start_time}`
                  : ""
              }`
            : "Not scheduled today"}
        </p>
        {bin.schedule_notes && (
          <p className="mt-1 text-xs text-slate-500">
            {bin.schedule_notes}
          </p>
        )}
      </div>

      <div className="rounded-xl border p-3">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-500">
          <Clock className="h-3.5 w-3.5" />
          Last Inspection
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {formatDate(bin.last_inspected_at)}
        </p>
      </div>

      {request && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-[10px] font-bold uppercase text-blue-600">
            Collection Task
          </p>
          <p className="mt-1 text-sm font-black text-blue-900">
            {statusLabel(request.status)} • {request.priority}
          </p>
        </div>
      )}

      {!viewOnly && (
        <div className="space-y-2">
          {!request &&
            getStoredRole() === "collector" &&
            isScheduledToday(bin) &&
            !needsSpecialCollection(bin) && (
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-black text-emerald-700">
                Part of today&apos;s normal scheduled collection route
              </div>
            )}

          {!request && needsSpecialCollection(bin) && (
            <button
              type="button"
              disabled={busy}
              onClick={onCreateTask}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              <Truck className="h-4 w-4" />
              Create Special Collection Task
            </button>
          )}

          {!request &&
            !isScheduledToday(bin) &&
            !needsSpecialCollection(bin) && (
              <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-sm font-black text-slate-600">
                This bin is not scheduled for collection today
              </div>
            )}

          {request?.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdateStatus("assigned")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              <Truck className="h-4 w-4" />
              Accept Task
            </button>
          )}

          {request &&
            ["approved", "assigned"].includes(request.status) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onUpdateStatus("in_progress")}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                <Navigation className="h-4 w-4" />
                Start Route
              </button>
            )}

          {request?.status === "in_progress" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdateStatus("completed")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Collected
            </button>
          )}

          {request?.status === "completed" && (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Collection Completed
            </div>
          )}
        </div>
      )}

      {viewOnly && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-sm font-black text-slate-600">
          Administrator monitoring only
        </div>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[10px] font-bold uppercase text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-slate-900">
        {value}
      </p>
    </div>
  );
}
