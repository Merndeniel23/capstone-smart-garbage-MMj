import { apiFetch } from "./http";

export type NotificationItem = {
  id: number;
  recipient_user_id?: number | null;
  recipient_role?: string | null;
  barangay_id?: number | null;
  purok_id?: number | null;
  notification_type: string;
  priority: "emergency" | "schedule" | "notice";
  title: string;
  message: string;
  related_entity_type?: string | null;
  related_entity_id?: number | null;
  created_by?: number | null;
  created_by_name?: string | null;
  barangay_name?: string | null;
  purok_name?: string | null;
  is_seen: number | boolean;
  seen_at?: string | null;
  is_read: number | boolean;
  read_at?: string | null;
  created_at: string;
};

export type NotificationFeedSnapshot = {
  notifications: NotificationItem[];
  loading: boolean;
  loaded: boolean;
  error: Error | null;
  accessPaused: boolean;
};

// The injectable runtime keeps timing and lifecycle tests independent of a browser.
export type NotificationFeedRuntime = {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  windowEvents?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  documentEvents?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  isHidden: () => boolean;
};

type NotificationFeedOptions = {
  token: string;
  intervalMs?: number;
  requestTimeoutMs?: number;
  runtime?: Partial<NotificationFeedRuntime>;
};

class NotificationRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "NotificationRequestError";
  }
}

