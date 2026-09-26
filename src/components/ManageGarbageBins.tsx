import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAppState } from "../context/AppStateContext";
import ConfirmDialog from "./ConfirmDialog";
import MapView from "./MapView";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";
import { isBinPhoto, MAX_BIN_PHOTO_BYTES } from "../../shared/binPhotos";

import {
  MapPin,
  ImagePlus,
  Upload,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Trash2,
  X,
} from "lucide-react";

type GarbageBin = {
  photo_path?: string | null;
  bin_photo?: string | null;
  id: number;
  bin_code: string;
  location_name: string;
  latitude: number | string;
  longitude: number | string;
  current_status: string;
  condition_status: string;
  is_active: number;
  purok_id: number;
  purok_name: string;
  barangay_id?: number | null;
  barangay_name?: string | null;
  last_inspected_at?: string | null;
  is_scheduled_today?: number | boolean;
  schedule_day?: string | null;
  schedule_start_time?: string | null;
  schedule_end_time?: string | null;
  schedule_notes?: string | null;
};

type BinFilter = "all" | "needs_collection" | "full" | "overflowing" | "scheduled_today";

const BIN_FILTERS: { value: BinFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_collection", label: "Needs Collection" },
  { value: "full", label: "Full" },
  { value: "overflowing", label: "Overflowing" },
  { value: "scheduled_today", label: "Scheduled Today" },
];

function normalizedStatus(bin: GarbageBin): string {
  const status = String(bin.current_status || "empty").toLowerCase().replaceAll("-", "_");
  return status === "overflow" ? "overflowing" : status;
}

function needsCollection(bin: GarbageBin): boolean {
  return Number(bin.is_active) === 1 && (
    ["full", "overflowing"].includes(normalizedStatus(bin)) || Number(bin.is_scheduled_today) === 1
  );
}

function matchesBinFilter(bin: GarbageBin, filter: BinFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_collection") return needsCollection(bin);
  if (Number(bin.is_active) !== 1) return false;
  return filter === "scheduled_today"
    ? Number(bin.is_scheduled_today) === 1
    : normalizedStatus(bin) === filter;
}

function binPriority(bin: GarbageBin): number {
  if (Number(bin.is_active) !== 1) return 5;
  if (normalizedStatus(bin) === "overflowing") return 0;
  if (normalizedStatus(bin) === "full") return 1;
  if (Number(bin.is_scheduled_today) === 1) return 2;
  return 3;
}

function binStatusLabel(bin: GarbageBin): string {
  return Number(bin.is_active) === 1 ? normalizedStatus(bin).replaceAll("_", " ") : "Inactive";
}

function binStatusClass(bin: GarbageBin): string {
  if (Number(bin.is_active) !== 1) return "bg-slate-100 text-slate-600";
  if (normalizedStatus(bin) === "overflowing") return "bg-rose-100 text-rose-800";
  if (normalizedStatus(bin) === "full") return "bg-amber-100 text-amber-800";
  return "bg-emerald-50 text-emerald-800";
}

