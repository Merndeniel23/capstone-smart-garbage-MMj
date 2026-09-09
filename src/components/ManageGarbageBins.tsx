import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAppState } from "../context/AppStateContext";
import MapView from "./MapView";
import { isBinPhoto, MAX_BIN_PHOTO_BYTES } from "../../shared/binPhotos";

import {
  MapPin,
  ImagePlus,
  Upload,
  Pencil,
  Plus,
  RefreshCw,
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
};

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

  const isAdminView = isBarangayCaptain || isSuperAdmin;
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

  const [bins, setBins] =
    useState<GarbageBin[]>([]);

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
      canViewCollectorMonitoring
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
          { draggable: true },
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

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [canAddBins, adminView]);

  useEffect(() => {
    const markerLayer =
      binMarkersRef.current;

    if (!markerLayer) {
      return;
    }

    markerLayer.clearLayers();

    bins.forEach((bin) => {
      const latitude =
        Number(bin.latitude);

      const longitude =
        Number(bin.longitude);

      if (
        !hasValidCoordinates(bin) ||
        Number(bin.is_active) === 0
      ) {
        return;
      }

      const marker = L.marker([
        latitude,
        longitude,
      ]).addTo(markerLayer);

      marker.bindPopup(`
        <div style="min-width: 180px;">
          ${isBinPhoto(bin.photo_path) ? `<img src="${bin.photo_path}" alt="Garbage bin" style="width:100%;max-width:240px;height:140px;object-fit:cover;border-radius:10px;margin-bottom:8px" />` : ""}
          <strong>${bin.bin_code}</strong>
          <br />
          ${bin.location_name}
          <br />
          ${bin.purok_name || "Assigned purok"}
          <br />
          Status:
          ${String(
            bin.current_status || "empty",
          ).replaceAll("_", " ")}
        </div>
      `);

      if (canEditBins) {
        marker.on("click", () => {
          openEditForm(bin);
        });
      }
    });

    const activeBins = bins.filter(
      (bin) =>
        Number(bin.is_active) === 1 &&
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

    window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 100);
  }, [bins, canEditBins]);

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
      { draggable: true },
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

    const confirmed =
      window.confirm(
        "Deactivate this garbage bin?",
      );

    if (!confirmed) {
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
    }
  };

  return (
    <div className="space-y-5">
      {canViewCollectorMonitoring && (
        <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
          <button
            type="button"
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
            Garbage Bin Locations
          </h1>

          <p className="text-sm text-slate-500">
            {isBarangayCaptain
              ? "Register garbage-bin locations within your assigned barangay and choose the correct purok."
              : "Click the map to register the exact garbage-bin location in your assigned purok."}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadData}
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
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

      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div
            ref={mapContainerRef}
            className="h-[520px] w-full"
          />
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          {!canAddBins ? (
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
              ? "All Registered Garbage Bins"
              : isBarangayCaptain
                ? "Garbage Bins in My Barangay"
                : "Garbage Bins in My Purok"}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">
                  Code
                </th>
                <th className="px-3 py-3">
                  Location
                </th>
                <th className="px-3 py-3">
                  Purok
                </th>
                <th className="px-3 py-3">
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
              {bins.map((bin) => (
                <tr
                  key={bin.id}
                  className="border-t"
                >
                  <td className="px-5 py-3 font-black">
                    {bin.bin_code}
                  </td>

                  <td className="px-3 py-3">
                    {bin.location_name}
                  </td>

                  <td className="px-3 py-3">
                    {bin.purok_name ||
                      assignedPurok}
                  </td>

                  <td className="px-3 py-3 text-xs">
                    {bin.latitude},{" "}
                    {bin.longitude}
                  </td>

                  <td className="px-3 py-3 capitalize">
                    {Number(
                      bin.is_active,
                    ) === 1
                      ? String(
                          bin.current_status ||
                            "empty",
                        ).replaceAll(
                          "_",
                          " ",
                        )
                      : "Inactive"}
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
                            onClick={() =>
                              handleDeactivate(
                                bin.id,
                              )
                            }
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
                bins.length === 0 && (
                  <tr>
                    <td
                      colSpan={canEditBins ? 6 : 5}
                      className="p-8 text-center text-slate-500"
                    >
                      {isBarangayCaptain
                        ? "No garbage bins found in your assigned barangay. Use Add Bin to register the first one."
                        : "No garbage bins found in your assigned purok. Click the map to add the first one."}
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
      </div>
        </div>
      )}
    </div>
  );
}