export function createNotificationFeed(options: NotificationFeedOptions) {
  const intervalMs = options.intervalMs ?? 30_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  const runtime: NotificationFeedRuntime = {
    fetch: apiFetch,
    now: () => Date.now(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    windowEvents: typeof window === "undefined" ? undefined : window,
    documentEvents: typeof document === "undefined" ? undefined : document,
    isHidden: () => typeof document !== "undefined" && document.hidden,
    ...options.runtime,
  };

  let snapshot: NotificationFeedSnapshot = {
    notifications: [], loading: false, loaded: false, error: null, accessPaused: false,
  };
  const listeners = new Set<() => void>();
  const optimisticSeenIds = new Set<number>();
  let running = false;
  let generation = 0;
  let revision = 0;
  let inFlight: Promise<boolean> | null = null;
  let controller: AbortController | null = null;
  let timer: unknown = null;
  let requestTimer: unknown = null;
  let invalidated = false;
  let failures = 0;
  let nextAttemptAt = 0;

  function publish(patch: Partial<NotificationFeedSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function clearTimer() {
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null;
  }

  function schedule(delay: number) {
    clearTimer();
    if (!running || runtime.isHidden() || snapshot.accessPaused || inFlight) return;
    const scheduledGeneration = generation;
    timer = runtime.setTimeout(() => {
      timer = null;
      if (running && generation === scheduledGeneration) void refresh();
    }, Math.max(0, delay));
  }

  function refresh(refreshOptions: { manual?: boolean } = {}): Promise<boolean> {
    const manual = refreshOptions.manual === true;
    if (!running) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!options.token || (!manual && (snapshot.accessPaused || runtime.isHidden()))) {
      return Promise.resolve(false);
    }

    clearTimer();
    invalidated = false;
    const requestGeneration = generation;
    const requestRevision = revision;
    const requestController = new AbortController();
    controller = requestController;
    publish({ loading: true, error: null, ...(manual ? { accessPaused: false } : {}) });

    const isCurrent = () => running && generation === requestGeneration &&
      controller === requestController && !requestController.signal.aborted;

    const request = async (): Promise<boolean> => {
      let succeeded = false;
      try {
        const timeout = new Promise<never>((_, reject) => {
          requestTimer = runtime.setTimeout(() => {
            reject(new Error("Notification request timed out. Please try refreshing again."));
            requestController.abort();
          }, requestTimeoutMs);
        });
        const result = (async () => {
          const response = await runtime.fetch("/api/notifications", {
            method: "GET",
            headers: { Authorization: `Bearer ${options.token}` },
            signal: requestController.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new NotificationRequestError(data.message || "Could not load notifications.", response.status);
          }
          return Array.isArray(data.notifications) ? data.notifications as NotificationItem[] : [];
        })();
        const notifications = await Promise.race([result, timeout]);
        if (!isCurrent()) return false;

        failures = 0;
        succeeded = true;
        // A local acknowledgement made during the GET is newer than its result.
        if (revision === requestRevision) {
          publish({
            notifications: notifications.map(item => {
              if (!optimisticSeenIds.has(item.id)) return item;
              if (Number(item.is_seen)) {
                optimisticSeenIds.delete(item.id);
                return item;
              }
              return { ...item, is_seen: 1 };
            }),
            loaded: true,
            error: null,
            accessPaused: false,
          });
        }
        return true;
      } catch (error) {
        // Timeout aborts still report a recoverable error; stop/logout does not.
        if (!running || generation !== requestGeneration || controller !== requestController) return false;
        failures += 1;
        const requestError = error instanceof Error ? error : new Error("Could not load notifications.");
        const accessPaused = requestError instanceof NotificationRequestError &&
          (requestError.status === 401 || requestError.status === 403);
        publish({ error: requestError, accessPaused });
        return false;
      } finally {
        if (generation === requestGeneration && controller === requestController) {
          if (requestTimer !== null) runtime.clearTimeout(requestTimer);
          requestTimer = null;
          controller = null;
          inFlight = null;
          publish({ loading: false });
          const delay = succeeded ? intervalMs : intervalMs * 2 ** Math.min(Math.max(failures - 1, 0), 2);
          nextAttemptAt = runtime.now() + delay;
          schedule(invalidated ? 100 : delay);
        }
      }
    };

    inFlight = request();
    return inFlight;
  }

  const onChanged = () => {
    invalidated = true;
    // A mutation during a GET needs one trailing request, not that stale result alone.
    if (!inFlight) schedule(100);
  };
  const onSeenAll = () => {
    const notifications = snapshot.notifications.map(item => {
      optimisticSeenIds.add(item.id);
      return Number(item.is_seen) ? item : { ...item, is_seen: 1 };
    });
    publish({ notifications });
  };
  const onVisibilityOrFocus = () => {
    if (runtime.isHidden()) {
      clearTimer();
      return;
    }
    if (!running || inFlight || snapshot.accessPaused) return;
    if (invalidated || runtime.now() >= nextAttemptAt) void refresh();
    else schedule(nextAttemptAt - runtime.now());
  };
  const onLogout = () => {
    stop();
    optimisticSeenIds.clear();
    publish({ notifications: [], loaded: false, error: null, accessPaused: true });
  };

  function start() {
    if (running) return;
    running = true;
    generation += 1;
    runtime.windowEvents?.addEventListener("notifications-changed", onChanged);
    runtime.windowEvents?.addEventListener("notifications-seen-all", onSeenAll);
    runtime.windowEvents?.addEventListener("sg-auth-logout", onLogout);
    runtime.windowEvents?.addEventListener("focus", onVisibilityOrFocus);
    runtime.documentEvents?.addEventListener("visibilitychange", onVisibilityOrFocus);
    if (!options.token) publish({ accessPaused: true });
    else void refresh();
  }

  function stop() {
    running = false;
    generation += 1;
    clearTimer();
    if (requestTimer !== null) runtime.clearTimeout(requestTimer);
    requestTimer = null;
    controller?.abort();
    controller = null;
    inFlight = null;
    invalidated = false;
    runtime.windowEvents?.removeEventListener("notifications-changed", onChanged);
    runtime.windowEvents?.removeEventListener("notifications-seen-all", onSeenAll);
    runtime.windowEvents?.removeEventListener("sg-auth-logout", onLogout);
    runtime.windowEvents?.removeEventListener("focus", onVisibilityOrFocus);
    runtime.documentEvents?.removeEventListener("visibilitychange", onVisibilityOrFocus);
    if (snapshot.loading) publish({ loading: false });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start,
    stop,
    refresh,
    update(updater: (items: NotificationItem[]) => NotificationItem[]) {
      revision += 1;
      publish({ notifications: updater(snapshot.notifications) });
      if (inFlight) invalidated = true;
    },
  };
}
