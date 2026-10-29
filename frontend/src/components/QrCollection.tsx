import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, Check, CheckCircle2, ImageUp, QrCode, X, XCircle } from "lucide-react";
import { apiRequest } from "../services/api";
import { notifyAdminActionCountsChanged } from "../hooks/useAdminActionCounts";

type HouseholdBin = {
  bin_id: number;
  resident_id: number;
  full_name: string;
  bin_code: string;
  purok_name: string;
  collection_suspended_until: string | null;
  scanned_today: string | null;
};
type IdentifiedBin = Readonly<{ payload: string; bin: Readonly<HouseholdBin>; key: string }>;
type Segregation = "segregated" | "not_segregated";

function isLikelyMobileDevice(): boolean {
  const navigatorWithHints = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };

  return (
    navigatorWithHints.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  );
}

function stopMediaStream(activeStream: MediaStream | null): void {
  activeStream?.getTracks().forEach((track) => track.stop());
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Camera access was denied. Allow camera permission for this site in your browser settings and try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device. Connect or enable a camera, or use Scan QR Image instead.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "The camera is already in use or unavailable. Close other apps or browser tabs using it, then try again.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "No available camera matches the requested settings. Enable another camera or use Scan QR Image instead.";
  }

  return "Unable to start the camera. Check the browser camera permission and try again, or use Scan QR Image instead.";
}

async function requestAvailableCamera(): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  const mobile = isLikelyMobileDevice();
  const preferredVideo: MediaTrackConstraints | boolean = mobile
    ? { facingMode: { ideal: "environment" } }
    : true;

  try {
    return await mediaDevices.getUserMedia({
      audio: false,
      video: preferredVideo,
    });
  } catch (preferredError) {
    const errorName =
      preferredError instanceof DOMException ? preferredError.name : "";
    let lastCameraError = preferredError;

    // Do not repeat a camera request after the user or browser denied access.
    if (
      ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
        errorName,
      )
    ) {
      throw preferredError;
    }

    // A preferred rear camera or the system-default webcam can be busy while
    // another camera remains available. Try each discovered camera explicitly.
    let cameras: MediaDeviceInfo[] = [];
    try {
      cameras = (await mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput" && Boolean(device.deviceId),
      );
    } catch {
      // The generic fallback below can still succeed when enumeration is hidden.
    }

    if (mobile) {
      cameras.sort((left, right) => {
        const rearCameraPattern = /back|rear|environment/i;
        return (
          Number(rearCameraPattern.test(right.label)) -
          Number(rearCameraPattern.test(left.label))
        );
      });
    }

    for (const camera of cameras) {
      try {
        return await mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: camera.deviceId } },
        });
      } catch (candidateError) {
        lastCameraError = candidateError;
        const candidateErrorName =
          candidateError instanceof DOMException ? candidateError.name : "";
        if (
          [
            "NotAllowedError",
            "PermissionDeniedError",
            "SecurityError",
          ].includes(candidateErrorName)
        ) {
          throw candidateError;
        }
      }
    }

    if (mobile) {
      try {
        return await mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (fallbackError) {
        lastCameraError = fallbackError;
      }
    }

    throw lastCameraError;
  }
}