function binMarkerIcon(bin: GarbageBin, selected: boolean): L.DivIcon {
  const color = Number(bin.is_active) !== 1 ? "#64748b"
    : normalizedStatus(bin) === "overflowing" ? "#e11d48"
    : normalizedStatus(bin) === "full" ? "#d97706" : "#047857";
  return L.divIcon({
    className: "municipal-bin-marker",
    html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 0 0 ${selected ? "4px #0f172a" : "1px rgba(15,23,42,.3)"};color:white"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

// Use an inline DivIcon for newly selected/draggable locations so the map
// never depends on Leaflet's default PNG marker asset paths after deployment.
const editableLocationMarkerIcon = L.divIcon({
  className: "editable-location-marker",
  html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#059669;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(15,23,42,.35)"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.3" style="transform:rotate(45deg)"><circle cx="12" cy="11" r="3"/><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/></svg></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

function formatBinTime(value?: string | null): string {
  if (!value) return "";
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function inspectionDate(value?: string | null): string {
  if (!value) return "No inspection recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function collectionTimeLabel(bin: GarbageBin): string {
  if (Number(bin.is_scheduled_today) !== 1) return "No collection scheduled today";
  const start = formatBinTime(bin.schedule_start_time);
  const end = formatBinTime(bin.schedule_end_time);
  if (start && end) return `${start} – ${end}`;
  if (start) return `${start} onward`;
  if (end) return `Until ${end}`;
  return "Scheduled; time not specified";
}

type BinForm = {
  photo: string;
  id: number;
  binCode: string;
  locationName: string;
  latitude: string;
  longitude: string;
  purokId: string;
};

type CurrentUserProfile = {
  id: number;
  role: string;
  barangay_id?: number | null;
  barangay_name?: string | null;
  purok_id?: number | null;
  purok_name?: string | null;
};

type PurokOption = {
  id: number;
  barangay_id: number;
  name: string;
  barangay_name?: string | null;
};

const emptyForm: BinForm = {
  photo: "",
  id: 0,
  binCode: "",
  locationName: "",
  latitude: "",
  longitude: "",
  purokId: "",
};

const DEFAULT_MAP_CENTER: L.LatLngExpression = [
  10.2525,
  123.9494,
];

function hasValidCoordinates(
  bin: GarbageBin,
): boolean {
  if (
    bin.latitude === null ||
    bin.latitude === undefined ||
    bin.latitude === "" ||
    bin.longitude === null ||
    bin.longitude === undefined ||
    bin.longitude === ""
  ) {
    return false;
  }

  const latitude = Number(bin.latitude);
  const longitude = Number(bin.longitude);

  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
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

export default function ManageGarbageBins() {
  const { userRole } = useAppState();

  const isBarangayCaptain = userRole === "admin";
  const isPurokLeader = userRole === "leader";
  const isSuperAdmin = userRole === "super_admin";

  // Barangay Captains may register new bins in a purok within
  // their own barangay. Purok Leaders may add and maintain bins
  // only inside their assigned purok.
  const canAddBins = isBarangayCaptain || isPurokLeader;
  const canEditBins = isPurokLeader;
  const canDeactivateBins = isPurokLeader;

  const canViewCollectorMonitoring =
    isBarangayCaptain ||
    isSuperAdmin ||
    isPurokLeader;

  const mapContainerRef =
    useRef<HTMLDivElement | null>(null);

  const mapRef =
    useRef<L.Map | null>(null);

  const binMarkersRef =
    useRef<L.LayerGroup | null>(null);

  const selectedMarkerRef =
    useRef<L.Marker | null>(null);
  const markersByIdRef = useRef(new Map<number, L.Marker>());

  const [bins, setBins] =
    useState<GarbageBin[]>([]);
  const [binFilter, setBinFilter] = useState<BinFilter>("all");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBinId, setSelectedBinId] = useState<number | null>(null);
  const [pendingDeactivateId, setPendingDeactivateId] = useState<number | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [binPage, setBinPage] = useState(1);
  const [binPageSize, setBinPageSize] = useState(DEFAULT_PAGE_SIZE);

  const activeBins = useMemo(
    () => bins.filter((bin) => Number(bin.is_active) === 1),
    [bins],
  );

  const scopedBins = useMemo(() => activeBins.filter(bin => {
    if (!isSuperAdmin) return true;
    const matchesBarangay = !barangayFilter || String(bin.barangay_id) === barangayFilter;
    const query = search.trim().toLowerCase();
    return matchesBarangay && (!query || [bin.bin_code, bin.location_name, bin.purok_name, bin.barangay_name]
      .some(value => value?.toLowerCase().includes(query)));
  }), [activeBins, isSuperAdmin, barangayFilter, search]);

  const visibleBins = useMemo(() => isSuperAdmin
    ? scopedBins.filter(bin => matchesBinFilter(bin, binFilter))
      .sort((left, right) => binPriority(left) - binPriority(right) || left.bin_code.localeCompare(right.bin_code))
    : activeBins, [activeBins, scopedBins, binFilter, isSuperAdmin]);

  const barangayOptions = useMemo(() => Array.from(new Map(activeBins
    .filter(bin => bin.barangay_id != null)
    .map(bin => [String(bin.barangay_id), bin.barangay_name || `Barangay ${bin.barangay_id}`])).entries())
    .sort((left, right) => left[1].localeCompare(right[1])), [activeBins]);
  const binPageCount = Math.max(1, Math.ceil(visibleBins.length / binPageSize));
  const safeBinPage = Math.min(binPage, binPageCount);
  const paginatedBins = useMemo(() => visibleBins.slice(
    (safeBinPage - 1) * binPageSize,
    safeBinPage * binPageSize,
  ), [visibleBins, safeBinPage, binPageSize]);
  const selectedBin = visibleBins.find(bin => bin.id === selectedBinId) || null;
  const mappedBinCount = visibleBins.filter(hasValidCoordinates).length;

  useEffect(() => {
    if (binPage > binPageCount) setBinPage(binPageCount);
  }, [binPage, binPageCount]);

  useEffect(() => {
    setBinPage(1);
  }, [binFilter, barangayFilter, search]);

  const focusBin = (bin: GarbageBin) => {
    setSelectedBinId(bin.id);
    const binIndex = visibleBins.findIndex((item) => item.id === bin.id);
    if (binIndex >= 0) {
      setBinPage(Math.floor(binIndex / binPageSize) + 1);
    }
    if (hasValidCoordinates(bin)) {
      mapRef.current?.flyTo([Number(bin.latitude), Number(bin.longitude)], 18, { animate: false });
      markersByIdRef.current.get(bin.id)?.openPopup();
    } else {
      mapRef.current?.closePopup();
    }
  };

  const [currentUser, setCurrentUser] =
    useState<CurrentUserProfile | null>(null);

  const [puroks, setPuroks] =
    useState<PurokOption[]>([]);

  const [form, setForm] =
    useState<BinForm>(emptyForm);
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoRequest = useRef(0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const uploadPhoto = async (file?: File) => {
    if (!file) return;
    const request = ++photoRequest.current;
    setPhotoLoading(true);
    setErrorMessage("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) {
        throw new Error("Choose a JPEG, PNG or WebP photo smaller than 10 MB.");
      }
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) { bitmap.close(); throw new Error("Unable to prepare the photo."); }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const photo = canvas.toDataURL("image/jpeg", 0.75);
      if (!isBinPhoto(photo)) throw new Error(`Please choose a simpler or smaller photo (saved limit: ${MAX_BIN_PHOTO_BYTES / 1000} KB).`);
      if (request === photoRequest.current) setForm(previous => ({ ...previous, photo }));
    } catch (error) {
      if (request === photoRequest.current) setErrorMessage(error instanceof Error ? error.message : "Unable to read this photo.");
    } finally {
      if (request === photoRequest.current) setPhotoLoading(false);
    }
  };

  const [showForm, setShowForm] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [successMessage, setSuccessMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [adminView, setAdminView] =
    useState<"bins" | "tracking">(
      canViewCollectorMonitoring && !isSuperAdmin
        ? "tracking"
        : "bins",
    );

  const assignedBarangay = isSuperAdmin
    ? "All Barangays"
    : currentUser?.barangay_name ||
      bins.find((bin) => bin.barangay_name)
        ?.barangay_name ||
      "Assigned automatically";

  const assignedPurok = isSuperAdmin
    ? "All Puroks"
    : isBarangayCaptain
      ? "Select a Purok when adding a bin"
      : currentUser?.purok_name ||
        bins.find((bin) => bin.purok_name)
          ?.purok_name ||
        "Assigned automatically";

  const captainPuroks =
    isBarangayCaptain && currentUser?.barangay_id
      ? puroks.filter(
          (purok) =>
            Number(purok.barangay_id) ===
            Number(currentUser.barangay_id),
        )
      : [];

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const requests: Promise<any>[] = [
        apiRequest("/api/garbage-bins"),
        apiRequest("/api/auth/me"),
      ];

      if (isBarangayCaptain) {
        requests.push(
          apiRequest("/api/auth/registration-locations"),
        );
      }

      const [binResult, profileResult, locationResult] =
        await Promise.all(requests);

      setBins(
        Array.isArray(binResult?.bins)
          ? binResult.bins
          : [],
      );

      setCurrentUser(
        profileResult?.user || null,
      );

      if (isBarangayCaptain) {
        setPuroks(
          Array.isArray(locationResult?.puroks)
            ? locationResult.puroks
            : [],
        );
      } else {
        setPuroks([]);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load garbage bins.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (
      adminView !== "bins" ||
      !mapContainerRef.current ||
      mapRef.current
    ) {
      return;
    }

    const map = L.map(
      mapContainerRef.current,
    ).setView(
      DEFAULT_MAP_CENTER,
      14,
    );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          "&copy; OpenStreetMap contributors",
      },
    ).addTo(map);

    const markerLayer =
      L.layerGroup().addTo(map);

    mapRef.current = map;
    binMarkersRef.current = markerLayer;

    map.on(
      "click",
      (event: L.LeafletMouseEvent) => {
        if (!canAddBins) {
          return;
        }

        const latitude =
          event.latlng.lat.toFixed(7);

        const longitude =
          event.latlng.lng.toFixed(7);

        setForm((previous) => ({
          ...previous,
          latitude,
          longitude,
        }));

        setShowForm(true);

        if (selectedMarkerRef.current) {
          selectedMarkerRef.current.remove();
        }

        const marker = L.marker(
          event.latlng,
          {
            draggable: true,
            icon: editableLocationMarkerIcon,
          },
        ).addTo(map);

        selectedMarkerRef.current =
          marker;

        marker.on(
          "dragend",
          (dragEvent: L.DragEndEvent) => {
            const movedMarker =
              dragEvent.target as L.Marker;

            const newPosition =
              movedMarker.getLatLng();

            setForm((previous) => ({
              ...previous,
              latitude:
                newPosition.lat.toFixed(7),
              longitude:
                newPosition.lng.toFixed(7),
            }));
          },
        );
      },
    );

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      binMarkersRef.current = null;
      selectedMarkerRef.current = null;
      markersByIdRef.current.clear();
    };
  }, [canAddBins, adminView]);

  useEffect(() => {
    const markerLayer =
      binMarkersRef.current;

    if (adminView !== "bins" || !markerLayer) {
      return;
    }

    markerLayer.clearLayers();
    markersByIdRef.current.clear();

    visibleBins.forEach((bin) => {
      const latitude =
        Number(bin.latitude);

      const longitude =
        Number(bin.longitude);

      if (
        !hasValidCoordinates(bin) ||
        (!isSuperAdmin && Number(bin.is_active) === 0)
      ) {
        return;
      }

      const marker = L.marker([latitude, longitude], {
        title: `${bin.bin_code}: ${binStatusLabel(bin)}`,
        alt: `Select garbage bin ${bin.bin_code}`,
        // Always use our inline icon. This avoids broken default Leaflet
        // marker PNGs in Vite/Railway for Barangay Captain/Purok Leader views.
        icon: binMarkerIcon(bin, false),
      }).addTo(markerLayer);
      markersByIdRef.current.set(bin.id, marker);

      // Render database text as text nodes, so location names cannot become popup HTML.
      const popup = document.createElement("div");
      popup.style.minWidth = "180px";
      if (isBinPhoto(bin.photo_path)) {
        const photo = document.createElement("img");
        photo.src = bin.photo_path;
        photo.alt = `Garbage bin ${bin.bin_code}`;
        photo.style.cssText = "width:100%;max-width:240px;height:140px;object-fit:cover;border-radius:10px;margin-bottom:8px";
        popup.append(photo);
      }
      const title = document.createElement("strong");
      title.textContent = bin.bin_code;
      popup.append(title);
      for (const value of [bin.location_name, [bin.barangay_name, bin.purok_name].filter(Boolean).join(" · "), `Status: ${binStatusLabel(bin)}`]) {
        const line = document.createElement("div");
        line.textContent = value;
        popup.append(line);
      }
      marker.bindPopup(popup);

      if (isSuperAdmin) {
        marker.on("click", () => focusBin(bin));
      } else if (canEditBins) {
        marker.on("click", () => {
          openEditForm(bin);
        });
      }
    });

    const activeBins = visibleBins.filter(
      (bin) =>
        (isSuperAdmin || Number(bin.is_active) === 1) &&
        hasValidCoordinates(bin),
    );

    if (!mapRef.current) {
      return;
    }

    if (activeBins.length > 0) {
      const bounds = L.latLngBounds(
        activeBins.map((bin) => [
          Number(bin.latitude),
          Number(bin.longitude),
        ]),
      );

      mapRef.current.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 17,
      });
    } else {
      mapRef.current.setView(
        DEFAULT_MAP_CENTER,
        14,
      );
    }

    const resizeTimer = window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 100);
    return () => window.clearTimeout(resizeTimer);
  }, [visibleBins, canEditBins, isSuperAdmin, adminView]);

  useEffect(() => {
    if (!isSuperAdmin || adminView !== "bins") return;
    for (const bin of visibleBins) {
      const marker = markersByIdRef.current.get(bin.id);
      marker?.setIcon(binMarkerIcon(bin, bin.id === selectedBinId));
      marker?.setZIndexOffset(bin.id === selectedBinId ? 1000 : 0);
    }
  }, [selectedBinId, visibleBins, isSuperAdmin, adminView]);

  const removeSelectedMarker = () => {
    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.remove();
      selectedMarkerRef.current = null;
    }
  };

  const resetForm = () => {
    photoRequest.current++;
    setPhotoLoading(false);
    setForm(emptyForm);
    setShowForm(false);
    removeSelectedMarker();
  };

  const attachDraggableMarker = (
    latitude: number,
    longitude: number,
  ) => {
    if (!mapRef.current) {
      return;
    }

    removeSelectedMarker();

    const marker = L.marker(
      [latitude, longitude],
      {
        draggable: true,
        icon: editableLocationMarkerIcon,
      },
    ).addTo(mapRef.current);

    selectedMarkerRef.current = marker;

    marker.on(
      "dragend",
      (dragEvent: L.DragEndEvent) => {
        const movedMarker =
          dragEvent.target as L.Marker;

        const position =
          movedMarker.getLatLng();

        setForm((previous) => ({
          ...previous,
          latitude:
            position.lat.toFixed(7),
          longitude:
            position.lng.toFixed(7),
        }));
      },
    );
  };

  const openEditForm = (
    bin: GarbageBin,
  ) => {
    if (!canEditBins) {
      return;
    }

    setSuccessMessage("");
    setErrorMessage("");
    setDeactivating(true);

    photoRequest.current++;
    setPhotoLoading(false);
    setForm({
      id: bin.id,
      photo: bin.bin_photo || "",
      binCode: bin.bin_code,
      locationName:
        bin.location_name,
      latitude:
        String(bin.latitude),
      longitude:
        String(bin.longitude),
      purokId: String(bin.purok_id || ""),
    });

    setShowForm(true);

    const latitude =
      Number(bin.latitude);

    const longitude =
      Number(bin.longitude);

    if (!hasValidCoordinates(bin)) {
      setErrorMessage(
        "This old garbage-bin record has no map coordinates yet. Click the map to assign its location.",
      );
      return;
    }

    mapRef.current?.setView(
      [latitude, longitude],
      18,
    );

    attachDraggableMarker(
      latitude,
      longitude,
    );
  };

  const handleSubmit = async (
    event: FormEvent,
  ) => {
    event.preventDefault();
    if (photoLoading) return;

    if (form.id ? !canEditBins : !canAddBins) {
      setErrorMessage(
        form.id
          ? "Only the assigned Purok Leader can edit this garbage bin."
          : "Your account cannot register garbage bins.",
      );
      return;
    }

    if (
      isBarangayCaptain &&
      !form.id &&
      !form.purokId
    ) {
      setErrorMessage(
        "Select a purok in your barangay before saving the garbage bin.",
      );
      return;
    }

    setSaving(true);
    setSuccessMessage("");
    setErrorMessage("");

    try {
      const latitude =
        Number(form.latitude);

      const longitude =
        Number(form.longitude);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        throw new Error(
          "Click a valid location on the map.",
        );
      }

      const payload = {
        photo_path: form.photo || null,
        bin_code:
          form.binCode.trim(),
        location_name:
          form.locationName.trim(),
        latitude,
        longitude,
        ...(isBarangayCaptain && !form.id
          ? { purok_id: Number(form.purokId) }
          : {}),
      };

      const url = form.id
        ? `/api/garbage-bins/${form.id}`
        : "/api/garbage-bins";

      const method = form.id
        ? "PUT"
        : "POST";

      const result =
        await apiRequest(url, {
          method,
          body: JSON.stringify(payload),
        });

      setSuccessMessage(
        result.message ||
          "Garbage bin saved successfully.",
      );

      resetForm();
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save garbage bin.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (
    binId: number,
  ) => {
    if (!canDeactivateBins) {
      setErrorMessage(
        "Only the assigned Purok Leader can deactivate this garbage bin.",
      );
      return;
    }

    setSuccessMessage("");
    setErrorMessage("");

    try {
      const result =
        await apiRequest(
          `/api/garbage-bins/${binId}`,
          { method: "DELETE" },
        );

      setSuccessMessage(
        result.message ||
          "Garbage bin deactivated.",
      );

      resetForm();
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to deactivate garbage bin.",
      );
    } finally {
      setDeactivating(false);
      setPendingDeactivateId(null);
    }
  };

  return (
    <div className="space-y-5">
      {canViewCollectorMonitoring && (
        <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
          <button
            type="button"
            aria-pressed={adminView === "bins"}
            onClick={() => setAdminView("bins")}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              adminView === "bins"
                ? "bg-emerald-700 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Garbage Bin Map
          </button>

          <button
            type="button"
            aria-pressed={adminView === "tracking"}
            onClick={() => setAdminView("tracking")}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              adminView === "tracking"
                ? "bg-emerald-700 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Collector Monitoring
          </button>
        </div>
      )}

      {canViewCollectorMonitoring &&
      adminView === "tracking" ? (
        <MapView viewOnly />
      ) : (
        <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            {isSuperAdmin ? "Municipal Bins" : "Garbage Bin Locations"}
          </h1>

          <p className="text-sm text-slate-500">
            {isSuperAdmin
              ? "Monitor bins across all barangays. Select a map marker or a bin in the list to see its details."
              : isBarangayCaptain
              ? "Register garbage-bin locations within your assigned barangay and choose the correct purok."
              : "Click the map to register the exact garbage-bin location in your assigned purok."}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "opacity-60" : ""}`}
            />
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {canAddBins && (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              Add Bin
            </button>
          )}
        </div>
      </div>

      {isSuperAdmin ? (
        <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
            <label className="block text-xs font-bold text-slate-600">
              Search bins
              <div className="relative mt-1">
                <Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input type="search" value={search} placeholder="Bin code, location or purok"
                  onChange={event => { setSearch(event.target.value); setSelectedBinId(null); }}
                  className="w-full rounded-xl border bg-white py-2.5 pl-9 pr-3 text-sm font-normal" />
              </div>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Barangay
              <select value={barangayFilter} onChange={event => { setBarangayFilter(event.target.value); setSelectedBinId(null); }}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-normal">
                <option value="">All barangays</option>
                {barangayOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter bins by collection status">
            {BIN_FILTERS.map(filter => (
              <button key={filter.value} type="button" aria-pressed={binFilter === filter.value}
                onClick={() => { setBinFilter(filter.value); setSelectedBinId(null); }}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${binFilter === filter.value
                  ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {filter.label} <span className="ml-1 opacity-75">{loading ? "…" : scopedBins.filter(bin => matchesBinFilter(bin, filter.value)).length}</span>
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Needs Collection includes active bins that are full, overflowing, or scheduled today. Overflowing and full bins appear first.
          </p>
        </div>
      ) : <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">
            Assigned Barangay
          </p>
          <p className="mt-1 font-black text-slate-900">
            {assignedBarangay}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">
            Assigned Purok
          </p>
          <p className="mt-1 font-black text-slate-900">
            {assignedPurok}
          </p>
        </div>
      </div>}

      {successMessage && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          {isSuperAdmin && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs text-slate-500">
              <span aria-live="polite">{loading ? "Loading bin locations..." : `${mappedBinCount} of ${visibleBins.length} matching bins have coordinates`}</span>
              <span className="flex gap-3"><span className="text-rose-700">● Overflowing</span><span className="text-amber-700">● Full</span></span>
            </div>
          )}
          <div
            ref={mapContainerRef}
            role="region"
            aria-label="Garbage bin locations map; bins can also be selected from the list below"
            className="relative z-0 h-[360px] w-full sm:h-[520px]"
          />
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm" aria-label={isSuperAdmin ? "Selected bin details" : undefined}>
          {isSuperAdmin ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-black text-slate-900">Bin Details</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">View only</span>
              </div>
              {selectedBin ? (
                <div className="space-y-4" aria-live="polite">
                  {isBinPhoto(selectedBin.photo_path) && <img src={selectedBin.photo_path} alt={`Garbage bin ${selectedBin.bin_code}`} className="h-40 w-full rounded-xl object-cover" />}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xl font-black text-slate-900">{selectedBin.bin_code}</h3>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${binStatusClass(selectedBin)}`}>{binStatusLabel(selectedBin)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{selectedBin.location_name || "Location description unavailable"}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div><dt className="text-xs text-slate-500">Barangay</dt><dd className="mt-1 font-semibold text-slate-800">{selectedBin.barangay_name || "Not assigned"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Purok</dt><dd className="mt-1 font-semibold text-slate-800">{selectedBin.purok_name || "Not assigned"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Condition</dt><dd className="mt-1 font-semibold capitalize text-slate-800">{selectedBin.condition_status?.replaceAll("_", " ") || "Not recorded"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Last inspected</dt><dd className="mt-1 font-semibold text-slate-800">{inspectionDate(selectedBin.last_inspected_at)}</dd></div>
                  </dl>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold text-slate-500">Barangay collection today</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{collectionTimeLabel(selectedBin)}</p>
                    {selectedBin.schedule_notes && <p className="mt-2 text-xs text-slate-500">{selectedBin.schedule_notes}</p>}
                  </div>
                  {hasValidCoordinates(selectedBin) ? (
                    <button type="button" onClick={() => focusBin(selectedBin)} className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50">
                      <MapPin className="h-4 w-4" /> Focus on map
                    </button>
                  ) : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">This bin has no valid coordinates. Its record is available in the list.</p>}
                </div>
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center text-center">
                  <MapPin className="mb-3 h-10 w-10 text-emerald-700" />
                  <h3 className="font-bold text-slate-900">{loading ? "Loading bins..." : "Select a bin to inspect"}</h3>
                  <p className="mt-2 max-w-xs text-sm text-slate-500">Choose a marker on the map or a bin from the list to view its status, location and collection schedule.</p>
                </div>
              )}
              <p className="border-t pt-3 text-xs leading-relaxed text-slate-500">Municipal Administrators monitor bins. Barangay Captains can register bins in their barangay; assigned Purok Leaders maintain their bins.</p>
            </div>
          ) : !canAddBins ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
              <MapPin className="mb-3 h-10 w-10 text-emerald-700" />

              <h2 className="font-black text-slate-900">
                View-only Garbage Bin Map
              </h2>

              <p className="mt-2 max-w-xs text-sm text-slate-500">
                Municipal Administrators have view-only access.
                Barangay Captains can register bins within their own barangay, while assigned Purok Leaders can maintain bins in their purok.
              </p>
            </div>
          ) : !showForm ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
              <MapPin className="mb-3 h-10 w-10 text-emerald-700" />

              <h2 className="font-black text-slate-900">
                Click a location on the map
              </h2>

              <p className="mt-2 max-w-xs text-sm text-slate-500">
                {isBarangayCaptain
                  ? "Choose the correct purok, then click the map to capture the garbage-bin coordinates."
                  : "The coordinates will be captured automatically and assigned to your purok."}
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-black text-slate-900">
                  {form.id
                    ? "Edit Garbage Bin"
                    : "Add Garbage Bin"}
                </h2>

                <button
                  type="button"
                  onClick={resetForm}
                  aria-label="Close form"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500">
                  Area assignment
                </p>
                <p className="mt-1 text-sm font-black text-slate-900">
                  {assignedBarangay}
                  {!isBarangayCaptain
                    ? ` — ${assignedPurok}`
                    : ""}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isBarangayCaptain
                    ? "You can assign a new bin only to a purok inside your barangay."
                    : "This is controlled by your Purok Leader account."}
                </p>
              </div>

              {isBarangayCaptain && !form.id && (
                <label className="block text-xs font-bold text-slate-700">
                  Assigned Purok
                  <select
                    required
                    value={form.purokId}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        purokId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="">
                      Select a purok
                    </option>
                    {captainPuroks.map((purok) => (
                      <option
                        key={purok.id}
                        value={purok.id}
                      >
                        {purok.name}
                      </option>
                    ))}
                  </select>

                  {captainPuroks.length === 0 && (
                    <span className="mt-1 block text-xs font-semibold text-amber-600">
                      No puroks are available for your assigned barangay.
                    </span>
                  )}
                </label>
              )}

              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">Bin photo</p>
                  <span className="text-xs text-slate-500">Optional</span>
                </div>
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={photoLoading || saving}
                  aria-label="Choose a garbage bin photo" hidden
                  onChange={event => { void uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} />
                {form.photo ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <img src={form.photo} alt="Garbage bin preview" className="h-44 w-full object-cover" />
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <button type="button" disabled={photoLoading || saving} onClick={() => photoInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50">
                        <Upload className="h-4 w-4" />Change photo
                      </button>
                      <button type="button" disabled={photoLoading || saving} onClick={() => setForm(previous => ({ ...previous, photo: "" }))}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" disabled={photoLoading || saving} onClick={() => photoInputRef.current?.click()}
                    className="group flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-60">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ImagePlus className="h-5 w-5" /></span>
                    <span className="text-sm font-bold text-slate-900">Choose a bin photo</span>
                    <span className="text-xs text-slate-500">JPG, PNG or WebP · Up to 10 MB</span>
                  </button>
                )}
                <p aria-live="polite" className="text-xs leading-relaxed text-slate-500">
                  {photoLoading ? "Preparing your photo..." : "Appears in the map popup when this bin is selected."}
                </p>
              </div>
              <label className="block text-xs font-bold text-slate-700">
                Bin Code
                <input
                  required
                  value={form.binCode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      binCode:
                        event.target.value,
                    })
                  }
                  placeholder="BIN-P1-001"
                  className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
                />
              </label>

              <label className="block text-xs font-bold text-slate-700">
                Location Description
                <input
                  required
                  value={
                    form.locationName
                  }
                  onChange={(event) =>
                    setForm({
                      ...form,
                      locationName:
                        event.target.value,
                    })
                  }
                  placeholder="Near the covered court"
                  className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Latitude
                  <input
                    required
                    readOnly
                    value={form.latitude}
                    className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2.5 text-sm"
                  />
                </label>

                <label className="block text-xs font-bold text-slate-700">
                  Longitude
                  <input
                    required
                    readOnly
                    value={
                      form.longitude
                    }
                    className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2.5 text-sm"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={saving || photoLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />

                {saving
                  ? "Saving..."
                  : form.id
                    ? "Save Changes"
                    : "Save Garbage Bin"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-black text-slate-900">
            {isSuperAdmin
              ? "Active Garbage Bins"
              : isBarangayCaptain
                ? "Garbage Bins in My Barangay"
                : "Garbage Bins in My Purok"}
          </h2>
          {isSuperAdmin && <p className="mt-1 text-xs text-slate-500" aria-live="polite">{loading ? "Loading records..." : `${visibleBins.length} active bins shown`}. Select a bin to view details and focus its marker.</p>}
        </div>

        <div className="sg-desktop-table overflow-hidden">
          <table aria-busy={loading} className="w-full table-fixed text-left text-xs">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">
                  Code
                </th>
                <th className="px-3 py-3">
                  Location
                </th>
                <th className="px-3 py-3">
                  {isSuperAdmin ? "Barangay / Purok" : "Purok"}
                </th>
                <th className="hidden px-3 py-3 xl:table-cell">
                  Coordinates
                </th>
                <th className="px-3 py-3">
                  Status
                </th>
                {canEditBins && (
                  <th className="px-3 py-3">
                    Actions
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {paginatedBins.map((bin) => (
                <tr
                  key={bin.id}
                  onClick={isSuperAdmin ? () => focusBin(bin) : undefined}
                  className={`border-t transition ${isSuperAdmin ? selectedBinId === bin.id
                    ? "cursor-pointer bg-emerald-50 ring-1 ring-inset ring-emerald-300"
                    : "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <td className="truncate px-5 py-3 font-black" title={bin.bin_code}>
                    {isSuperAdmin ? <button type="button" aria-pressed={selectedBinId === bin.id}
                      title={`View details for ${bin.bin_code}`}
                      onClick={event => { event.stopPropagation(); focusBin(bin); }}
                      className="rounded text-left text-emerald-700 underline decoration-emerald-200 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600">
                      {bin.bin_code}
                    </button> : bin.bin_code}
                    {isSuperAdmin && selectedBinId === bin.id && <span className="mt-1 block text-[10px] font-bold uppercase text-emerald-700">Selected</span>}
                  </td>

                  <td className="truncate px-3 py-3" title={bin.location_name}>
                    {bin.location_name}
                  </td>

                  <td className="px-3 py-3">
                    {isSuperAdmin && <span className="block font-semibold text-slate-800">{bin.barangay_name || "Not assigned"}</span>}
                    {bin.purok_name ||
                      assignedPurok}
                  </td>

                  <td className="hidden px-3 py-3 text-xs xl:table-cell">
                    {isSuperAdmin && !hasValidCoordinates(bin) ? <span className="text-amber-700">No valid coordinates</span> : `${bin.latitude}, ${bin.longitude}`}
                  </td>

                  <td className="px-3 py-3 capitalize">
                    <span className={isSuperAdmin ? `inline-block rounded-full px-2.5 py-1 text-xs font-bold ${binStatusClass(bin)}` : ""}>{binStatusLabel(bin)}</span>
                    {isSuperAdmin && Number(bin.is_active) === 1 && Number(bin.is_scheduled_today) === 1 && <span className="mt-1 block text-xs text-emerald-700">Scheduled today</span>}
                  </td>

                  {canEditBins && (
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            openEditForm(bin)
                          }
                          className="rounded-lg border p-2"
                          title="Edit garbage bin"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>

                        {Number(
                          bin.is_active,
                        ) === 1 && (
                          <button
                            type="button"
                            onClick={() => setPendingDeactivateId(bin.id)}
                            className="rounded-lg border p-2 text-rose-600"
                            title="Deactivate garbage bin"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {!loading &&
                visibleBins.length === 0 && (
                  <tr>
                    <td
                      colSpan={canEditBins ? 6 : 5}
                      className="p-8 text-center text-slate-500"
                    >
                      {errorMessage ? "Bins could not be loaded. Use Refresh to try again."
                        : isSuperAdmin ? (bins.length === 0 ? "No garbage bins have been registered yet."
                          : binFilter === "needs_collection" ? "No bins currently require collection for these filters."
                          : "No bins match these filters. Try another status, barangay or search.")
                        : isBarangayCaptain
                        ? "No garbage bins found in your assigned barangay. Use Add Bin to register the first one."
                        : "No garbage bins found in your assigned purok. Click the map to add the first one."}
                      {isSuperAdmin && !errorMessage && (binFilter !== "all" || barangayFilter || search) && <button type="button"
                        onClick={() => { setBinFilter("all"); setBarangayFilter(""); setSearch(""); setSelectedBinId(null); }}
                        className="mx-auto mt-3 block rounded-lg border px-4 py-2 text-sm font-bold text-emerald-700">Clear filters</button>}
                    </td>
                  </tr>
                )}

              {loading && (
                <tr>
                  <td
                    colSpan={canEditBins ? 6 : 5}
                    className="p-8 text-center text-slate-500"
                  >
                    Loading garbage bins...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="sg-mobile-list-card space-y-2 p-3">
          {!loading && paginatedBins.map((bin) => (
            <article
              key={bin.id}
              className={`rounded-xl border bg-white p-3 shadow-sm ${
                isSuperAdmin && selectedBinId === bin.id
                  ? "border-emerald-400 ring-1 ring-emerald-200"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-black text-slate-800">{bin.bin_code}</p>
                  <p className="mt-1 truncate text-sm font-bold text-slate-900">{bin.location_name}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{[bin.barangay_name, bin.purok_name || assignedPurok].filter(Boolean).join(" / ") || "Area not recorded"}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${binStatusClass(bin)}`}>{binStatusLabel(bin)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                <span className={Number(bin.is_scheduled_today) === 1 ? "font-semibold text-emerald-700" : "text-slate-500"}>{collectionTimeLabel(bin)}</span>
                <div className="flex items-center gap-1">
                  {isSuperAdmin && <button type="button" onClick={() => focusBin(bin)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-emerald-700" title={`View details for ${bin.bin_code}`}>Details</button>}
                  {canEditBins && <button type="button" onClick={() => openEditForm(bin)} className="rounded-lg border border-slate-200 p-1.5 text-slate-700" title="Edit garbage bin" aria-label={`Edit ${bin.bin_code}`}><Pencil className="h-4 w-4" /></button>}
                  {canEditBins && Number(bin.is_active) === 1 && <button type="button" onClick={() => setPendingDeactivateId(bin.id)} className="rounded-lg border border-rose-100 p-1.5 text-rose-600" title="Deactivate garbage bin" aria-label={`Deactivate ${bin.bin_code}`}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            </article>
          ))}
          {!loading && visibleBins.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">{errorMessage ? "Bins could not be loaded. Use Refresh to try again." : "No garbage bins match the current filters."}</p>}
          {loading && <p className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-500">Loading garbage bins...</p>}
        </div>
        {!loading && visibleBins.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination
              page={safeBinPage}
              pageSize={binPageSize}
              totalItems={visibleBins.length}
              onPageChange={setBinPage}
              onPageSizeChange={(pageSize) => {
                setBinPageSize(pageSize);
                setBinPage(1);
              }}
              compact
              itemLabel="garbage bins"
            />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={pendingDeactivateId !== null}
        title="Deactivate this garbage bin?"
        description="The bin will no longer be active for collection. Its recorded location and history will remain available."
        confirmLabel="Deactivate Bin"
        cancelLabel="Keep Active"
        destructive
        busy={deactivating}
        onCancel={() => setPendingDeactivateId(null)}
        onConfirm={() => {
          if (pendingDeactivateId !== null) void handleDeactivate(pendingDeactivateId);
        }}
      />
    </div>
      )}
    </div>
  );
}
