import { useEffect, useState } from "react";
import { useAppState } from "../context/AppStateContext";

interface UserAvatarProps {
  className?: string;
  /** "light" for white surfaces (header), "dark" for the green sidebar/drawer. */
  tone?: "light" | "dark";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "U";
}

// One avatar for the sidebar, header and mobile drawer. userProfile is what
// profile edits update, so it wins over the session snapshot in currentUser.
export default function UserAvatar({ className = "h-9 w-9", tone = "light" }: UserAvatarProps) {
  const { userProfile, currentUser } = useAppState();
  const name = userProfile.name || currentUser?.name || "";
  const photo = userProfile.profilePhoto || currentUser?.profilePhoto || "";
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [photo]);

  const surface = tone === "dark"
    ? "bg-white/10 text-emerald-50 ring-1 ring-white/15"
    : "bg-emerald-600 text-white";

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ${surface} ${className}`}>
      {photo && !failed ? (
        <img src={photo} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