// Collector goes straight to the purok, opens the QR Scanner Modal, scans each household QR,
// and marks Check (✓ Segregated) or X (✗ Not Segregated). The result goes directly to the
// Purok Leader's Purok Members / Activity Log for Warning, Fine, or Suspension decisions.
export default function QrCollection({
  onSaved,
  defaultOpen = false,
}: {
  onSaved: () => void;
  defaultOpen?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(defaultOpen);
  const [identified, setIdentified] = useState<IdentifiedBin | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("info");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const submitting = useRef(false);
  const identifiedRef = useRef<IdentifiedBin | null>(null);
  const qrRef = useRef("");
  const lookupVersion = useRef(0);
  const lookup = useRef<AbortController | null>(null);

  function openScannerModal() {
    setModalOpen(true);
  }

  function resetScan(keepMessage = false) {
    if (submitting.current) return;
    lookupVersion.current++;
    lookup.current?.abort();
    lookup.current = null;
    identifiedRef.current = null;
    setIdentified(null);
    qrRef.current = "";
    setBusy(false);
    if (!keepMessage) setMessage("");
    setCamera(false);
  }

  function stopCamera() {
    setCamera(false);
    setCameraStarting(false);
    stopMediaStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  function startCamera() {
    if (busy || cameraStarting) return;
    resetScan();
    setMessageTone("info");
    setMessage("Requesting camera access...");
    setCamera(true);
  }

  function closeModal() {
    if (submitting.current) return;
    if (cameraStarting) setMessage("");
    stopCamera();
    setModalOpen(false);
  }

  useEffect(() => {
    return () => {
      lookupVersion.current++;
      lookup.current?.abort();
      identifiedRef.current = null;
      stopMediaStream(stream.current);
      stream.current = null;
    };
  }, []);

  useEffect(() => {
    if (!camera || !modalOpen) return;
    let cancelled = false;
    let timer: number | undefined;
    let activeStream: MediaStream | null = null;
    const Detector = (window as any).BarcodeDetector;
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setMessageTone("error");
      setMessage(
        "Camera access requires HTTPS or localhost and a supported browser. Use Scan QR Image instead.",
      );
      setCamera(false);
      return;
    }
    if (!Detector) {
      setMessageTone("error");
      setMessage(
        "Automatic QR camera scanning is not supported by this browser. Use a current Chrome or Edge browser, or use Scan QR Image instead.",
      );
      setCamera(false);
      return;
    }
    setCameraStarting(true);
    void (async () => {
      try {
        const feed = await requestAvailableCamera();
        if (cancelled) {
          stopMediaStream(feed);
          return;
        }
        activeStream = feed;
        stream.current = feed;
        if (video.current) {
          video.current.srcObject = feed;
          await video.current.play();
        }
        if (cancelled) return;
        setCameraStarting(false);
        setMessage("");
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (cancelled) return;
          try {
            if (
              video.current &&
              video.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              video.current.videoWidth > 0 &&
              video.current.videoHeight > 0
            ) {
              const results = await detector.detect(video.current);
              if (results[0]?.rawValue) {
                void identify(results[0].rawValue);
                return;
              }
            }
          } catch {
            /* Retry next frame cleanly. */
          }
          if (!cancelled) timer = window.setTimeout(() => void scan(), 260);
        };
        void scan();
      } catch (error) {
        if (!cancelled) {
          setCameraStarting(false);
          setMessageTone("error");
          setMessage(cameraErrorMessage(error));
          setCamera(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopMediaStream(activeStream);
      if (stream.current === activeStream) stream.current = null;
      if (video.current?.srcObject === activeStream) video.current.srcObject = null;
    };
  }, [camera, modalOpen]);

  async function handleQrImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setMessageTone("error");
      setMessage("QR image decoding requires a current Chrome or Edge browser.");
      return;
    }
    try {
      setBusy(true);
      const bitmap = await createImageBitmap(file);
      const detector = new Detector({ formats: ["qr_code"] });
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      if (!codes[0]?.rawValue) {
        setBusy(false);
        setMessageTone("error");
        setMessage("No QR code was detected in the selected image. Try a clearer or more tightly cropped photo.");
        return;
      }
      await identify(codes[0].rawValue);
    } catch {
      setBusy(false);
      setMessageTone("error");
      setMessage("Could not read the QR image. Try a clearer or more tightly cropped photo.");
    }
  }

  async function identify(rawPayload: string) {
    const payload = rawPayload.trim();
    if (submitting.current || !payload) return;
    const version = ++lookupVersion.current;
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    identifiedRef.current = null;
    setIdentified(null);
    qrRef.current = payload;
    setCamera(false);
    setCameraStarting(false);
    setBusy(true);
    setMessage("");
    try {
      const data = await apiRequest<{ bin: HouseholdBin }>(
        "/sgms/collections/identify",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ qrPayload: payload }),
        },
      );
      if (
        controller.signal.aborted ||
        version !== lookupVersion.current ||
        qrRef.current.trim() !== payload
      )
        return;
      if (
        !Number.isSafeInteger(data.bin?.bin_id) ||
        !Number.isSafeInteger(data.bin?.resident_id)
      )
        throw new Error("The QR lookup returned an invalid household bin.");
      const record = Object.freeze({
        payload,
        bin: Object.freeze({ ...data.bin }),
        key: crypto.randomUUID(),
      });
      identifiedRef.current = record;
      setIdentified(record);
    } catch (error) {
      if (!controller.signal.aborted && version === lookupVersion.current) {
        setMessageTone("error");
        setMessage(
          error instanceof Error ? error.message : "QR lookup failed.",
        );
      }
    } finally {
      if (version === lookupVersion.current) {
        lookup.current = null;
        setBusy(false);
      }
    }
  }

  async function save(segregation: Segregation) {
    const record = identifiedRef.current;
    if (
      !record ||
      record !== identified ||
      record.payload !== qrRef.current.trim() ||
      submitting.current
    )
      return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/sgms/collections", {
        method: "POST",
        body: JSON.stringify({
          qrPayload: record.payload,
          segregation,
          idempotencyKey: record.key,
        }),
      });
      if (identifiedRef.current === record) {
        submitting.current = false;
        resetScan(true);
        setMessageTone("success");
        setMessage(
          `${record.bin.bin_code} · ${record.bin.full_name}: ${
            segregation === "segregated"
              ? "✓ Segregated (Followed Policy)"
              : "✗ Not Segregated (Sent to Purok Leader Activity Log)"
          }. ${result.message}`,
        );
        notifyAdminActionCountsChanged();
        onSaved();
      }
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to record the scan.",
      );
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  const bin = identified?.bin;

  return (
    <section
      aria-label="Household QR collection"
      className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 p-6 text-white shadow-lg"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">
            <QrCode className="h-3.5 w-3.5" />
            Direct Purok Collection
          </span>
          <h2 className="text-2xl font-black tracking-tight">
            Scan Household Bin QR
          </h2>
          <p className="max-w-2xl text-sm text-emerald-100/90">
            Go straight to the purok, scan each household&apos;s QR code, and mark{" "}
            <span className="font-black text-emerald-300">✓ Check (Segregated)</span> or{" "}
            <span className="font-black text-rose-300">✗ X (Not Segregated)</span>. Unsegregated scans go straight to the Purok Leader&apos;s Activity Log for Warning, Fine, or Suspension.
          </p>
        </div>
        <button
          type="button"
          onClick={openScannerModal}
          className="inline-flex shrink-0 items-center justify-center gap-2.5 rounded-2xl bg-white px-6 py-4 text-sm font-black text-emerald-900 shadow-lg transition hover:bg-emerald-50"
        >
          <QrCode className="h-5 w-5 text-emerald-700" />
          Open QR Scanner
        </button>
      </div>

      {message && !modalOpen && (
        <div
          role="status"
          className={`mt-4 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${
            messageTone === "error"
              ? "border-rose-300/40 bg-rose-950/60 text-rose-100"
              : "border-emerald-300/40 bg-white/10 text-emerald-50"
          }`}
        >
          {messageTone === "error" ? (
            <XCircle className="h-4 w-4 shrink-0 text-rose-300" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
          )}
          <span>{message}</span>
        </div>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Bin Scanner Modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
          onClick={closeModal}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <QrCode className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Household QR Scanner
                  </h3>
                  <p className="text-xs font-medium text-slate-500">
                    Scan QR code then mark ✓ Segregated or ✗ Not Segregated
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                aria-label="Close QR scanner modal"
                className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Camera & Photo Scanner Controls */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy || cameraStarting}
                  onClick={() => {
                    if (camera) stopCamera();
                    else startCamera();
                  }}
                  className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black transition disabled:opacity-50 ${
                    camera
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "bg-emerald-700 text-white hover:bg-emerald-800"
                  }`}
                >
                  <Camera className="h-4 w-4" />
                  {cameraStarting
                    ? "Starting Camera..."
                    : camera
                      ? "Stop Camera"
                      : "Scan with Camera"}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  <ImageUp className="h-4 w-4 text-emerald-700" />
                  Scan QR Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handleQrImageUpload(e)}
                  className="hidden"
                />
              </div>

              {camera && (
                <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500 bg-slate-950">
                  <video
                    ref={video}
                    autoPlay
                    muted
                    playsInline
                    className="h-64 w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-44 w-44 rounded-3xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
                  </div>
                  <p className="bg-slate-950/85 py-2 text-center text-[11px] font-bold text-emerald-300">
                    {cameraStarting
                      ? "Allow camera access to start the preview..."
                      : "Point camera at the Household QR Code..."}
                  </p>
                </div>
              )}

              {/* Identified Household + Check (✓) / X (✗) Action Buttons */}
              {bin && (
                <div className="space-y-4 rounded-3xl border-2 border-emerald-200 bg-emerald-50/50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800">
                        QR {bin.bin_code} · {bin.purok_name}
                      </span>
                      <p className="mt-1.5 text-xl font-black text-slate-900">
                        {bin.full_name}
                      </p>
                      <p className="text-xs font-bold text-slate-500">
                        Household ID: HH-{String(bin.resident_id).padStart(4, "0")}
                      </p>
                    </div>
                  </div>

                  {bin.scanned_today && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800"
                    >
                      Already scanned today (
                      {bin.scanned_today === "segregated"
                        ? "✓ Segregated"
                        : "✗ Not Segregated"}
                      ).
                    </p>
                  )}

                  {bin.collection_suspended_until && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800"
                    >
                      Collection service is suspended until{" "}
                      {new Date(bin.collection_suspended_until).toLocaleDateString(
                        "en-PH",
                        { timeZone: "Asia/Manila" },
                      )}
                      . Record the scan result, but do not collect garbage.
                    </p>
                  )}

                  <div className="space-y-2">
                    <p className="text-center text-[11px] font-black uppercase tracking-wider text-slate-500">
                      Mark Household Segregation Status
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={busy || Boolean(bin.scanned_today)}
                        onClick={() => void save("segregated")}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-5 text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
                          <Check className="h-7 w-7 stroke-[3]" />
                        </span>
                        <span className="text-base font-black">✓ Segregated</span>
                        <span className="text-[11px] font-semibold text-emerald-100">
                          Followed Policy
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={busy || Boolean(bin.scanned_today)}
                        onClick={() => void save("not_segregated")}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-5 text-white shadow-md transition hover:bg-rose-700 disabled:opacity-50"
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
                          <X className="h-7 w-7 stroke-[3]" />
                        </span>
                        <span className="text-base font-black">✗ Not Segregated</span>
                        <span className="text-[11px] font-semibold text-rose-100">
                          Report to Purok Leader
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {message && (
                <div
                  role="status"
                  className={`flex items-start gap-2.5 rounded-2xl border p-4 text-xs font-bold leading-relaxed ${
                    messageTone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : messageTone === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-800"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {messageTone === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : messageTone === "error" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  ) : null}
                  <div className="space-y-2">
                    <p>{message}</p>
                    {messageTone === "success" && (
                      <button
                        type="button"
                        onClick={() => {
                          setMessage("");
                          startCamera();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-1.5 text-[11px] font-black text-white hover:bg-emerald-800"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        Scan Next Household
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
