import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

export type AppRole =
  | "household"
  | "collector"
  | "leader"
  | "admin"
  | "super_admin";

export interface UserProfile {
  name: string;
  email?: string;
  phone?: string;
  address: string;
  householdId: string;
  contactInfo: string;
  communalZone: string;
}

export interface UserAccount {
  id?: number;
  name: string;
  email: string;
  phone: string;
  communalZone: string;
  role: AppRole;
  address: string;
  householdId: string;
  barangay?: string;
  purok?: string;
  status?: "active" | "pending" | "inactive";
  createdAt?: string;
  mustChangePassword?: boolean;
}

interface AppState {
  userProfile: UserProfile;
  currentUser: UserAccount | null;
  isLoggedIn: boolean;
  isAuthLoading: boolean;
  userRole: AppRole;
  currentScreen: string;
  setCurrentScreen: (screen: string) => void;
  updateProfile: (profile: Partial<UserProfile>) => void;
  logoutUser: () => void;
}

const emptyProfile: UserProfile = {
  name: "",
  email: "",
  phone: "",
  address: "",
  householdId: "",
  contactInfo: "",
  communalZone: "",
};

const AppStateContext = createContext<AppState | undefined>(undefined);

const AUTH_STORAGE_KEYS = [
  "token",
  "authToken",
  "sg_current_user",
  "sg_is_logged_in",
  "sg_user_role",
  "sg_current_screen",
  "sg_user_profile",
  "sg_requires_location_setup",
  "sg_pending_approval",
  "sg_temp_login_email",
] as const;

function getStoredValue(key: string) {
  return localStorage.getItem(key) || sessionStorage.getItem(key);
}

