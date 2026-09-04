import {
  Building2,
  LogOut,
  Moon,
  Shield,
  Sun,
  Truck,
  User,
} from "lucide-react";
import {
  useEffect,
  useState,
} from "react";
import type { AppRole } from "../context/AppStateContext";

interface HeaderProps {
  activeTab: string;
  onLogout: () => void;
  userRole: AppRole;
  onRoleChange?: (
    role: AppRole,
  ) => void;
  profilePhoto?: string | null;
}

const THEME_STORAGE_KEY =
  "sg_theme";

function formatPageTitle(
  activeTab: string,
) {
  if (
    activeTab ===
    "super-admin-dashboard"
  ) {
    return "Municipal Dashboard";
  }

  if (
    activeTab ===
    "admin-dashboard"
  ) {
    return "Barangay Dashboard";
  }

  if (
    activeTab ===
    "leader-dashboard"
  ) {
    return "Purok Leader Dashboard";
  }

  if (
    activeTab ===
    "collector-tasks"
  ) {
    return "Collection Tasks";
  }

  if (
    activeTab ===
    "collector-pickup-log"
  ) {
    return "Pickup Log";
  }

  return String(
    activeTab || "dashboard",
  )
    .split("-")
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

function getRoleLabel(
  role: AppRole,
) {
  switch (role) {
    case "super_admin":
      return "MUNICIPAL ADMINISTRATOR";
    case "admin":
      return "BARANGAY CAPTAIN";
    case "leader":
      return "PUROK LEADER";
    case "collector":
      return "GARBAGE COLLECTOR";
    default:
      return "RESIDENT";
  }
}

function getRoleIcon(
  role: AppRole,
) {
  switch (role) {
    case "super_admin":
      return Building2;
    case "admin":
      return Shield;
    case "collector":
      return Truck;
    default:
      return User;
  }
}

function readInitialDarkMode() {
  return (
    localStorage.getItem(
      THEME_STORAGE_KEY,
    ) === "dark"
  );
}

export default function Header({
  activeTab,
  onLogout,
  userRole,
  profilePhoto,
}: HeaderProps) {
  const RoleIcon =
    getRoleIcon(userRole);

  const [isDarkMode, setIsDarkMode] =
    useState(readInitialDarkMode);

  useEffect(() => {
    const root =
      document.documentElement;

    root.classList.toggle(
      "sg-dark",
      isDarkMode,
    );

    // Also expose the common "dark" class so any existing
    // Tailwind dark: utilities in the project can respond.
    root.classList.toggle(
      "dark",
      isDarkMode,
    );

    root.dataset.theme =
      isDarkMode
        ? "dark"
        : "light";

    root.style.colorScheme =
      isDarkMode
        ? "dark"
        : "light";

    localStorage.setItem(
      THEME_STORAGE_KEY,
      isDarkMode
        ? "dark"
        : "light",
    );
  }, [isDarkMode]);

  return (
    <>
      <style>{`
        html.sg-dark,
        html.sg-dark body,
        html.sg-dark #root {
          background: #0f172a !important;
          color: #e2e8f0 !important;
        }

        html.sg-dark [class~="bg-white"],
        html.sg-dark [class~="bg-slate-50"],
        html.sg-dark [class~="bg-slate-100"],
        html.sg-dark [class*="bg-[#F8FAFC]"],
        html.sg-dark [class*="bg-[#F1F5F9]"] {
          background-color: #111827 !important;
        }

        html.sg-dark [class~="text-slate-900"],
        html.sg-dark [class~="text-slate-800"],
        html.sg-dark [class~="text-slate-700"] {
          color: #f1f5f9 !important;
        }

        html.sg-dark [class~="text-slate-600"],
        html.sg-dark [class~="text-slate-500"],
        html.sg-dark [class~="text-slate-400"] {
          color: #cbd5e1 !important;
        }

        html.sg-dark [class~="border-slate-100"],
        html.sg-dark [class~="border-slate-200"],
        html.sg-dark [class~="border-slate-300"],
        html.sg-dark [class~="border"] {
          border-color: #334155 !important;
        }

        html.sg-dark input,
        html.sg-dark textarea,
        html.sg-dark select {
          background-color: #0f172a !important;
          color: #f8fafc !important;
          border-color: #475569 !important;
        }

        html.sg-dark input::placeholder,
        html.sg-dark textarea::placeholder {
          color: #94a3b8 !important;
        }

        html.sg-dark table,
        html.sg-dark thead,
        html.sg-dark tbody,
        html.sg-dark tr,
        html.sg-dark td,
        html.sg-dark th {
          border-color: #334155;
        }

        html.sg-dark .leaflet-popup-content-wrapper,
        html.sg-dark .leaflet-popup-tip {
          background: #111827;
          color: #e2e8f0;
        }
      `}</style>

      <header className="sticky top-0 z-10 flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex w-full items-center justify-between md:hidden">
          <h1 className="whitespace-nowrap text-base font-black text-slate-800">
            {formatPageTitle(
              activeTab,
            )}
          </h1>
        </div>

        <div className="hidden flex-1 md:block">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Smart Garbage Monitoring System
          </p>

          <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-800">
            {formatPageTitle(
              activeTab,
            )}
          </h2>
        </div>

        <div className="ml-auto flex w-full items-center justify-between gap-3 md:w-auto md:justify-end">
          <button
            type="button"
            onClick={() =>
              setIsDarkMode(
                (current) => !current,
              )
            }
            aria-label={
              isDarkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={
              isDarkMode
                ? "Light Mode"
                : "Dark Mode"
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            {isDarkMode ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-emerald-50 text-emerald-700">
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <RoleIcon className="h-4 w-4" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />

                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Account Active
                </span>
              </div>

              <p className="mt-0.5 text-xs font-black text-emerald-700">
                {getRoleLabel(
                  userRole,
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-black text-slate-600 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>
    </>
  );
}
