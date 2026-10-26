import { apiFetch } from "./services/http";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import Registration from "./components/Registration";
import Dashboard from "./components/Dashboard";
import CollectorDashboard from "./components/CollectorDashboard";
import LeaderDashboard from "./components/LeaderDashboard";
import AdminDashboard from "./components/AdminDashboard";
import UserManagement from "./components/UserManagement";
import MembersList from "./components/MembersList";
import Schedule from "./components/Schedule";
import BottomNav from "./components/BottomNav";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import MapView from "./components/MapView";
import PaymentPortal from "./components/PaymentPortal";
import EndorsementManager from "./components/EndorsementManager";
import ChatbotWidget from "./components/ChatbotWidget";
import UserProfilePanel from "./components/UserProfilePanel";
import ComplaintsPanel from "./components/ComplaintsPanel";
import NotificationsPanel from "./components/NotificationsPanel";
import BinInspections from "./components/BinInspections";
import ManageGarbageBins from "./components/ManageGarbageBins";
import ChangeInitialPassword from "./components/ChangeInitialPassword";
import Reports from "./components/Reports";
import SgmsRecords, {type RecordView} from "./components/SgmsRecords";
import OnlinePayments from "./components/OnlinePayments";
import EmergencyAlertOverlay from "./components/EmergencyAlertOverlay";

import {
  AppStateProvider,
  useAppState,
} from "./context/AppStateContext";
import { useAdminActionCounts } from "./hooks/useAdminActionCounts";
import { NotificationsProvider } from "./context/NotificationsContext";

export type Role =
  | "household"
  | "collector"
  | "leader"
  | "admin"
  | "super_admin";

export type Screen =
  | RecordView
  | "online-payments"
  | "registration"
  | "dashboard"
  | "collector-tasks"
  | "leader-dashboard"
  | "admin-dashboard"
  | "super-admin-dashboard"
  | "user-management"
  | "members-list"
  | "route-map"
  | "schedule"
  | "complaints"
  | "payments"
  | "notifications"
  | "profile"
  | "endorsements"
  | "bin-inspections"
  | "garbage-bins"
  | "change-initial-password"
  | "reports"
  | "truck-crew-management";

// Four roles only. A stored Municipal (super_admin) session is shown a notice.
const ROLE_HOME_SCREEN: Record<Role, Screen> = {
  household: "dashboard",
  collector: "collector-tasks",
  leader: "leader-dashboard",
  admin: "admin-dashboard",
  super_admin: "profile",
};

const ROLE_SCREENS: Record<Role, Screen[]> = {
  household: [
    "households", "collection-records", "violations", "activity-logs", "online-payments", "payment-history",
    "dashboard",
    "schedule",
    "complaints",
    "payments",
    "notifications",
    "profile",
    "endorsements",
  ],
  collector: [
    "collection-records", "activity-logs",
    "collector-tasks",
    "complaints",
    "route-map",
    "schedule",
    "notifications",
    "profile",
  ],
  leader: [
    "households", "collection-records", "violations", "activity-logs", "archives", "payment-history",
    "leader-dashboard",
    "garbage-bins",
    "bin-inspections",
    "members-list",
    "complaints",
    "endorsements",
    "schedule",
    "notifications",
    "profile",
  ],
  admin: [
    "households", "collection-records", "activity-logs", "members-list",
    "admin-dashboard",
    "garbage-bins",
    "bin-inspections",
    "user-management",
    "complaints",
    "endorsements",
    "schedule",
    "notifications",
    "profile",
  ],
  super_admin: ["profile"],
};


const COLLECTOR_LOCATION_FLAG =
  "sg_collector_location_sharing";

const MAX_ACCEPTABLE_COLLECTOR_ACCURACY_METERS = 1000;
const COLLECTOR_LOCATION_REJECTED_EVENT =
  "collector-location-rejected";

function getAuthToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function sendCollectorGps(
  position: GeolocationPosition,
) {
  const token = getAuthToken();

  const response = await apiFetch(
    "/api/collector-locations/me",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
      },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        headingDegrees: position.coords.heading,
        speedMps: position.coords.speed,
        isOnDuty: true,
      }),
    },
  );

  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({}));

    throw new Error(
      data.message ||
        "Unable to send collector location.",
    );
  }
}

