import {
  AlertTriangle,
  Check,
  Volume2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

type EmergencyNotification = {
  id: number;
  priority: "emergency" | "schedule" | "notice";
  title: string;
  message: string;
  created_by_name?: string | null;
  barangay_name?: string | null;
  purok_name?: string | null;
  is_read: number | boolean;
  created_at: string;
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

  if (!token) {
    throw new Error("No active login session.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

function playEmergencyTone() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(
      880,
      context.currentTime,
    );

    gain.gain.setValueAtTime(
      0.0001,
      context.currentTime,
    );

    gain.gain.exponentialRampToValueAtTime(
      0.18,
      context.currentTime + 0.02,
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + 0.7,
    );

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    oscillator.stop(
      context.currentTime + 0.72,
    );

    window.setTimeout(() => {
      void context.close();
    }, 900);
  } catch {
    // Browsers may block sound until the user interacts.
  }
}

export default function EmergencyAlertOverlay() {
  const [
    activeEmergency,
    setActiveEmergency,
  ] =
    useState<EmergencyNotification | null>(
      null,
    );

  const [visible, setVisible] =
    useState(false);

  const [
    acknowledging,
    setAcknowledging,
  ] = useState(false);

  const lastAlertIdRef =
    useRef<number | null>(null);

  const loadEmergency = async () => {
    if (!getToken()) {
      setActiveEmergency(null);
      setVisible(false);
      return;
    }

    try {
      const data = await apiRequest(
        "/api/notifications",
      );

      const notifications: EmergencyNotification[] =
        Array.isArray(data.notifications)
          ? data.notifications
          : [];

      const emergency =
        notifications.find(
          (item) =>
            item.priority === "emergency" &&
            !Boolean(Number(item.is_read)),
        ) || null;

      if (!emergency) {
        setActiveEmergency(null);
        setVisible(false);
        return;
      }

      setActiveEmergency(emergency);
      setVisible(true);

      if (
        lastAlertIdRef.current !==
        emergency.id
      ) {
        lastAlertIdRef.current =
          emergency.id;
        playEmergencyTone();

        if (
          "Notification" in window &&
          Notification.permission ===
            "granted"
        ) {
          new Notification(
            `Emergency: ${emergency.title}`,
            {
              body: emergency.message,
            },
          );
        }
      }
    } catch {
      // Keep dashboards usable if notification polling fails.
    }
  };

  useEffect(() => {
    void loadEmergency();

    const timer = window.setInterval(
      () => {
        void loadEmergency();
      },
      5000,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const acknowledge = async () => {
    if (!activeEmergency) return;

    setAcknowledging(true);

    try {
      await apiRequest(
        `/api/notifications/${activeEmergency.id}/read`,
        {
          method: "PATCH",
        },
      );

      setVisible(false);
      setActiveEmergency(null);
    } catch {
      // Keep alert visible if acknowledgement fails.
    } finally {
      setAcknowledging(false);
    }
  };

  if (!activeEmergency || !visible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <section className="w-full max-w-2xl overflow-hidden rounded-[2rem] border-4 border-rose-500 bg-white shadow-2xl">
        <div className="bg-gradient-to-r from-rose-700 to-red-600 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-white/15" />
                <AlertTriangle className="relative h-8 w-8" />
              </span>

              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-rose-100">
                  Active Emergency Alert
                </p>

                <h2 className="mt-1 text-2xl font-black">
                  {activeEmergency.title}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setVisible(false)
              }
              className="rounded-xl bg-white/10 p-2 text-white hover:bg-white/20"
              title="Hide temporarily"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-base font-semibold leading-relaxed text-slate-700">
            {activeEmergency.message}
          </p>

          {(activeEmergency.purok_name ||
            activeEmergency.barangay_name) && (
            <div className="rounded-xl bg-rose-50 p-4 text-sm font-black text-rose-700">
              Area:{" "}
              {[
                activeEmergency.purok_name,
                activeEmergency.barangay_name,
              ]
                .filter(Boolean)
                .join(", ")}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-400">
              Issued by{" "}
              {activeEmergency.created_by_name ||
                "Authorized System User"}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={playEmergencyTone}
                className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-xs font-black uppercase text-slate-700"
              >
                <Volume2 className="h-4 w-4" />
                Replay Sound
              </button>

              <button
                type="button"
                disabled={acknowledging}
                onClick={() =>
                  void acknowledge()
                }
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {acknowledging
                  ? "Saving..."
                  : "Acknowledge"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}