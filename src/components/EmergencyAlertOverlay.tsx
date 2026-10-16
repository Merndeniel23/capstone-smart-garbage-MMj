import {
  AlertTriangle,
  Check,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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

// Keep the spoken warning to exactly one short sentence.
const ALERT_SENTENCE =
  "Attention collector, an urgent garbage collection request needs your attention.";
const VOICE_REPEAT_DELAY_MS = 10_000;
const NOTIFICATION_POLL_MS = 5_000;

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function apiRequest(url: string, options: RequestInit = {}) {
  const token = getToken();
  if (!token) throw new Error("No active login session.");

  const response = await fetch(url, {
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

export default function EmergencyAlertOverlay() {
  const [activeEmergency, setActiveEmergency] =
    useState<EmergencyNotification | null>(null);
  const [visible, setVisible] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackError, setAckError] = useState("");

  const mountedRef = useRef(false);
  const currentAlertRef = useRef<EmergencyNotification | null>(null);
  const lastBrowserNotificationIdRef = useRef<number | null>(null);
  const acknowledgedIdsRef = useRef<Set<number>>(new Set());
  const acknowledgingRef = useRef(false);
  const pollingRef = useRef(false);
  const pollingDisabledRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const voiceAlertIdRef = useRef<number | null>(null);
  // Invalidates speech callbacks and queued timers when stopped/replaced.
  const voiceGenerationRef = useRef(0);
  const voiceRepeatTimerRef = useRef<number | null>(null);

  const stopVoice = useCallback(() => {
    voiceGenerationRef.current += 1;
    voiceAlertIdRef.current = null;
    if (voiceRepeatTimerRef.current !== null) {
      window.clearTimeout(voiceRepeatTimerRef.current);
      voiceRepeatTimerRef.current = null;
    }
    // Immediately interrupts the current sentence and clears the speech queue.
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Some browsers do not expose speech until user interaction.
      }
    }
  }, []);

  const startVoiceLoop = useCallback((alertId: number) => {
    // Do not restart the same voice loop on every 5-second API refresh.
    if (voiceAlertIdRef.current === alertId || !getToken()) return;
    stopVoice();
    if (!("speechSynthesis" in window) ||
        !("SpeechSynthesisUtterance" in window)) return;

    const generation = voiceGenerationRef.current;
    voiceAlertIdRef.current = alertId;

    const speak = () => {
      voiceRepeatTimerRef.current = null;
      if (
        generation !== voiceGenerationRef.current ||
        voiceAlertIdRef.current !== alertId ||
        !getToken() ||
        acknowledgingRef.current ||
        !mountedRef.current
      ) return;

      const utterance = new SpeechSynthesisUtterance(ALERT_SENTENCE);
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        if (
          generation !== voiceGenerationRef.current ||
          voiceAlertIdRef.current !== alertId ||
          acknowledgingRef.current ||
          !getToken() ||
          !mountedRef.current
        ) return;
        // Repeat AFTER the entire sentence has finished, not mid-sentence.
        voiceRepeatTimerRef.current = window.setTimeout(
          speak,
          VOICE_REPEAT_DELAY_MS,
        );
      };
      utterance.onerror = () => {
        // Never create a retry storm if speech/audio is blocked by the browser.
      };
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        // Voice is unavailable; the on-screen alert still works.
      }
    };

    speak();
  }, [stopVoice]);

  const clearAlert = useCallback(() => {
    stopVoice();
    currentAlertRef.current = null;
    if (mountedRef.current) {
      setActiveEmergency(null);
      setVisible(false);
      setAckError("");
    }
  }, [stopVoice]);

  const loadEmergency = useCallback(async () => {
    if (pollingDisabledRef.current || pollingRef.current || acknowledgingRef.current) return;
    const token = getToken();
    if (!token) {
      clearAlert();
      return;
    }

    pollingRef.current = true;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const response = await fetch("/api/notifications", {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });

      // Pending/inactive users should not keep spamming protected endpoints.
      if (response.status === 401 || response.status === 403) {
        pollingDisabledRef.current = true;
        clearAlert();
        return;
      }
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));

      // A logout, account switch, unmount, or acknowledgement may have happened
      // while this request was in flight. Ignore the old response.
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        acknowledgingRef.current ||
        token !== getToken()
      ) return;

      const notifications: EmergencyNotification[] =
        Array.isArray(data.notifications) ? data.notifications : [];
      const emergency = notifications.find(
        (item) =>
          item.priority === "emergency" &&
          !Boolean(Number(item.is_read)) &&
          !acknowledgedIdsRef.current.has(item.id),
      ) || null;

      if (!emergency) {
        clearAlert();
        lastBrowserNotificationIdRef.current = null;
        return;
      }

      const isNewAlert = currentAlertRef.current?.id !== emergency.id;
      currentAlertRef.current = emergency;
      setActiveEmergency(emergency);
      setVisible(true);

      if (isNewAlert) {
        setAckError("");
        startVoiceLoop(emergency.id);
      }

      if (lastBrowserNotificationIdRef.current !== emergency.id) {
        lastBrowserNotificationIdRef.current = emergency.id;
        if (
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(`Emergency: ${emergency.title}`, {
              body: emergency.message,
            });
          } catch {
            // Browser notifications are optional; retain the on-screen alert.
          }
        }
      }
    } catch {
      // Keep the existing on-screen alert if a refresh fails transiently.
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
      pollingRef.current = false;
    }
  }, [clearAlert, startVoiceLoop]);

  useEffect(() => {
    mountedRef.current = true;
    pollingDisabledRef.current = false;
    void loadEmergency();
    const timer = window.setInterval(() => {
      void loadEmergency();
    }, NOTIFICATION_POLL_MS);

    const onLogout = () => {
      // Also supported for logout paths where this component stays mounted.
      pollingDisabledRef.current = true;
      pollAbortRef.current?.abort();
      clearAlert();
    };
    const onStorageChange = (event: StorageEvent) => {
      if (
        (event.key === null || ["token", "authToken"].includes(event.key)) &&
        !getToken()
      ) onLogout();
    };
    const onPageHide = () => stopVoice();

    window.addEventListener("sg-auth-logout", onLogout);
    window.addEventListener("storage", onStorageChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener("sg-auth-logout", onLogout);
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener("pagehide", onPageHide);
      pollAbortRef.current?.abort();
      stopVoice();
    };
  }, [clearAlert, loadEmergency, stopVoice]);

  const acknowledge = async () => {
    const emergency = currentAlertRef.current;
    if (!emergency || acknowledgingRef.current) return;

    // Stop the current utterance IMMEDIATELY, before the network request.
    acknowledgingRef.current = true;
    setAcknowledging(true);
    setAckError("");
    stopVoice();
    pollAbortRef.current?.abort();

    try {
      await apiRequest(`/api/notifications/${emergency.id}/read`, {
        method: "PATCH",
      });
      acknowledgedIdsRef.current.add(emergency.id);
      if (mountedRef.current && currentAlertRef.current?.id === emergency.id) {
        clearAlert();
      }
    } catch (error) {
      if (mountedRef.current) {
        setAckError(
          error instanceof Error
            ? `Could not acknowledge alert: ${error.message}`
            : "Could not acknowledge alert. Please try again.",
        );
      }
      // Do not automatically restart speech after the user chose Acknowledge.
      // They may retry or use Replay Voice if acknowledgement failed.
    } finally {
      acknowledgingRef.current = false;
      if (mountedRef.current) {
        setAcknowledging(false);
        // If another unread emergency is waiting, show it next.
        void loadEmergency();
      }
    }
  };

  if (!activeEmergency || !visible) return null;

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

          {ackError && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {ackError}
            </p>
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
                disabled={acknowledging}
                onClick={() => { stopVoice(); startVoiceLoop(activeEmergency.id); }}
                className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-xs font-black uppercase text-slate-700 disabled:opacity-50"
              >
                <Volume2 className="h-4 w-4" />
                Replay Voice
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