function getStoredToken() {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

function getAuthStorage(): Storage | null {
  if (localStorage.getItem("token") || localStorage.getItem("authToken")) {
    return localStorage;
  }

  if (sessionStorage.getItem("token") || sessionStorage.getItem("authToken")) {
    return sessionStorage;
  }

  return null;
}

function parseStoredJson<T>(key: string): T | null {
  const value = getStoredValue(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clearAuthStorage() {
  for (const key of AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

function toAppRole(role: unknown): AppRole {
  if (role === "resident" || role === "household") return "household";
  if (role === "purok_leader" || role === "leader") return "leader";
  if (role === "collector") return "collector";
  if (role === "admin") return "admin";
  if (role === "super_admin") return "super_admin";
  return "household";
}

function roleHomeScreen(role: AppRole) {
  if (role === "super_admin") return "super-admin-dashboard";
  if (role === "admin") return "admin-dashboard";
  if (role === "collector") return "collector-tasks";
  if (role === "leader") return "leader-dashboard";
  return "dashboard";
}

function normalizeAccount(account: UserAccount): UserAccount {
  return {
    ...account,
    name: account.name || "System User",
    email: account.email || "",
    phone: account.phone || "",
    address: account.address || "",
    communalZone: account.communalZone || "",
    householdId: account.householdId || "",
  };
}

function mapApiUser(user: any): UserAccount {
  const role = toAppRole(user?.role);
  const id = Number(user?.id);

  return normalizeAccount({
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    name: String(user?.full_name || user?.name || ""),
    email: String(user?.email || ""),
    phone: String(user?.phone || ""),
    communalZone: [user?.purok_name, user?.barangay_name]
      .filter(Boolean)
      .join(", "),
    role,
    address: String(user?.address || ""),
    householdId:
      role === "super_admin"
        ? `SUP-${id}`
        : role === "admin"
          ? `ADM-${id}`
          : role === "leader"
            ? `LDR-${id}`
            : role === "collector"
              ? `COL-${id}`
              : `HH-${id}`,
    barangay: user?.barangay_name || undefined,
    purok: user?.purok_name || undefined,
    status: user?.status || "active",
    createdAt: user?.created_at || undefined,
    mustChangePassword: Boolean(user?.must_change_password),
  });
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() =>
    parseStoredJson<UserAccount>("sg_current_user"),
  );
  const [userProfile, setUserProfile] = useState<UserProfile>(() =>
    parseStoredJson<UserProfile>("sg_user_profile") || emptyProfile,
  );
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getStoredToken()));
  const [isAuthLoading, setIsAuthLoading] = useState(() =>
    Boolean(getStoredToken()),
  );
  const [userRole, setUserRole] = useState<AppRole>(() =>
    toAppRole(getStoredValue("sg_user_role")),
  );
  const [currentScreen, setCurrentScreen] = useState(() => {
    const storedScreen = getStoredValue("sg_current_screen");
    return storedScreen || roleHomeScreen(toAppRole(getStoredValue("sg_user_role")));
  });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setIsLoggedIn(false);
      setIsAuthLoading(false);
      return;
    }

    setIsAuthLoading(true);

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.user) {
          throw new Error(data.message || "Your login session has expired.");
        }

        if (cancelled) return;

        const account = mapApiUser(data.user);
        const profile: UserProfile = {
          name: account.name,
          email: account.email,
          phone: account.phone,
          address: account.address,
          householdId: account.householdId,
          contactInfo: account.phone,
          communalZone: account.communalZone,
        };

        setCurrentUser(account);
        setUserProfile(profile);
        setUserRole(account.role);
        setIsLoggedIn(true);

        if (account.mustChangePassword) {
          setCurrentScreen("change-initial-password");
        } else if (currentScreen === "registration") {
          setCurrentScreen(roleHomeScreen(account.role));
        }

        const storage = getAuthStorage();
        const needsLocationSetup =
          account.role === "household" &&
          (!account.barangay ||
            !account.purok ||
            !account.address.trim() ||
            !account.phone.trim());
        const needsApproval = account.status === "pending";

        localStorage.removeItem("sg_requires_location_setup");
        sessionStorage.removeItem("sg_requires_location_setup");
        localStorage.removeItem("sg_pending_approval");
        sessionStorage.removeItem("sg_pending_approval");

        if (storage && needsLocationSetup) {
          storage.setItem("sg_requires_location_setup", "true");
        }

        if (storage && needsApproval) {
          storage.setItem("sg_pending_approval", "true");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Authentication restore failed:", error);
        clearAuthStorage();
        setCurrentUser(null);
        setUserProfile(emptyProfile);
        setUserRole("household");
        setIsLoggedIn(false);
        setCurrentScreen("registration");
      })
      .finally(() => {
        if (!cancelled) setIsAuthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      clearAuthStorage();
      setCurrentUser(null);
      setUserProfile(emptyProfile);
      setUserRole("household");
      setIsLoggedIn(false);
      setCurrentScreen("registration");
      setIsAuthLoading(false);
    };

    window.addEventListener("auth-session-expired", handleExpiredSession);
    return () =>
      window.removeEventListener("auth-session-expired", handleExpiredSession);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    const storage = getAuthStorage();
    if (!storage) return;

    storage.setItem("sg_current_user", JSON.stringify(currentUser));
    storage.setItem("sg_user_profile", JSON.stringify(userProfile));
    storage.setItem("sg_is_logged_in", "true");
    storage.setItem("sg_user_role", userRole);
    storage.setItem("sg_current_screen", currentScreen);
  }, [currentScreen, currentUser, isLoggedIn, userProfile, userRole]);

  const updateProfile = (profile: Partial<UserProfile>) => {
    setUserProfile((previous) => ({ ...previous, ...profile }));
    setCurrentUser((previous) =>
      previous
        ? normalizeAccount({
            ...previous,
            name: profile.name ?? previous.name,
            phone: profile.contactInfo ?? previous.phone,
            address: profile.address ?? previous.address,
            communalZone: profile.communalZone ?? previous.communalZone,
          })
        : previous,
    );
  };

  const logoutUser = () => {
    clearAuthStorage();
    setCurrentUser(null);
    setUserProfile(emptyProfile);
    setUserRole("household");
    setIsLoggedIn(false);
    setCurrentScreen("registration");
    setIsAuthLoading(false);
  };

  return (
    <AppStateContext.Provider
      value={{
        userProfile,
        currentUser,
        isLoggedIn,
        isAuthLoading,
        userRole,
        currentScreen,
        setCurrentScreen,
        updateProfile,
        logoutUser,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);

  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider");
  }

  return context;
}
