/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

import Registration from "./components/Registration";
import Dashboard from "./components/Dashboard";
import CollectorDashboard from "./components/CollectorDashboard";
import CollectorPickupLog from "./components/CollectorPickupLog";
import LeaderDashboard from "./components/LeaderDashboard";
import AdminDashboard from "./components/AdminDashboard";
import SuperAdminDashboard from "./components/SuperAdminDashboard";
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
import TruckCrewManagement from "./components/TruckCrewManagement";
import EmergencyAlertOverlay from "./components/EmergencyAlertOverlay";

import {
  AppStateProvider,
  useAppState,
} from "./context/AppStateContext";

export type Role =
  | "household"
  | "collector"
  | "leader"
  | "admin"
  | "super_admin";

export type Screen =
  | "registration"
  | "dashboard"
  | "collector-tasks"
  | "collector-pickup-log"
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

const ROLE_HOME_SCREEN: Record<Role, Screen> = {
  household: "dashboard",
  collector: "collector-tasks",
  leader: "leader-dashboard",
  admin: "admin-dashboard",
  super_admin: "super-admin-dashboard",
};

const ROLE_SCREENS: Record<Role, Screen[]> = {
  household: [
    "dashboard",
    "schedule",
    "complaints",
    "payments",
    "notifications",
    "profile",
    "endorsements",
  ],
  collector: [
    "collector-tasks",
    "collector-pickup-log",
    "complaints",
    "route-map",
    "schedule",
    "notifications",
    "profile",
  ],
  leader: [
    "leader-dashboard",
    "garbage-bins",
    "bin-inspections",
    "members-list",
    "complaints",
    "endorsements",
    "payments",
    "schedule",
    "notifications",
    "profile",
  ],
  admin: [
    "admin-dashboard",
    "garbage-bins",
    "bin-inspections",
    "user-management",
    "complaints",
    "payments",
    "route-map",
    "schedule",
    "notifications",
    "reports",
    "profile",
  ],
  super_admin: [
    "super-admin-dashboard",
    "user-management",
    "members-list",
    "garbage-bins",
    "truck-crew-management",
    "complaints",
    "endorsements",
    "payments",
    "schedule",
    "notifications",
    "reports",
    "profile",
  ],
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

  const response = await fetch(
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

  await fetch(
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
      <AppContent />
    </AppStateProvider>
  );
}

function AppContent() {
  const {
    isLoggedIn,
    isAuthLoading,
    userRole,
    currentUser,
    currentScreen,
    setCurrentScreen,
    logoutUser,
  } = useAppState();

  useEffect(() => {
    if (!isLoggedIn || currentScreen === "change-initial-password") {
      return;
    }

    const residentAccountRestricted =
      userRole === "household" &&
      (currentUser?.status === "pending" ||
        !currentUser?.barangay ||
        !currentUser?.purok ||
        !currentUser?.address.trim() ||
        !currentUser?.phone.trim());

    if (residentAccountRestricted && currentScreen !== "profile") {
      setCurrentScreen("profile");
      return;
    }

    if (!ROLE_SCREENS[userRole].includes(currentScreen as Screen)) {
      setCurrentScreen(ROLE_HOME_SCREEN[userRole]);
    }
  }, [currentScreen, currentUser, isLoggedIn, setCurrentScreen, userRole]);

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
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-[#F8FAFC] font-sans text-slate-900">
        <Registration />
      </div>
    );
  }

  if (currentScreen === "change-initial-password") {
    return <ChangeInitialPassword />;
  }

  const canVerifyPayments =
    userRole === "leader" ||
    userRole === "admin" ||
    userRole === "super_admin";

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] font-sans text-slate-900 md:flex-row">
      <EmergencyAlertOverlay />
      {userRole === "collector" && (
        <PersistentCollectorLocationTracker />
      )}
      <Sidebar
        activeTab={currentScreen as any}
        onTabChange={(tab: any) => setCurrentScreen(tab)}
        onLogout={handleLogout}
        role={userRole}
      />

      <div className="flex min-h-0 flex-1 flex-col bg-[#F1F5F9]/30">
        <Header
          activeTab={currentScreen as any}
          onLogout={handleLogout}
          userRole={userRole as any}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-4 md:p-8">
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

              {currentScreen === "collector-pickup-log" && (
                <CollectorPickupLog />
              )}

              {currentScreen === "leader-dashboard" && (
                <LeaderDashboard
                  setCurrentScreen={setCurrentScreen as any}
                />
              )}

              {currentScreen === "admin-dashboard" && (
                <AdminDashboard
                  setCurrentScreen={setCurrentScreen as any}
                />
              )}

              {currentScreen === "super-admin-dashboard" && (
                <SuperAdminDashboard
                  setCurrentScreen={setCurrentScreen as any}
                />
              )}

              {currentScreen === "user-management" && <UserManagement />}
              {currentScreen === "members-list" && <MembersList />}
              {currentScreen === "bin-inspections" && <BinInspections />}
              {currentScreen === "garbage-bins" && <ManageGarbageBins />}
              {currentScreen === "truck-crew-management" && <TruckCrewManagement />}
              {currentScreen === "route-map" && <MapView />}
              {currentScreen === "schedule" && <Schedule />}

              {currentScreen === "complaints" && (
                <ComplaintsPanel role={userRole as any} />
              )}

             {currentScreen === "payments" && (
  <PaymentPortal role={userRole as any} />
)}

              {currentScreen === "endorsements" && (
                <EndorsementManager role={userRole as any} />
              )}

              {currentScreen === "notifications" && (
                <NotificationsPanel role={userRole as any} />
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
          role={userRole as any}
        />
      </div>

      <ChatbotWidget />
    </div>
  );
}