async function markCollectorOffDuty() {
  const token = getAuthToken();

  await apiFetch(
    "/api/collector-locations/me/off-duty",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
      },
    },
  ).catch(() => undefined);
}

function PersistentCollectorLocationTracker() {
  const watchIdRef =
    useRef<number | null>(null);
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return;
    }

    const stopWatcher = () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(
          watchIdRef.current,
        );
        watchIdRef.current = null;
      }
    };

    const handlePosition = (
      position: GeolocationPosition,
    ) => {
      const accuracy = Number(
        position.coords.accuracy,
      );

      if (
        !Number.isFinite(accuracy) ||
        accuracy >
          MAX_ACCEPTABLE_COLLECTOR_ACCURACY_METERS
      ) {
        window.dispatchEvent(
          new CustomEvent(
            COLLECTOR_LOCATION_REJECTED_EVENT,
            {
              detail: {
                accuracy,
                maximumAccuracy:
                  MAX_ACCEPTABLE_COLLECTOR_ACCURACY_METERS,
                timestamp: position.timestamp,
              },
            },
          ),
        );

        return;
      }

      const now = Date.now();

      // Send immediately on a fresh start,
      // then at most once every 10 seconds.
      if (
        lastSentAtRef.current !== 0 &&
        now - lastSentAtRef.current < 10000
      ) {
        return;
      }

      lastSentAtRef.current = now;

      void sendCollectorGps(position)
        .then(() => {
          window.dispatchEvent(
            new CustomEvent(
              "collector-location-update",
              {
                detail: {
                  latitude:
                    position.coords.latitude,
                  longitude:
                    position.coords.longitude,
                  accuracy,
                  timestamp:
                    position.timestamp,
                },
              },
            ),
          );
        })
        .catch(() => {
          // The dashboard/API layer will surface
          // transport or permission errors.
        });
    };

    const startWatcher = () => {
      if (
        localStorage.getItem(
          COLLECTOR_LOCATION_FLAG,
        ) !== "true"
      ) {
        stopWatcher();
        return;
      }

      if (watchIdRef.current !== null) {
        return;
      }

      lastSentAtRef.current = 0;

      // Force a fresh fix first instead of reusing
      // an old cached desktop/browser location.
      const handleLocationError = (
        error: GeolocationPositionError,
      ) => {
        window.dispatchEvent(
          new CustomEvent(
            COLLECTOR_LOCATION_REJECTED_EVENT,
            {
              detail: {
                errorCode: error.code,
                errorMessage: error.message,
                timestamp: Date.now(),
              },
            },
          ),
        );
      };

      navigator.geolocation.getCurrentPosition(
        handlePosition,
        handleLocationError,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        },
      );

      watchIdRef.current =
        navigator.geolocation.watchPosition(
          handlePosition,
          handleLocationError,
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
          },
        );
    };

    const onToggle = () => {
      if (
        localStorage.getItem(
          COLLECTOR_LOCATION_FLAG,
        ) === "true"
      ) {
        startWatcher();
      } else {
        stopWatcher();
        void markCollectorOffDuty();
      }
    };

    window.addEventListener(
      "collector-location-sharing-change",
      onToggle,
    );

    startWatcher();

    return () => {
      window.removeEventListener(
        "collector-location-sharing-change",
        onToggle,
      );
      stopWatcher();
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <AppStateProvider>
      <NotificationsProvider>
        <AppContent />
      </NotificationsProvider>
    </AppStateProvider>
  );
}

