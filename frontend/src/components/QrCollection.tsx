import { useEffect, useRef, useState } from "react";
import { Camera, Check, QrCode, X } from "lucide-react";
import { apiRequest } from "../services/api";

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

// Collector goes straight to the purok, opens the QR Scanner Modal, scans each bin,
// and marks Check (✓ Segregated) or X (✗ Not Segregated). Result is recorded immediately
// in the Purok Leader's Activity Log so the Leader can issue Warning, Fine, or Suspension.
export default function QrCollection({
  onSaved,
  defaultOpen = false,
}: {
  onSaved: () => void;
  defaultOpen?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(defaultOpen);
  const [qr, setQr] = useState("");
  const [identified, setIdentified] = useState<IdentifiedBin | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const submitting = useRef(false);
  const identifiedRef = useRef<IdentifiedBin | null>(null);
  const qrRef = useRef("");
  const lookupVersion = useRef(0);
  const lookup = useRef<AbortController | null>(null);

  function changeQr(value: string, keepMessage = false) {
    if (submitting.current) return;
    lookupVersion.current++;
    lookup.current?.abort();
    lookup.current = null;
    identifiedRef.current = null;
    setIdentified(null);
    qrRef.current = value;
    setQr(value);
    setBusy(false);
    if (!keepMessage) setMessage("");
    setCamera(false);
  }

  function closeModal() {
    if (submitting.current) return;
    setCamera(false);
    setModalOpen(false);
  }

  useEffect(
    () => () => {
      lookupVersion.current++;
      lookup.current?.abort();
      identifiedRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!camera || !modalOpen) return;
    let cancelled = false,
      timer: number | undefined;
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Camera QR scanning is unavailable here. Use a QR scanner that types into the QR field.",
      );
      setCamera(false);
      return;
    }
    void (async () => {
      try {
        const feed = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          feed.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = feed;
        if (video.current) {
          video.current.srcObject = feed;
          await video.current.play();
        }
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (cancelled) return;
          try {
            if (video.current?.readyState === 4) {
              const results = await detector.detect(video.current);
              if (results[0]?.rawValue) {
                changeQr(results[0].rawValue);
                void identify();
                return;
              }
            }
          } catch {
            /* Retry a frame without keeping a failed frame. */
          }
          if (!cancelled) timer = window.setTimeout(() => void scan(), 300);
        };
        void scan();
      } catch {
        if (!cancelled) {
          setMessage(
            "Unable to access the camera. Allow camera access or use a QR scanner.",
          );
          setCamera(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [camera, modalOpen]);

  async function identify() {
    if (submitting.current || !qrRef.current.trim()) return;
    const payload = qrRef.current.trim(),
      version = ++lookupVersion.current;
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    identifiedRef.current = null;
    setIdentified(null);
    setCamera(false);
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
      if (!controller.signal.aborted && version === lookupVersion.current)
        setMessage(
          error instanceof Error ? error.message : "QR lookup failed.",
        );
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
        changeQr("", true);
        setMessage(
          `${record.bin.bin_code} · ${record.bin.full_name}: ${
            segregation === "segregated" ? "✓ Segregated" : "✗ Not Segregated"
          }. ${result.message}`,
        );
        onSaved();
      }
    } catch (error) {
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
      className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">
            Scan Household Bin (QR Scanner)
          </h2>
          <p className="text-sm text-slate-600">
            Open the QR scanner modal, scan each household bin in the purok, then mark{" "}
            <span className="font-bold text-emerald-700">✓ Segregated</span> or{" "}
            <span className="font-bold text-rose-700">✗ Not Segregated</span>. Result goes straight to the Purok Leader&apos;s Activity Log.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800"
        >
          <QrCode className="h-5 w-5" />
          Open QR Scanner Modal
        </button>
      </div>

      {message && !modalOpen && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
        >
          {message}
        </p>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Bin Scanner Modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <QrCode className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Scan Household Bin QR
                  </h3>
                  <p className="text-xs font-medium text-slate-500">
                    Scan QR code then mark Check (✓ Segregated) or X (✗ Not Segregated)
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

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="Household bin QR payload"
                  value={qr}
                  disabled={submitting.current}
                  onChange={(e) => changeQr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void identify();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 p-3 text-sm"
                  placeholder="Scan or paste household bin QR code (SGMS:1:...)"
                />
                <button
                  type="button"
                  disabled={busy || !qr.trim()}
                  onClick={() => void identify()}
                  className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  Identify Bin
                </button>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (camera) setCamera(false);
                  else {
                    changeQr("");
                    setCamera(true);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-black text-slate-800 hover:bg-slate-100"
              >
                <Camera className="h-4 w-4 text-emerald-700" />
                {camera ? "Stop Camera Scanner" : "Scan QR with Camera"}
              </button>

              {camera && (
                <video
                  ref={video}
                  muted
                  playsInline
                  className="max-h-64 w-full rounded-2xl bg-black object-cover"
                />
              )}

              {bin && (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
                      QR {bin.bin_code} · {bin.purok_name}
                    </p>
                    <p className="mt-0.5 text-lg font-black text-slate-900">
                      {bin.full_name}
                    </p>
                  </div>

                  {bin.scanned_today && (
                    <p
                      role="alert"
                      className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800"
                    >
                      This bin was already scanned today (
                      {bin.scanned_today === "segregated"
                        ? "✓ Segregated"
                        : "✗ Not Segregated"}
                      ).
                    </p>
                  )}

                  {bin.collection_suspended_until && (
                    <p
                      role="alert"
                      className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800"
                    >
                      Collection service is suspended until{" "}
                      {new Date(bin.collection_suspended_until).toLocaleDateString(
                        "en-PH",
                        { timeZone: "Asia/Manila" },
                      )}
                      . Record the scan result, but do not collect garbage.
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={busy || Boolean(bin.scanned_today)}
                      onClick={() => void save("segregated")}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-5 text-base font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-6 w-6 stroke-[3]" />
                      ✓ Segregated
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(bin.scanned_today)}
                      onClick={() => void save("not_segregated")}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-5 text-base font-black text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      <X className="h-6 w-6 stroke-[3]" />
                      ✗ Not Segregated
                    </button>
                  </div>
                </div>
              )}

              {message && (
                <p
                  role="status"
                  className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-800"
                >
                  {message}
                </p>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
