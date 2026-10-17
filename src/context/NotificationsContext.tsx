import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAppState } from "./AppStateContext";
import { createNotificationFeed } from "../services/notificationFeed";

type NotificationFeed = ReturnType<typeof createNotificationFeed>;
type NotificationsValue = ReturnType<NotificationFeed["getSnapshot"]> & {
  enabled: boolean;
  refresh: NotificationFeed["refresh"];
  update: NotificationFeed["update"];
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, isAuthLoading, currentUser, currentScreen } = useAppState();
  const token = localStorage.getItem("token") || sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "";
  const status = currentUser?.status;
  const enabled = Boolean(isLoggedIn && !isAuthLoading && currentUser?.id && token &&
    (!status || status === "active") && !currentUser.mustChangePassword &&
    currentScreen !== "change-initial-password");
  // One feed belongs to one authenticated session. All visible and CSS-hidden
  // navigation components consume the same snapshot and network request.
  const feed = useMemo(() => createNotificationFeed({ token }), [token, enabled]);
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot);

  useEffect(() => {
    if (enabled) feed.start();
    return () => feed.stop();
  }, [feed, enabled]);

  return (
    <NotificationsContext.Provider value={{
      ...snapshot,
      enabled: enabled && !snapshot.accessPaused,
      refresh: feed.refresh,
      update: feed.update,
    }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used within NotificationsProvider.");
  return value;
}