function AppContent() {
  // Navigate to the exact complaint when opening a complaint notification.
  const [notificationComplaintId, setNotificationComplaintId] = useState<number | null>(null);
  const {
    isLoggedIn,
    isAuthLoading,
    userRole,
    currentUser,
    currentScreen,
    setCurrentScreen,
    logoutUser,
  } = useAppState();

  const adminActionCounts = useAdminActionCounts(
    userRole,
    currentUser?.id,
  );

  // The profile cache may lack barangay/purok properties even when an
  // approved resident has completed registration. Confirm access from the
  // authoritative account record instead of treating missing cache keys as
  // an incomplete profile.
  const [residentAccess, setResidentAccess] = useState<
    "checking" | "ready" | "restricted"
  >("checking");
  const initialResidentAccessCheck = useRef(false);

  const openNotificationDestination = (screen: Screen, relatedId?: number) => {
    // Never open a page unavailable to this signed-in role.
    if (!ROLE_SCREENS[userRole].includes(screen)) return;
    setNotificationComplaintId(
      screen === "complaints" && Number.isSafeInteger(relatedId) && (relatedId ?? 0) > 0
        ? relatedId!
        : null,
    );
    setCurrentScreen(screen);
  };

  useEffect(() => {
    // Clear the old deep-link when the user leaves Complaints normally.
    if (currentScreen !== "complaints") {
      setNotificationComplaintId(null);
    }
  }, [currentScreen]);

  useEffect(() => {
    if (!isLoggedIn) {
      initialResidentAccessCheck.current = false;
      setResidentAccess("checking");
      return;
    }

    if (currentScreen === "change-initial-password") return;

    if (!ROLE_SCREENS[userRole].includes(currentScreen as Screen)) {
      setCurrentScreen(ROLE_HOME_SCREEN[userRole]);
    }
  }, [currentScreen, isLoggedIn, setCurrentScreen, userRole]);

  useEffect(() => {
    if (!isLoggedIn || isAuthLoading || currentScreen === "change-initial-password") {
      return;
    }

    if (userRole !== "household") {
      setResidentAccess("ready");
      return;
    }

    // When the initial validation succeeds, choosing Profile manually must
    // NEVER redirect the resident away from the Profile page.
    if (residentAccess === "ready") return;

    // A restricted resident may complete details in Profile and then try
    // Dashboard; in that case re-check the live account state.
    if (residentAccess === "restricted" && currentScreen === "profile") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    const verifyResidentProfile = async () => {
      try {
        const token = getAuthToken();
        if (!token) throw new Error("No login session");

        const response = await apiFetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to validate resident profile");

        const data = await response.json();
        const user = data.user;
        if (!user || user.role !== "resident") {
          throw new Error("Invalid resident account response");
        }

        const needsSetup =
          !Number(user.barangay_id) ||
          !Number(user.purok_id) ||
          !String(user.address || "").trim() ||
          !String(user.phone || "").trim();
        const restricted = user.status !== "active" || needsSetup;
        if (cancelled) return;

        if (!restricted) {
          for (const storage of [localStorage, sessionStorage]) {
            storage.removeItem("sg_requires_location_setup");
            storage.removeItem("sg_pending_approval");
          }
        }

        setResidentAccess(restricted ? "restricted" : "ready");
        if (restricted && currentScreen !== "profile") {
          setCurrentScreen("profile");
        } else if (
          !restricted &&
          !initialResidentAccessCheck.current &&
          currentScreen === "profile"
        ) {
          // Fix stale/incorrect Profile landing caused by older login cache.
          setCurrentScreen("dashboard");
        }
        initialResidentAccessCheck.current = true;
      } catch {
        if (cancelled) return;
        // Do not infer missing profile details from an incomplete local cache.
        // Preserve explicit pending/setup flags if live validation is down.
        const restricted = [localStorage, sessionStorage].some(
          (storage) =>
            storage.getItem("sg_requires_location_setup") === "true" ||
            storage.getItem("sg_pending_approval") === "true",
        );
        setResidentAccess(restricted ? "restricted" : "ready");
        if (restricted && currentScreen !== "profile") {
          setCurrentScreen("profile");
        }
        initialResidentAccessCheck.current = true;
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void verifyResidentProfile();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isLoggedIn, isAuthLoading, userRole, currentScreen, residentAccess, setCurrentScreen]);

  const handleLogout = () => {
    if (userRole === "collector") {
      localStorage.removeItem(
        COLLECTOR_LOCATION_FLAG,
      );
      window.dispatchEvent(
        new Event(
          "collector-location-sharing-change",
        ),
      );
    }

    logoutUser();
  };

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center" role="status" aria-live="polite">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
          <p className="mt-4 text-sm font-bold text-slate-600">
            Restoring your secure session...
          </p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Registration />;
  }

  if (
    userRole === "household" &&
    currentScreen !== "change-initial-password" &&
    residentAccess === "checking"
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center" role="status" aria-live="polite">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
          <p className="mt-4 text-sm font-bold text-slate-600">Checking resident account...</p>
        </div>
      </div>
    );
  }

  if (userRole === "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-slate-900">Municipal access removed</h1>
          <p className="text-sm text-slate-600">
            The system now has four roles: Barangay Captain (Admin), Purok Leader, Collector and Resident.
            Sign in with one of those accounts.
          </p>
          <button type="button" onClick={handleLogout} className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (currentScreen === "change-initial-password") {
    return <ChangeInitialPassword />;
  }

  return (
    <div className="sg-app-shell flex min-h-screen min-w-0 flex-col overflow-x-clip bg-[#F8FAFC] font-sans text-slate-900 md:flex-row">
      <EmergencyAlertOverlay />
      {userRole === "collector" && (
        <PersistentCollectorLocationTracker />
      )}
      <Sidebar
        activeTab={currentScreen as any}
        onTabChange={(tab: any) => setCurrentScreen(tab)}
        onLogout={handleLogout}
        role={userRole}
        adminActionCounts={adminActionCounts}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip bg-[#F1F5F9]/30">
        <Header
          activeTab={currentScreen as any}
          onLogout={handleLogout}
          userRole={userRole as any}
          onNavigate={openNotificationDestination}
          profilePhoto={currentUser?.profilePhoto}
        />

        <main id="main-content" tabIndex={-1} className="mx-auto min-w-0 w-full max-w-7xl flex-1 overflow-x-clip p-4 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentScreen}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {currentScreen === "dashboard" && (
                <Dashboard setCurrentScreen={setCurrentScreen as any} />
              )}

              {currentScreen === "collector-tasks" && (
                <CollectorDashboard
                  setCurrentScreen={setCurrentScreen as any}
                />
              )}

              {currentScreen === "leader-dashboard" && (
                <LeaderDashboard
                  setCurrentScreen={setCurrentScreen as any}
                />
              )}

              {currentScreen === "admin-dashboard" && (
                <AdminDashboard
                  setCurrentScreen={setCurrentScreen as any}
                  adminActionCounts={adminActionCounts}
                />
              )}

              {currentScreen === "user-management" && <UserManagement />}
              {currentScreen === "members-list" && <MembersList />}
              {userRole === "leader" && (["collection-records", "violations", "activity-logs"] as string[]).includes(currentScreen) && <MembersList key={currentScreen} initialTab="activity" />}
              {userRole === "leader" && currentScreen === "payment-history" && <MembersList key={currentScreen} initialTab="payments" />}
              {(["households","puroks","collection-records","violations","activity-logs","archives","barangay-policies","payment-history"] as string[]).includes(currentScreen) && !(userRole === "leader" && ["collection-records", "violations", "activity-logs", "payment-history"].includes(currentScreen)) && <SgmsRecords key={currentScreen} view={currentScreen as RecordView} />}
              {currentScreen === "online-payments" && userRole === "household" && <OnlinePayments />}
              {currentScreen === "bin-inspections" && <BinInspections />}
              {currentScreen === "garbage-bins" && <ManageGarbageBins />}
              {currentScreen === "route-map" && <MapView />}
              {currentScreen === "schedule" && <Schedule />}

              {currentScreen === "complaints" && (
                <ComplaintsPanel
                  role={userRole as any}
                  initialComplaintId={notificationComplaintId}
                />
              )}

             {currentScreen === "payments" && (
  <PaymentPortal role={userRole as any} />
)}

              {currentScreen === "endorsements" && (
                <EndorsementManager role={userRole as any} />
              )}

              {currentScreen === "notifications" && (
                <NotificationsPanel
                  role={userRole as any}
                  onNavigate={openNotificationDestination}
                />
              )}

              {currentScreen === "profile" && <UserProfilePanel />}
              {currentScreen === "reports" && <Reports />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <div className="md:hidden">
        <BottomNav
          activeTab={currentScreen as any}
          onTabChange={(tab: any) => setCurrentScreen(tab)}
          role={userRole}
          adminActionCounts={adminActionCounts}
        />
      </div>

      <ChatbotWidget />
    </div>
  );
}
